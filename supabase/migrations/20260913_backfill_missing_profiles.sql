-- ════════════════════════════════════════════════════════════════════════════
-- Fix profiles_role_check to allow 'super_admin' + backfill orphaned profiles
-- rows.
--
-- Root cause of a live bug: profiles.role carries a CHECK constraint created
-- directly in the Supabase dashboard (not tracked anywhere in this repo's
-- migration history — same class of drift documented in
-- 20260401_backfill_core_schema.sql's header) that was never updated when
-- 'super_admin' was added to the user_role enum
-- (20260522_add_super_admin_role_enum.sql). Its allowed list only covers
-- 'admin' / 'accountant' / 'employee' / 'hr'.
--
-- Effect: EVERY super_admin account in this system has silently failed to
-- get a profiles row. /api/admin/users' POST handler upserts into profiles
-- without checking the result for an error, so account creation appeared to
-- succeed while the profiles insert failed underneath. The visible symptom:
-- transfer_requests.requested_by/employee_id/reviewed_by all have a hard
-- foreign key to profiles(id) (20260910_transfer_requests_and_employee_contact.sql),
-- so a Super Admin without a profiles row gets "insert or update on table
-- transfer_requests violates foreign key constraint
-- transfer_requests_requested_by_fkey" — surfaced to the UI as "This action
-- cannot be completed due to related records." — on every transfer/branch
-- assignment they try to submit or approve.
--
-- Idempotent — safe to run more than once.
-- ════════════════════════════════════════════════════════════════════════════

-- Replace the stale constraint with one matching every role this app knows
-- about (src/lib/rbac/permissions.js's ROLES).
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('super_admin', 'admin', 'hr', 'accountant', 'employee'));

-- Backfill a profiles row for any auth.users account that doesn't have one —
-- this specifically catches the super_admin account the constraint above
-- was silently rejecting, plus anything else in the same state (e.g. an
-- account created directly in the Supabase Auth dashboard rather than
-- through this app's own account-creation routes).
-- profiles.role is the user_role ENUM, not text (confirmed live — see
-- 20260401_backfill_core_schema.sql's own header comment on this same
-- drift), so the extracted metadata value needs an explicit cast: Postgres
-- does not implicitly cast a general text expression (as opposed to a bare
-- string literal) to a custom enum type.
INSERT INTO public.profiles (id, email, full_name, role, branch_id)
SELECT
  u.id,
  u.email,
  COALESCE(u.raw_user_meta_data->>'full_name', u.email),
  COALESCE(u.raw_user_meta_data->>'role', 'employee')::public.user_role,
  NULLIF(u.raw_user_meta_data->>'branch_id', '')::uuid
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id
WHERE p.id IS NULL
ON CONFLICT (id) DO NOTHING;
