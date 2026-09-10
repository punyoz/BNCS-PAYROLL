/**
 * Persistent transfer-request storage — backed solely by the Supabase
 * `transfer_requests` table (see
 * supabase/migrations/20260910_transfer_requests_and_employee_contact.sql).
 * No ephemeral fallback: a real database error is thrown, not swallowed into
 * temporary storage.
 *
 * The approval side-effect (moving profiles.branch_id to to_branch_id and
 * stamping reviewed_at) is a DB trigger on that table
 * (apply_transfer_request_approval) — updateTransferRequestStatus() only
 * ever writes status/reviewed_by and lets Postgres do the rest.
 */

import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function getAdminClient() {
  if (!projectUrl || !serviceRoleKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.");
  }
  return createClient(projectUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function normalizeTransferRequest(row) {
  return {
    id: String(row.id || crypto.randomUUID()),
    employee_id: String(row.employee_id || ""),
    employee_name: String(row.employee_name || ""),
    // Nullable: a request raised for a previously-unassigned employee (the
    // retired Branch Assignment page's "assign" case) has no prior branch.
    from_branch_id: row.from_branch_id || null,
    from_branch_name: row.from_branch_name || null,
    to_branch_id: String(row.to_branch_id || ""),
    to_branch_name: String(row.to_branch_name || ""),
    requested_by: String(row.requested_by || ""),
    status: String(row.status || "pending").toLowerCase(),
    reviewed_by: row.reviewed_by || null,
    reviewed_at: row.reviewed_at || null,
    remarks: String(row.remarks || ""),
    created_at: row.created_at || new Date().toISOString(),
  };
}

// ─── Read ─────────────────────────────────────────────────────────────────────

// limit caps rows returned — this app's real scale doesn't need true
// offset-based server pagination, but an unbounded SELECT * is still worth
// capping against unlimited future growth.
export async function readAllTransferRequests({ limit = 200 } = {}) {
  const supabase = getAdminClient();
  const { data, error } = await supabase
    .from("transfer_requests")
    .select(
      "id,employee_id,from_branch_id,to_branch_id,requested_by,status,reviewed_by,reviewed_at,remarks,created_at," +
        "employee:profiles!transfer_requests_employee_id_fkey(full_name)," +
        "from_branch:branches!transfer_requests_from_branch_id_fkey(name)," +
        "to_branch:branches!transfer_requests_to_branch_id_fkey(name)",
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);

  return (data || []).map((row) =>
    normalizeTransferRequest({
      ...row,
      employee_name: row.employee?.full_name,
      from_branch_name: row.from_branch?.name,
      to_branch_name: row.to_branch?.name,
    }),
  );
}

// The employee's actual current branch (nullable) — used by the POST route
// to derive from_branch_id server-side instead of trusting the caller's
// guard.branchId blindly, which is required to also cover assigning a
// currently-unassigned employee (no branch to derive at all).
export async function getEmployeeCurrentBranch(employeeId) {
  const supabase = getAdminClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("branch_id")
    .eq("id", employeeId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data?.branch_id || null;
}

// ─── Insert ───────────────────────────────────────────────────────────────────

export async function insertTransferRequest(newRequest) {
  const supabase = getAdminClient();
  const payload = {
    employee_id: newRequest.employee_id,
    from_branch_id: newRequest.from_branch_id,
    to_branch_id: newRequest.to_branch_id,
    requested_by: newRequest.requested_by,
    remarks: newRequest.remarks || null,
  };

  const { data, error } = await supabase
    .from("transfer_requests")
    .insert(payload)
    .select("id,employee_id,from_branch_id,to_branch_id,requested_by,status,reviewed_by,reviewed_at,remarks,created_at")
    .single();

  if (error) throw new Error(error.message);

  return normalizeTransferRequest(data);
}

// ─── Update Status ────────────────────────────────────────────────────────────

export async function updateTransferRequestStatus(id, nextStatus, { reviewedBy } = {}) {
  const supabase = getAdminClient();

  const lookupResult = await supabase
    .from("transfer_requests")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (lookupResult.error) throw new Error(lookupResult.error.message);
  if (!lookupResult.data) return { found: false, request: null };

  // reviewed_at is stamped by the apply_transfer_request_approval trigger on
  // approval; on rejection there's no branch move, so stamp it here instead.
  const patch = { status: nextStatus, reviewed_by: reviewedBy || null };
  if (nextStatus !== "approved") {
    patch.reviewed_at = new Date().toISOString();
  }

  const { data, error } = await supabase
    .from("transfer_requests")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw new Error(error.message);

  return { found: true, request: normalizeTransferRequest(data) };
}
