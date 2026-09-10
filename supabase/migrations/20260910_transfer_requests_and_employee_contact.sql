-- ════════════════════════════════════════════════════════════════════════════
-- Transfer Requests + Employee Contact Number / Admin read view
--
-- NOTE ON TABLE NAMES: this schema has no separate `employees` or `users`
-- tables — public.profiles (1:1 with auth.users.id, see
-- 20260401_backfill_core_schema.sql) already IS the employee/user record,
-- carrying full_name, position, employee_status, branch_id, etc. Both
-- features below are built against profiles rather than forking a parallel
-- table, and reuse the RBAC helpers from 20260903_rbac_branch_scoping.sql
-- (is_super_admin(), can_reach_branch(), current_role_name()) rather than
-- re-deriving role checks.
--
-- Entirely idempotent (CREATE ... IF NOT EXISTS / ADD COLUMN IF NOT EXISTS /
-- DROP POLICY IF EXISTS before CREATE POLICY), matching the style of the
-- existing migrations. Safe to run more than once.
-- ════════════════════════════════════════════════════════════════════════════


-- ─── 1. transfer_requests ───────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'transfer_request_status') THEN
    CREATE TYPE public.transfer_request_status AS ENUM ('pending', 'approved', 'rejected');
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.transfer_requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id     UUID NOT NULL REFERENCES public.profiles(id),
  from_branch_id  UUID NOT NULL REFERENCES public.branches(id),
  to_branch_id    UUID NOT NULL REFERENCES public.branches(id),
  requested_by    UUID NOT NULL REFERENCES public.profiles(id),
  status          public.transfer_request_status NOT NULL DEFAULT 'pending',
  reviewed_by     UUID REFERENCES public.profiles(id),
  reviewed_at     TIMESTAMPTZ,
  remarks         TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS transfer_requests_employee_id_idx    ON public.transfer_requests (employee_id);
CREATE INDEX IF NOT EXISTS transfer_requests_from_branch_id_idx ON public.transfer_requests (from_branch_id);
CREATE INDEX IF NOT EXISTS transfer_requests_to_branch_id_idx   ON public.transfer_requests (to_branch_id);
CREATE INDEX IF NOT EXISTS transfer_requests_status_idx         ON public.transfer_requests (status);

-- ─── 1a. Approval side-effect ───────────────────────────────────────────────
-- On transition into 'approved': stamp reviewed_at and move the employee's
-- profile to the destination branch. Runs BEFORE UPDATE so it can set
-- NEW.reviewed_at on the same row, and reaches across to profiles directly
-- (SECURITY DEFINER, pinned search_path) so it applies regardless of the
-- caller's own RLS grants on profiles.
CREATE OR REPLACE FUNCTION public.apply_transfer_request_approval()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'approved' AND OLD.status IS DISTINCT FROM NEW.status THEN
    NEW.reviewed_at := NOW();

    UPDATE public.profiles
    SET branch_id = NEW.to_branch_id, updated_at = NOW()
    WHERE id = NEW.employee_id;
  END IF;

  RETURN NEW;
END;
$$;

-- Defense in depth: even though the RLS policy below already limits UPDATE on
-- this table to Super Admin, this trigger blocks any attempt (including a
-- future policy change) to rewrite the identifying fields of a transfer
-- request. Only status, reviewed_by, reviewed_at and remarks may ever change
-- after a row is created.
CREATE OR REPLACE FUNCTION public.restrict_transfer_request_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.employee_id    IS DISTINCT FROM OLD.employee_id
     OR NEW.from_branch_id IS DISTINCT FROM OLD.from_branch_id
     OR NEW.to_branch_id   IS DISTINCT FROM OLD.to_branch_id
     OR NEW.requested_by   IS DISTINCT FROM OLD.requested_by
     OR NEW.created_at     IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION
      'Only status, reviewed_by, reviewed_at and remarks may be changed on a transfer request.'
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$;

-- Trigger names are prefixed 01/02 so Postgres (which fires same-event BEFORE
-- triggers in name order) runs the column guard before the approval effect.
DROP TRIGGER IF EXISTS transfer_requests_01_restrict_update ON public.transfer_requests;
CREATE TRIGGER transfer_requests_01_restrict_update
  BEFORE UPDATE ON public.transfer_requests
  FOR EACH ROW EXECUTE FUNCTION public.restrict_transfer_request_update();

DROP TRIGGER IF EXISTS transfer_requests_02_apply_approval ON public.transfer_requests;
CREATE TRIGGER transfer_requests_02_apply_approval
  BEFORE UPDATE ON public.transfer_requests
  FOR EACH ROW EXECUTE FUNCTION public.apply_transfer_request_approval();

-- ─── 1b. Row Level Security ─────────────────────────────────────────────────
-- Reminder (see 20260903_rbac_branch_scoping.sql header): API routes connect
-- with the Supabase SERVICE ROLE key, which bypasses RLS. These policies are
-- the second layer, covering any client reaching Postgres directly with a
-- user JWT.

ALTER TABLE public.transfer_requests ENABLE ROW LEVEL SECURITY;

-- Read: the employee the request is about, an admin who can reach either the
-- source or destination branch, or Super Admin (can_reach_branch passes
-- unconditionally for Super Admin).
DROP POLICY IF EXISTS transfer_requests_select_scoped ON public.transfer_requests;
CREATE POLICY transfer_requests_select_scoped ON public.transfer_requests
  FOR SELECT USING (
    employee_id = auth.uid()
    OR public.can_reach_branch(from_branch_id)
    OR public.can_reach_branch(to_branch_id)
  );

-- Insert: Branch Admin may only create a transfer request out of their own
-- branch, and only as themselves. Super Admin may create one for any branch.
DROP POLICY IF EXISTS transfer_requests_insert_branch_admin ON public.transfer_requests;
CREATE POLICY transfer_requests_insert_branch_admin ON public.transfer_requests
  FOR INSERT WITH CHECK (
    requested_by = auth.uid()
    AND (
      public.is_super_admin()
      OR (
        public.current_role_name() = 'admin'
        AND public.can_reach_branch(from_branch_id)
      )
    )
  );

-- Update: Super Admin only (the trigger above further restricts which
-- columns of the row that update may touch).
DROP POLICY IF EXISTS transfer_requests_update_super_admin ON public.transfer_requests;
CREATE POLICY transfer_requests_update_super_admin ON public.transfer_requests
  FOR UPDATE USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

-- No DELETE policy: with RLS enabled and no matching policy, deletes are
-- denied for every role except the service key. Transfer history is kept,
-- consistent with the rest of this schema's no-hard-delete stance.


-- ─── 2. Employee contact number + read-only admin view ──────────────────────

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS cp_number  VARCHAR(20),
  ADD COLUMN IF NOT EXISTS date_hired DATE;

-- security_invoker makes this view run its query as the calling user rather
-- than the view owner, so profiles' own RLS policy (profiles_select_branch)
-- is what actually decides visibility here — Admin sees only their branch,
-- Super Admin (has_permission(..., 'all') scope) sees everything. That
-- policy already implements exactly the split point (c) asks for, so no
-- separate RLS object is needed on the view itself.
CREATE OR REPLACE VIEW public.employee_info_view
WITH (security_invoker = true) AS
SELECT
  id,
  full_name,
  cp_number,
  branch_id,
  position,
  employee_status AS status,
  date_hired
FROM public.profiles;

-- Explicitly read-only: Supabase's default privileges on new relations in
-- the public schema grant INSERT/UPDATE/DELETE to anon/authenticated, which
-- would make this an accidentally-writable view (simple single-table views
-- are auto-updatable in Postgres). Strip that back down to SELECT only.
REVOKE ALL ON public.employee_info_view FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.employee_info_view TO authenticated;
