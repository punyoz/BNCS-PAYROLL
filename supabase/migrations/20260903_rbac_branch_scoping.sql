-- ════════════════════════════════════════════════════════════════════════════
-- RBAC: role_permissions table, branch_id scoping, RLS policies, no-hard-delete
--
-- Implements SACS-Payroll-Permission-Matrix.md at the database level:
--
--   1. role_permissions — the matrix as data, so role checks stop being
--      hardcoded. Mirrors src/lib/rbac/permissions.js exactly.
--   2. branch_id on profiles and on every table carrying branch-owned rows,
--      backfilled from the existing employee_branch_assignments table.
--   3. Row Level Security on all of them: a caller sees only rows whose
--      branch_id matches their own. Super Admin bypasses the check entirely.
--   4. A hard-delete block on the tables payroll and attendance history depend
--      on — accounts are archived, never destroyed.
--
-- Entirely idempotent (CREATE ... IF NOT EXISTS / ADD COLUMN IF NOT EXISTS /
-- DROP POLICY IF EXISTS before CREATE POLICY), matching the style of the
-- existing migrations. Safe to run more than once.
--
-- IMPORTANT — the API routes in src/app/api/** connect with the Supabase
-- SERVICE ROLE key, which bypasses RLS by design. These policies therefore do
-- NOT secure those routes; src/lib/rbac/guard.js does. RLS here is the second
-- layer, covering any client that reaches Postgres directly with a user JWT.
-- ════════════════════════════════════════════════════════════════════════════


-- ─── 1. role_permissions ────────────────────────────────────────────────────
-- One row per (role, module): which actions are allowed, and at what scope.
-- scope: 'all' (every branch) | 'branch' (own branch) | 'self' (own records).

CREATE TABLE IF NOT EXISTS public.role_permissions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role        TEXT NOT NULL,
  module      TEXT NOT NULL,
  scope       TEXT NOT NULL DEFAULT 'none',
  can_create  BOOLEAN NOT NULL DEFAULT false,
  can_read    BOOLEAN NOT NULL DEFAULT false,
  can_update  BOOLEAN NOT NULL DEFAULT false,
  -- "delete" means ARCHIVE throughout this system. No row is ever physically
  -- removed; see section 5 below.
  can_delete  BOOLEAN NOT NULL DEFAULT false,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT role_permissions_role_module_unique UNIQUE (role, module),
  CONSTRAINT role_permissions_scope_check CHECK (scope IN ('all', 'branch', 'self', 'none'))
);

ALTER TABLE public.role_permissions
  ADD COLUMN IF NOT EXISTS role       TEXT,
  ADD COLUMN IF NOT EXISTS module     TEXT,
  ADD COLUMN IF NOT EXISTS scope      TEXT,
  ADD COLUMN IF NOT EXISTS can_create BOOLEAN,
  ADD COLUMN IF NOT EXISTS can_read   BOOLEAN,
  ADD COLUMN IF NOT EXISTS can_update BOOLEAN,
  ADD COLUMN IF NOT EXISTS can_delete BOOLEAN,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS role_permissions_role_idx ON public.role_permissions (role);

-- Seed / re-sync the matrix. ON CONFLICT DO UPDATE so re-running this file
-- brings an existing install back in line with the documented matrix.
INSERT INTO public.role_permissions (role, module, scope, can_create, can_read, can_update, can_delete) VALUES
  -- ─ Super Admin: system-wide + configuration authority ─
  ('super_admin', 'dashboard',            'all',  true,  true,  true,  true),
  ('super_admin', 'attendance',           'all',  true,  true,  true,  true),
  ('super_admin', 'user_management',      'all',  true,  true,  true,  true),
  ('super_admin', 'employee_information', 'all',  true,  true,  true,  true),
  ('super_admin', 'branch_management',    'all',  true,  true,  true,  true),
  ('super_admin', 'branch_assignment',    'all',  true,  true,  true,  true),
  ('super_admin', 'roles_permissions',    'all',  true,  true,  true,  true),
  ('super_admin', 'leave_approval',       'all',  true,  true,  true,  true),
  ('super_admin', 'rfid_devices',         'all',  true,  true,  true,  true),
  ('super_admin', 'process_payroll',      'all',  false, true,  true,  false),
  ('super_admin', 'payroll_records',      'all',  true,  true,  true,  true),
  ('super_admin', 'payslips',             'all',  true,  true,  true,  true),
  ('super_admin', 'payroll_monitoring',   'all',  true,  true,  true,  true),
  ('super_admin', 'system_maintenance',   'all',  true,  true,  true,  true),
  ('super_admin', 'system_configuration', 'all',  true,  true,  true,  true),
  ('super_admin', 'audit_logs',           'all',  true,  true,  true,  true),
  ('super_admin', 'backup_recovery',      'all',  true,  true,  true,  true),
  ('super_admin', 'hr_reports',           'all',  true,  true,  true,  true),
  ('super_admin', 'payroll_reports',      'all',  true,  true,  true,  true),
  ('super_admin', 'branch_reports',       'all',  false, true,  false, false),
  ('super_admin', 'profile',              'self', true,  true,  true,  true),
  ('super_admin', 'timesheet',            'all',  true,  true,  true,  true),

  -- ─ Admin: operational authority, boxed inside one branch ─
  ('admin', 'dashboard',            'branch', false, true,  false, false),
  ('admin', 'attendance',           'branch', false, true,  true,  false),
  ('admin', 'user_management',      'branch', true,  true,  true,  true),
  ('admin', 'employee_information', 'branch', true,  true,  true,  true),
  ('admin', 'branch_management',    'none',   false, false, false, false),
  ('admin', 'branch_assignment',    'branch', false, true,  true,  false),
  ('admin', 'roles_permissions',    'none',   false, false, false, false),
  ('admin', 'leave_approval',       'branch', false, true,  false, false),
  ('admin', 'rfid_devices',         'branch', false, true,  false, false),
  ('admin', 'process_payroll',      'none',   false, false, false, false),
  ('admin', 'payroll_records',      'branch', false, true,  false, false),
  ('admin', 'payslips',             'branch', false, true,  false, false),
  ('admin', 'payroll_monitoring',   'branch', false, true,  false, false),
  ('admin', 'system_maintenance',   'none',   false, false, false, false),
  ('admin', 'system_configuration', 'none',   false, false, false, false),
  ('admin', 'audit_logs',           'branch', false, true,  false, false),
  ('admin', 'backup_recovery',      'none',   false, false, false, false),
  ('admin', 'hr_reports',           'branch', false, true,  false, false),
  ('admin', 'payroll_reports',      'branch', false, true,  false, false),
  ('admin', 'branch_reports',       'branch', false, true,  false, false),
  ('admin', 'profile',              'self',   true,  true,  true,  true),
  ('admin', 'timesheet',            'branch', false, true,  false, false),

  -- ─ HR ─
  ('hr', 'dashboard',            'branch', false, true,  false, false),
  ('hr', 'attendance',           'branch', false, true,  true,  false),
  ('hr', 'user_management',      'branch', false, true,  true,  false),
  ('hr', 'employee_information', 'branch', true,  true,  true,  true),
  ('hr', 'branch_management',    'none',   false, false, false, false),
  ('hr', 'branch_assignment',    'branch', false, true,  true,  false),
  ('hr', 'roles_permissions',    'none',   false, false, false, false),
  ('hr', 'leave_approval',       'branch', true,  true,  true,  true),
  ('hr', 'rfid_devices',         'none',   false, false, false, false),
  ('hr', 'process_payroll',      'none',   false, false, false, false),
  ('hr', 'payroll_records',      'branch', false, true,  false, false),
  ('hr', 'payslips',             'branch', false, true,  false, false),
  ('hr', 'payroll_monitoring',   'none',   false, false, false, false),
  ('hr', 'system_maintenance',   'none',   false, false, false, false),
  ('hr', 'system_configuration', 'none',   false, false, false, false),
  ('hr', 'audit_logs',           'none',   false, false, false, false),
  ('hr', 'backup_recovery',      'none',   false, false, false, false),
  ('hr', 'hr_reports',           'branch', true,  true,  true,  true),
  ('hr', 'payroll_reports',      'none',   false, false, false, false),
  ('hr', 'branch_reports',       'none',   false, false, false, false),
  ('hr', 'profile',              'self',   true,  true,  true,  true),
  ('hr', 'timesheet',            'branch', false, true,  false, false),

  -- ─ Accountant ─
  ('accountant', 'dashboard',            'branch', false, true,  false, false),
  ('accountant', 'attendance',           'branch', false, true,  false, false),
  ('accountant', 'user_management',      'none',   false, false, false, false),
  ('accountant', 'employee_information', 'branch', false, true,  false, false),
  ('accountant', 'branch_management',    'none',   false, false, false, false),
  ('accountant', 'branch_assignment',    'none',   false, false, false, false),
  ('accountant', 'roles_permissions',    'none',   false, false, false, false),
  ('accountant', 'leave_approval',       'branch', false, true,  true,  false),
  ('accountant', 'rfid_devices',         'none',   false, false, false, false),
  ('accountant', 'process_payroll',      'branch', true,  true,  true,  true),
  ('accountant', 'payroll_records',      'branch', true,  true,  true,  true),
  ('accountant', 'payslips',             'branch', true,  true,  true,  true),
  ('accountant', 'payroll_monitoring',   'branch', true,  true,  true,  true),
  ('accountant', 'system_maintenance',   'none',   false, false, false, false),
  ('accountant', 'system_configuration', 'none',   false, false, false, false),
  ('accountant', 'audit_logs',           'none',   false, false, false, false),
  ('accountant', 'backup_recovery',      'none',   false, false, false, false),
  ('accountant', 'hr_reports',           'none',   false, false, false, false),
  ('accountant', 'payroll_reports',      'branch', true,  true,  true,  true),
  ('accountant', 'branch_reports',       'none',   false, false, false, false),
  ('accountant', 'profile',              'self',   true,  true,  true,  true),
  ('accountant', 'timesheet',            'branch', false, true,  false, false),

  -- ─ Employee ─
  ('employee', 'dashboard',            'self', false, true,  false, false),
  ('employee', 'attendance',           'self', false, true,  false, false),
  ('employee', 'user_management',      'none', false, false, false, false),
  ('employee', 'employee_information', 'self', false, true,  false, false),
  ('employee', 'branch_management',    'none', false, false, false, false),
  ('employee', 'branch_assignment',    'none', false, false, false, false),
  ('employee', 'roles_permissions',    'none', false, false, false, false),
  ('employee', 'leave_approval',       'self', true,  true,  false, false),
  ('employee', 'rfid_devices',         'none', false, false, false, false),
  ('employee', 'process_payroll',      'none', false, false, false, false),
  ('employee', 'payroll_records',      'none', false, false, false, false),
  ('employee', 'payslips',             'self', false, true,  false, false),
  ('employee', 'payroll_monitoring',   'none', false, false, false, false),
  ('employee', 'system_maintenance',   'none', false, false, false, false),
  ('employee', 'system_configuration', 'none', false, false, false, false),
  ('employee', 'audit_logs',           'none', false, false, false, false),
  ('employee', 'backup_recovery',      'none', false, false, false, false),
  ('employee', 'hr_reports',           'none', false, false, false, false),
  ('employee', 'payroll_reports',      'none', false, false, false, false),
  ('employee', 'branch_reports',       'none', false, false, false, false),
  ('employee', 'profile',              'self', true,  true,  true,  true),
  ('employee', 'timesheet',            'self', false, true,  false, false),

  -- ─ employee_info_readonly / transfer_requests — added alongside
  -- public.transfer_requests / employee_info_view in
  -- 20260910_transfer_requests_and_employee_contact.sql. Neither module is
  -- consumed by has_permission() yet (that table/view use their own bespoke
  -- RLS — is_super_admin()/can_reach_branch() — added in that same
  -- migration), but every module is seeded for every role regardless, same
  -- as the rest of this table.
  ('super_admin', 'employee_info_readonly', 'all', false, true, false, false),
  ('admin', 'employee_info_readonly', 'branch', false, true, false, false),
  ('hr', 'employee_info_readonly', 'branch', false, true, false, false),
  ('accountant', 'employee_info_readonly', 'none', false, false, false, false),
  ('employee', 'employee_info_readonly', 'none', false, false, false, false),

  ('super_admin', 'transfer_requests', 'all', true, true, true, true),
  ('admin', 'transfer_requests', 'branch', true, true, false, false),
  ('hr', 'transfer_requests', 'none', false, false, false, false),
  ('accountant', 'transfer_requests', 'none', false, false, false, false),
  ('employee', 'transfer_requests', 'none', false, false, false, false)
ON CONFLICT (role, module) DO UPDATE SET
  scope      = EXCLUDED.scope,
  can_create = EXCLUDED.can_create,
  can_read   = EXCLUDED.can_read,
  can_update = EXCLUDED.can_update,
  can_delete = EXCLUDED.can_delete,
  updated_at = NOW();


-- ─── 2. branch_id columns ───────────────────────────────────────────────────
-- profiles.branch_id becomes the single source of truth for "which branch does
-- this account belong to", including Admin accounts, which previously had no
-- branch recorded anywhere. employee_branch_assignments is kept intact and
-- stays in sync via the trigger in section 4.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES public.branches(id);

ALTER TABLE public.attendance_logs
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES public.branches(id);

ALTER TABLE public.payroll_records
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES public.branches(id);

ALTER TABLE public.audit_logs
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES public.branches(id);

ALTER TABLE public.leave_requests
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES public.branches(id);

ALTER TABLE public.salary_approvals
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES public.branches(id);

-- payroll_records and salary_approvals both carry a live UPDATE trigger
-- (created directly in the Supabase dashboard, not tracked anywhere in this
-- repo's migration history) that unconditionally sets NEW.updated_at — the
-- same trigger 20260901_add_updated_at_to_attendance_logs.sql found already
-- attached to attendance_logs without the column existing. Section 3 below
-- UPDATEs both tables to backfill branch_id, which fires that trigger, so the
-- column has to exist first or the backfill fails with "record 'new' has no
-- field 'updated_at'".
ALTER TABLE public.payroll_records
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE public.salary_approvals
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE public.payroll_entries
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES public.branches(id);

-- audit_logs additionally distinguishes branch activity from system-level
-- events (logins, config changes, backups). Admin sees only branch rows;
-- Super Admin sees everything. Rows written by the config/system/backup
-- modules are marked system-level.
ALTER TABLE public.audit_logs
  ADD COLUMN IF NOT EXISTS is_system_event BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS profiles_branch_id_idx         ON public.profiles (branch_id);
CREATE INDEX IF NOT EXISTS attendance_logs_branch_id_idx  ON public.attendance_logs (branch_id);
CREATE INDEX IF NOT EXISTS payroll_records_branch_id_idx  ON public.payroll_records (branch_id);
CREATE INDEX IF NOT EXISTS audit_logs_branch_id_idx       ON public.audit_logs (branch_id);
CREATE INDEX IF NOT EXISTS leave_requests_branch_id_idx   ON public.leave_requests (branch_id);
CREATE INDEX IF NOT EXISTS salary_approvals_branch_id_idx ON public.salary_approvals (branch_id);
CREATE INDEX IF NOT EXISTS payroll_entries_branch_id_idx  ON public.payroll_entries (branch_id);


-- ─── 3. Backfill ────────────────────────────────────────────────────────────
-- Carry existing assignments across, then denormalize onto the history tables.

UPDATE public.profiles p
SET branch_id = a.branch_id
FROM public.employee_branch_assignments a
WHERE a.user_id = p.id
  AND p.branch_id IS NULL;

-- Any branch-scoped account still without a branch falls back to the oldest
-- active branch, so no one is locked out on first login after this migration.
-- Super Admin is left NULL on purpose: it is branch-exempt.
UPDATE public.profiles
SET branch_id = (
  SELECT id FROM public.branches WHERE status = 'Active' ORDER BY created_at ASC LIMIT 1
)
WHERE branch_id IS NULL
  AND COALESCE(LOWER(role::text), 'employee') <> 'super_admin';

-- Every comparison below casts both sides to TEXT rather than trusting the
-- tracked column type. profiles, attendance_logs, salary_approvals,
-- payroll_records and leave_requests were all created out-of-band in the
-- Supabase dashboard at some point before this repo's migration history
-- began (see the header comment in 20260401_backfill_core_schema.sql, and
-- 20260830_drop_payroll_entries_employee_fk.sql for a confirmed case of live
-- schema drift from what's documented) — profiles.role turned out to already
-- be the user_role ENUM rather than TEXT, and this same UPDATE originally
-- broke on "operator does not exist: uuid = text" because employee_id columns
-- also don't reliably match their documented type. Casting to TEXT on both
-- sides is correct either way — UUID and TEXT both compare equal as text when
-- they hold the same id — so this is safe regardless of which type is live.
UPDATE public.attendance_logs l
SET branch_id = p.branch_id
FROM public.profiles p
WHERE p.id::text = l.employee_id::text AND l.branch_id IS NULL;

UPDATE public.payroll_records r
SET branch_id = p.branch_id
FROM public.profiles p
WHERE p.id::text = r.employee_id::text AND r.branch_id IS NULL;

UPDATE public.payroll_entries e
SET branch_id = p.branch_id
FROM public.profiles p
WHERE p.id::text = e.employee_id::text AND e.branch_id IS NULL;

-- leave_requests.employee_id and salary_approvals.employee_id hold either a
-- profile UUID or a human employee code, so match on both.
UPDATE public.leave_requests lr
SET branch_id = p.branch_id
FROM public.profiles p
WHERE lr.branch_id IS NULL
  AND (lr.employee_id::text = p.id::text OR lr.employee_id::text = p.employee_id::text);

UPDATE public.salary_approvals sa
SET branch_id = p.branch_id
FROM public.profiles p
WHERE sa.branch_id IS NULL
  AND (sa.employee_id::text = p.id::text OR sa.employee_code::text = p.employee_id::text);


-- ─── 4. Helper functions ────────────────────────────────────────────────────
-- SECURITY DEFINER + a pinned search_path so the policies below can read
-- profiles without recursing through profiles' own RLS.

CREATE OR REPLACE FUNCTION public.current_role_name()
RETURNS TEXT
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    LOWER(NULLIF(auth.jwt() -> 'user_metadata' ->> 'role', '')),
    LOWER((SELECT role::text FROM public.profiles WHERE id = auth.uid())),
    'employee'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.current_role_name() = 'super_admin';
$$;

CREATE OR REPLACE FUNCTION public.current_branch_id()
RETURNS UUID
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT branch_id FROM public.profiles WHERE id = auth.uid();
$$;

-- The one predicate every branch-scoped policy uses: Super Admin passes
-- unconditionally, everyone else only for rows in their own branch.
CREATE OR REPLACE FUNCTION public.can_reach_branch(target UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_super_admin()
      OR (target IS NOT NULL AND target = public.current_branch_id());
$$;

-- Matrix lookup, straight out of role_permissions.
CREATE OR REPLACE FUNCTION public.has_permission(target_module TEXT, target_action TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT CASE LOWER(target_action)
             WHEN 'create' THEN can_create
             WHEN 'read'   THEN can_read
             WHEN 'update' THEN can_update
             WHEN 'delete' THEN can_delete
             ELSE false
           END
    FROM public.role_permissions
    WHERE role = public.current_role_name()
      AND module = target_module
  ), false);
$$;

-- Keep employee_branch_assignments and profiles.branch_id from drifting apart:
-- writing either one now updates the other.
CREATE OR REPLACE FUNCTION public.sync_profile_branch_from_assignment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.profiles SET branch_id = NEW.branch_id, updated_at = NOW()
  WHERE id = NEW.user_id AND branch_id IS DISTINCT FROM NEW.branch_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS employee_branch_assignments_sync_profile ON public.employee_branch_assignments;
CREATE TRIGGER employee_branch_assignments_sync_profile
  AFTER INSERT OR UPDATE ON public.employee_branch_assignments
  FOR EACH ROW EXECUTE FUNCTION public.sync_profile_branch_from_assignment();

-- Stamp branch_id onto history rows automatically, so a route that forgets to
-- set it still produces a correctly scoped row rather than an invisible one.
CREATE OR REPLACE FUNCTION public.stamp_branch_from_employee()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.branch_id IS NULL AND NEW.employee_id IS NOT NULL THEN
    SELECT branch_id INTO NEW.branch_id
    FROM public.profiles
    WHERE id::text = NEW.employee_id::text
    LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS attendance_logs_stamp_branch ON public.attendance_logs;
CREATE TRIGGER attendance_logs_stamp_branch
  BEFORE INSERT ON public.attendance_logs
  FOR EACH ROW EXECUTE FUNCTION public.stamp_branch_from_employee();

DROP TRIGGER IF EXISTS payroll_records_stamp_branch ON public.payroll_records;
CREATE TRIGGER payroll_records_stamp_branch
  BEFORE INSERT ON public.payroll_records
  FOR EACH ROW EXECUTE FUNCTION public.stamp_branch_from_employee();

DROP TRIGGER IF EXISTS payroll_entries_stamp_branch ON public.payroll_entries;
CREATE TRIGGER payroll_entries_stamp_branch
  BEFORE INSERT ON public.payroll_entries
  FOR EACH ROW EXECUTE FUNCTION public.stamp_branch_from_employee();

DROP TRIGGER IF EXISTS leave_requests_stamp_branch ON public.leave_requests;
CREATE TRIGGER leave_requests_stamp_branch
  BEFORE INSERT ON public.leave_requests
  FOR EACH ROW EXECUTE FUNCTION public.stamp_branch_from_employee();


-- ─── 5. Hard-delete block ───────────────────────────────────────────────────
-- Accounts are archived (profiles.archived = true / employee_status
-- 'Inactive'), never physically removed, so payroll and attendance history
-- keeps its referential integrity. This trigger refuses the DELETE outright —
-- no role can get past it, service_role and Super Admin included, because a
-- BEFORE DELETE trigger runs regardless of RLS.

CREATE OR REPLACE FUNCTION public.block_hard_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'Hard delete is disabled on %. Archive the record instead (set archived = true / status inactive) so payroll and attendance history stays intact.',
    TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$;

DROP TRIGGER IF EXISTS profiles_block_hard_delete ON public.profiles;
CREATE TRIGGER profiles_block_hard_delete
  BEFORE DELETE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.block_hard_delete();

DROP TRIGGER IF EXISTS attendance_logs_block_hard_delete ON public.attendance_logs;
CREATE TRIGGER attendance_logs_block_hard_delete
  BEFORE DELETE ON public.attendance_logs
  FOR EACH ROW EXECUTE FUNCTION public.block_hard_delete();

DROP TRIGGER IF EXISTS payroll_records_block_hard_delete ON public.payroll_records;
CREATE TRIGGER payroll_records_block_hard_delete
  BEFORE DELETE ON public.payroll_records
  FOR EACH ROW EXECUTE FUNCTION public.block_hard_delete();

DROP TRIGGER IF EXISTS audit_logs_block_hard_delete ON public.audit_logs;
CREATE TRIGGER audit_logs_block_hard_delete
  BEFORE DELETE ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.block_hard_delete();

-- NOTE: payroll_entries is intentionally NOT protected. Those rows are the
-- Accountant's working drafts, and src/app/api/accountant/payroll/route.js
-- deletes a draft once it has been posted into payroll_records — the durable
-- record. Blocking that DELETE would break payroll processing.


-- ─── 6. Row Level Security ──────────────────────────────────────────────────

ALTER TABLE public.profiles                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_logs             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_records             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_entries             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leave_requests              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.salary_approvals            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_branch_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.branches                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_config               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_permissions            ENABLE ROW LEVEL SECURITY;

-- profiles ------------------------------------------------------------------
DROP POLICY IF EXISTS profiles_select_branch ON public.profiles;
CREATE POLICY profiles_select_branch ON public.profiles
  FOR SELECT USING (
    id = auth.uid()                                    -- always see yourself
    OR (public.has_permission('user_management', 'read') AND public.can_reach_branch(branch_id))
    OR (public.has_permission('employee_information', 'read') AND public.can_reach_branch(branch_id))
  );

DROP POLICY IF EXISTS profiles_insert_branch ON public.profiles;
CREATE POLICY profiles_insert_branch ON public.profiles
  FOR INSERT WITH CHECK (
    public.has_permission('user_management', 'create')
    AND public.can_reach_branch(branch_id)
    -- An Admin may never mint an admin or super_admin account.
    AND (public.is_super_admin() OR LOWER(COALESCE(role::text, 'employee')) NOT IN ('admin', 'super_admin'))
  );

DROP POLICY IF EXISTS profiles_update_branch ON public.profiles;
CREATE POLICY profiles_update_branch ON public.profiles
  FOR UPDATE USING (
    id = auth.uid()                                    -- edit your own profile
    OR (
      public.has_permission('user_management', 'update')
      AND public.can_reach_branch(branch_id)
      -- ...but never edit an admin/super_admin account unless you are one.
      AND (public.is_super_admin() OR LOWER(COALESCE(role::text, 'employee')) NOT IN ('admin', 'super_admin'))
    )
  ) WITH CHECK (
    id = auth.uid()
    OR (
      public.can_reach_branch(branch_id)
      -- ...and never elevate anyone INTO admin/super_admin, nor move an
      -- account to another branch, unless you are Super Admin.
      AND (public.is_super_admin() OR LOWER(COALESCE(role::text, 'employee')) NOT IN ('admin', 'super_admin'))
    )
  );

-- attendance_logs -----------------------------------------------------------
-- employee_id is cast to TEXT on both sides rather than trusted as UUID: this
-- table was created out-of-band before this repo's migration history began
-- (see the backfill comment above), and its columns have already been found
-- to not reliably match their documented type.
DROP POLICY IF EXISTS attendance_select_branch ON public.attendance_logs;
CREATE POLICY attendance_select_branch ON public.attendance_logs
  FOR SELECT USING (
    employee_id::text = auth.uid()::text
    OR (public.has_permission('attendance', 'read') AND public.can_reach_branch(branch_id))
  );

DROP POLICY IF EXISTS attendance_insert_branch ON public.attendance_logs;
CREATE POLICY attendance_insert_branch ON public.attendance_logs
  FOR INSERT WITH CHECK (
    public.has_permission('attendance', 'create') AND public.can_reach_branch(branch_id)
  );

DROP POLICY IF EXISTS attendance_update_branch ON public.attendance_logs;
CREATE POLICY attendance_update_branch ON public.attendance_logs
  FOR UPDATE USING (
    public.has_permission('attendance', 'update') AND public.can_reach_branch(branch_id)
  ) WITH CHECK (public.can_reach_branch(branch_id));

-- payroll_records ------------------------------------------------------------
-- Same defensive TEXT cast as attendance_logs above, for the same reason.
DROP POLICY IF EXISTS payroll_records_select_branch ON public.payroll_records;
CREATE POLICY payroll_records_select_branch ON public.payroll_records
  FOR SELECT USING (
    employee_id::text = auth.uid()::text
    OR (public.has_permission('payroll_records', 'read') AND public.can_reach_branch(branch_id))
  );

DROP POLICY IF EXISTS payroll_records_insert_branch ON public.payroll_records;
CREATE POLICY payroll_records_insert_branch ON public.payroll_records
  FOR INSERT WITH CHECK (
    public.has_permission('payroll_records', 'create') AND public.can_reach_branch(branch_id)
  );

DROP POLICY IF EXISTS payroll_records_update_branch ON public.payroll_records;
CREATE POLICY payroll_records_update_branch ON public.payroll_records
  FOR UPDATE USING (
    public.has_permission('payroll_records', 'update') AND public.can_reach_branch(branch_id)
  ) WITH CHECK (public.can_reach_branch(branch_id));

-- payroll_entries (Accountant drafts) ---------------------------------------
DROP POLICY IF EXISTS payroll_entries_all_branch ON public.payroll_entries;
CREATE POLICY payroll_entries_all_branch ON public.payroll_entries
  FOR ALL USING (
    public.has_permission('process_payroll', 'read') AND public.can_reach_branch(branch_id)
  ) WITH CHECK (
    public.has_permission('process_payroll', 'update') AND public.can_reach_branch(branch_id)
  );

-- audit_logs ----------------------------------------------------------------
-- Admin's Audit Logs = own branch activity only. System-level events (logins,
-- config changes, backups) are Super Admin's Audit & Monitoring alone.
DROP POLICY IF EXISTS audit_logs_select_scoped ON public.audit_logs;
CREATE POLICY audit_logs_select_scoped ON public.audit_logs
  FOR SELECT USING (
    public.is_super_admin()
    OR (
      public.has_permission('audit_logs', 'read')
      AND is_system_event = false
      AND public.can_reach_branch(branch_id)
    )
  );

DROP POLICY IF EXISTS audit_logs_insert_any ON public.audit_logs;
CREATE POLICY audit_logs_insert_any ON public.audit_logs
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- leave_requests ------------------------------------------------------------
-- employee_id is cast on both sides rather than trusted as TEXT — this table
-- may also predate this repo's migration history (see the CREATE TABLE
-- comment in 20260827_add_pay_status_to_leave_requests.sql), so its type is
-- not guaranteed either.
DROP POLICY IF EXISTS leave_requests_select_branch ON public.leave_requests;
CREATE POLICY leave_requests_select_branch ON public.leave_requests
  FOR SELECT USING (
    employee_id::text = auth.uid()::text
    OR (public.has_permission('leave_approval', 'read') AND public.can_reach_branch(branch_id))
  );

DROP POLICY IF EXISTS leave_requests_insert_own ON public.leave_requests;
CREATE POLICY leave_requests_insert_own ON public.leave_requests
  FOR INSERT WITH CHECK (
    employee_id::text = auth.uid()::text
    OR (public.has_permission('leave_approval', 'create') AND public.can_reach_branch(branch_id))
  );

-- Approval is an UPDATE. Admin has read-only on this module by design —
-- final approval stays with HR, escalation with Super Admin.
DROP POLICY IF EXISTS leave_requests_update_approver ON public.leave_requests;
CREATE POLICY leave_requests_update_approver ON public.leave_requests
  FOR UPDATE USING (
    public.has_permission('leave_approval', 'update') AND public.can_reach_branch(branch_id)
  ) WITH CHECK (public.can_reach_branch(branch_id));

-- salary_approvals ----------------------------------------------------------
DROP POLICY IF EXISTS salary_approvals_select_branch ON public.salary_approvals;
CREATE POLICY salary_approvals_select_branch ON public.salary_approvals
  FOR SELECT USING (
    public.has_permission('payroll_records', 'read') AND public.can_reach_branch(branch_id)
  );

DROP POLICY IF EXISTS salary_approvals_write_branch ON public.salary_approvals;
CREATE POLICY salary_approvals_write_branch ON public.salary_approvals
  FOR ALL USING (
    public.has_permission('payroll_records', 'update') AND public.can_reach_branch(branch_id)
  ) WITH CHECK (public.can_reach_branch(branch_id));

-- employee_branch_assignments -----------------------------------------------
DROP POLICY IF EXISTS branch_assignments_select_branch ON public.employee_branch_assignments;
CREATE POLICY branch_assignments_select_branch ON public.employee_branch_assignments
  FOR SELECT USING (
    user_id = auth.uid()
    OR (public.has_permission('branch_assignment', 'read') AND public.can_reach_branch(branch_id))
  );

-- Moving staff BETWEEN branches is Super Admin's alone: a branch-scoped role
-- can only write a row whose branch_id is its own branch, so it can assign
-- within its branch but never move anyone out of it.
DROP POLICY IF EXISTS branch_assignments_write_branch ON public.employee_branch_assignments;
CREATE POLICY branch_assignments_write_branch ON public.employee_branch_assignments
  FOR ALL USING (
    public.has_permission('branch_assignment', 'update') AND public.can_reach_branch(branch_id)
  ) WITH CHECK (
    public.has_permission('branch_assignment', 'update') AND public.can_reach_branch(branch_id)
  );

-- branches ------------------------------------------------------------------
-- Everyone may read the branch list (labels are needed all over the UI);
-- creating, editing and closing branches is Super Admin exclusive.
DROP POLICY IF EXISTS branches_select_all ON public.branches;
CREATE POLICY branches_select_all ON public.branches
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS branches_write_super_admin ON public.branches;
CREATE POLICY branches_write_super_admin ON public.branches
  FOR ALL USING (public.has_permission('branch_management', 'update'))
  WITH CHECK (public.has_permission('branch_management', 'create'));

-- system_config -------------------------------------------------------------
-- Tax tables, payroll formulas, holiday calendar: Super Admin exclusive.
DROP POLICY IF EXISTS system_config_select_scoped ON public.system_config;
CREATE POLICY system_config_select_scoped ON public.system_config
  FOR SELECT USING (public.has_permission('system_configuration', 'read'));

DROP POLICY IF EXISTS system_config_write_super_admin ON public.system_config;
CREATE POLICY system_config_write_super_admin ON public.system_config
  FOR ALL USING (public.has_permission('system_configuration', 'update'))
  WITH CHECK (public.has_permission('system_configuration', 'update'));

-- role_permissions ----------------------------------------------------------
-- Readable by any signed-in user (the UI needs its own menu), editable only
-- through the Roles & Permissions module — Super Admin exclusive.
DROP POLICY IF EXISTS role_permissions_select_all ON public.role_permissions;
CREATE POLICY role_permissions_select_all ON public.role_permissions
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS role_permissions_write_super_admin ON public.role_permissions;
CREATE POLICY role_permissions_write_super_admin ON public.role_permissions
  FOR ALL USING (public.has_permission('roles_permissions', 'update'))
  WITH CHECK (public.has_permission('roles_permissions', 'update'));
