-- ════════════════════════════════════════════════════════════════════════════
-- Unify Branch Assignment into Transfer Requests + branch_name on
-- employee_info_view.
--
-- 1. transfer_requests.from_branch_id becomes nullable: the older "Branch
--    Assignment" action (instant, no approval) is being replaced by Transfer
--    Requests for every branch move, including assigning a *currently
--    unassigned* employee, which has no prior branch to record.
-- 2. employee_info_view gains branch_name (LEFT JOIN branches) so the UI can
--    stop showing a raw branch_id UUID.
--
-- No new indexes: transfer_requests already has employee_id/from_branch_id/
-- to_branch_id/status indexes (20260910_transfer_requests_and_employee_contact.sql)
-- and profiles already has a branch_id index (20260903_rbac_branch_scoping.sql).
--
-- Idempotent — safe to run more than once.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.transfer_requests
  ALTER COLUMN from_branch_id DROP NOT NULL;

-- Admin may now also raise a request for an employee who currently has no
-- branch at all (from_branch_id IS NULL) — that's the retired Branch
-- Assignment page's "assign an unassigned employee" case, now flowing
-- through this same table.
DROP POLICY IF EXISTS transfer_requests_insert_branch_admin ON public.transfer_requests;
CREATE POLICY transfer_requests_insert_branch_admin ON public.transfer_requests
  FOR INSERT WITH CHECK (
    requested_by = auth.uid()
    AND (
      public.is_super_admin()
      OR (
        public.current_role_name() = 'admin'
        AND (from_branch_id IS NULL OR public.can_reach_branch(from_branch_id))
      )
    )
  );

-- branch_name via LEFT JOIN so an unassigned employee (branch_id IS NULL)
-- still appears in the view rather than being silently dropped by an INNER
-- JOIN. security_invoker keeps profiles' own RLS (profiles_select_branch) as
-- the actual access decision, same as the original view.
--
-- branch_name is appended LAST, not inserted after branch_id: CREATE OR
-- REPLACE VIEW only allows adding a trailing column — every existing column
-- must stay in its original position, or Postgres reports it as trying to
-- rename that position (error 42P16).
CREATE OR REPLACE VIEW public.employee_info_view
WITH (security_invoker = true) AS
SELECT
  p.id,
  p.full_name,
  p.cp_number,
  p.branch_id,
  p.position,
  p.employee_status AS status,
  p.date_hired,
  b.name AS branch_name
FROM public.profiles p
LEFT JOIN public.branches b ON b.id = p.branch_id;

-- Re-assert read-only lockdown (CREATE OR REPLACE VIEW preserves existing
-- grants when only appending a column, but re-running this is harmless and
-- matches this repo's idempotent-migration style).
REVOKE ALL ON public.employee_info_view FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.employee_info_view TO authenticated;
