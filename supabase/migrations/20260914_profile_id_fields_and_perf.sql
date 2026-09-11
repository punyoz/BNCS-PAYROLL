-- ════════════════════════════════════════════════════════════════════════════
-- Move SSS/Pag-IBIG/PhilHealth/bank/address from Auth user_metadata into real
-- profiles columns, with numeric CHECK constraints + backfill; add the
-- missing attendance_logs.log_date index.
--
-- 1. WHY: these fields only ever lived in auth.users.raw_user_meta_data (a
--    JSON blob), never as actual Postgres columns — which made a real
--    "CHECK constraint" impossible (you can't constrain a JSON key) and was
--    the root cause of Super Admin's employee table (/api/admin/users)
--    never showing them: unlike the other two employee routes, it never
--    read them, because there was nothing in `profiles` to read. Every role
--    keeps working exactly as before — this only adds a column-backed,
--    constrained mirror of what already exists in metadata.
--
-- 2. Stored values are digits-only (no dashes) — dashes are a display/input
--    mask applied in the UI, matching the CHECK constraint pattern already
--    suggested for this feature (`~ '^[0-9]+$'`).
--
-- 3. attendance_logs_log_date_idx: the admin dashboard's attendance panel
--    query now filters by log_date directly (see
--    src/app/api/admin/attendance/route.js's fetchAttendanceRows) instead of
--    fetching up to 3000 rows across every date and discarding non-today
--    rows in JS — this index is what makes that filter fast.
--
-- Idempotent — safe to run more than once.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS address              TEXT,
  ADD COLUMN IF NOT EXISTS sss_number           VARCHAR(10),
  ADD COLUMN IF NOT EXISTS pagibig_number       VARCHAR(12),
  ADD COLUMN IF NOT EXISTS philhealth_number    VARCHAR(12),
  ADD COLUMN IF NOT EXISTS bank_name            TEXT,
  ADD COLUMN IF NOT EXISTS bank_account_number  VARCHAR(20);

-- Backfill from whatever's already in Auth metadata, stripping anything that
-- isn't a digit (existing values may have been typed with dashes) and
-- capping to each column's width. Only fills rows that don't already have a
-- value, so re-running this after someone has already edited a profile
-- through the app won't stomp on their edit.
UPDATE public.profiles p
SET
  address             = COALESCE(p.address, NULLIF(u.raw_user_meta_data->>'address', '')),
  sss_number          = COALESCE(p.sss_number, NULLIF(LEFT(regexp_replace(u.raw_user_meta_data->>'sss_number', '\D', '', 'g'), 10), '')),
  pagibig_number      = COALESCE(p.pagibig_number, NULLIF(LEFT(regexp_replace(u.raw_user_meta_data->>'pagibig_number', '\D', '', 'g'), 12), '')),
  philhealth_number   = COALESCE(p.philhealth_number, NULLIF(LEFT(regexp_replace(u.raw_user_meta_data->>'philhealth_number', '\D', '', 'g'), 12), '')),
  bank_name           = COALESCE(p.bank_name, NULLIF(u.raw_user_meta_data->>'bank_name', '')),
  bank_account_number = COALESCE(p.bank_account_number, NULLIF(LEFT(regexp_replace(u.raw_user_meta_data->>'bank_account_number', '\D', '', 'g'), 20), ''))
FROM auth.users u
WHERE u.id = p.id;

-- Digits-only CHECK constraints (NULL / empty stay valid — these fields are
-- optional). Postgres has no ADD CONSTRAINT IF NOT EXISTS, hence the guard.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_sss_number_check') THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_sss_number_check
      CHECK (sss_number IS NULL OR sss_number ~ '^[0-9]{1,10}$');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_pagibig_number_check') THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_pagibig_number_check
      CHECK (pagibig_number IS NULL OR pagibig_number ~ '^[0-9]{1,12}$');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_philhealth_number_check') THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_philhealth_number_check
      CHECK (philhealth_number IS NULL OR philhealth_number ~ '^[0-9]{1,12}$');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_bank_account_number_check') THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_bank_account_number_check
      CHECK (bank_account_number IS NULL OR bank_account_number ~ '^[0-9]{1,20}$');
  END IF;
END;
$$;

-- Dashboard/attendance performance: today's attendance is now looked up by
-- an exact log_date filter (see route comment above) instead of a full
-- unfiltered fetch, so it needs an index on that column to actually be fast.
CREATE INDEX IF NOT EXISTS attendance_logs_log_date_idx ON public.attendance_logs (log_date);
