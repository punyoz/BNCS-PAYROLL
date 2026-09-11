-- payroll_records has grown a full row per employee per pay run since
-- 20260401_backfill_core_schema.sql created it, but never got an index to
-- match the query patterns that hit it on every load:
--   * admin/dashboard recent activity -> .order("processed_at", desc).limit(5)
--   * admin/branch-reports            -> .order("processed_at", desc).limit(500)
--   * employee/payslips               -> .eq("employee_id", id).order("processed_at", desc)
--
-- Without an index, each of these forces a full-table sort just to return
-- the top few rows — the actual cause of the Admin dashboard's "Recent
-- Payroll Activity" widget getting slower as payroll history accumulates.
--
-- Safe and idempotent.

CREATE INDEX IF NOT EXISTS payroll_records_processed_at_idx
  ON public.payroll_records (processed_at DESC);

CREATE INDEX IF NOT EXISTS payroll_records_employee_id_processed_at_idx
  ON public.payroll_records (employee_id, processed_at DESC);
