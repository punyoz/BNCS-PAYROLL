import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sanitizeError } from "@/lib/api-error";
import { normalizeText } from "@/lib/auth/normalize";
import { appendAuditLog } from "@/lib/audit/store";
import { listUsersCached } from "@/lib/auth/users-cache";
import { requirePermission, denyForeignBranch } from "@/lib/rbac/guard";

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

async function fetchBranchMap(supabase) {
  const result = await supabase.from("branches").select("id,name,status");
  if (result.error) {
    throw new Error(`Failed to fetch branches: ${result.error.message}`);
  }
  const map = new Map();
  (result.data || []).forEach((b) => map.set(b.id, b));
  return map;
}

/**
 * Current branch, sourced from profiles.branch_id — the single source of
 * truth every other route reads (see 20260903_rbac_branch_scoping.sql).
 * Admin/Super Admin branch moves now flow through transfer_requests, whose
 * approval trigger updates profiles.branch_id AND profiles.updated_at, so
 * that timestamp doubles as "when did this employee's branch last change"
 * without a second query. employee_branch_assignments (assigned_by) is kept
 * as best-effort legacy metadata only — it's no longer written to for
 * transfer-requests-driven moves, so it may be stale or absent for those;
 * the branch/branch_label fields above are the ones that stay correct.
 */
async function fetchAllBranchAssignments(supabase, branchMap) {
  const [profilesResult, legacyResult] = await Promise.all([
    supabase.from("profiles").select("id, branch_id, updated_at"),
    supabase.from("employee_branch_assignments").select("user_id, assigned_by"),
  ]);

  if (profilesResult.error) {
    throw new Error(`Failed to fetch profiles: ${profilesResult.error.message}`);
  }

  const assignedByMap = new Map(
    (legacyResult.data || []).map((row) => [row.user_id, row.assigned_by]),
  );

  const assignments = {};
  (profilesResult.data || []).forEach((row) => {
    if (!row.branch_id) return;
    const branch = branchMap.get(row.branch_id);
    assignments[row.id] = {
      branch: row.branch_id,
      branch_label: branch?.name || null,
      branch_status: branch?.status || null,
      assigned_by: assignedByMap.get(row.id) || null,
      assigned_at: row.updated_at,
    };
  });
  return assignments;
}

export async function GET(request) {
  const guard = await requirePermission(request, "branch_assignment", "read");
  if (guard.denied) return guard.denied;

  try {
    const supabase = getAdminClient();

    const usersResult = await listUsersCached(supabase);
    if (usersResult.error) throw new Error(usersResult.error.message);

    const employees = (usersResult.data.users || [])
      .filter((u) => {
        const role = String(u.user_metadata?.role || "employee").toLowerCase();
        return role === "employee" || role === "accountant" || role === "hr";
      })
      .filter((u) => !u.user_metadata?.archived)
      .map((u) => ({
        id: u.id,
        employee_id: normalizeText(u.user_metadata?.employee_id),
        full_name: normalizeText(u.user_metadata?.full_name, u.email),
        email: normalizeText(u.email),
        role: normalizeText(u.user_metadata?.role, "employee"),
        employee_type: normalizeText(u.user_metadata?.employee_type, "Teaching"),
        position: normalizeText(u.user_metadata?.position, "Employee"),
        basic_salary: Number(u.user_metadata?.basic_salary || 0),
        employee_status: normalizeText(u.user_metadata?.employee_status, "Active"),
      }));

    const branchMap = await fetchBranchMap(supabase);
    const assignments = await fetchAllBranchAssignments(supabase, branchMap);

    const enriched = employees.map((e) => ({
      ...e,
      branch: assignments[e.id]?.branch || null,
      branch_label: assignments[e.id]?.branch_label || null,
      branch_status: assignments[e.id]?.branch_status || null,
      assigned_by: assignments[e.id]?.assigned_by || null,
      assigned_at: assignments[e.id]?.assigned_at || null,
    }));

    // A branch-scoped caller sees their own branch's staff plus anyone not yet
    // assigned — those are the only people they may assign into their branch.
    const visible = guard.branchExempt
      ? enriched
      : enriched.filter((e) => !e.branch || String(e.branch) === String(guard.branchId));

    const branches = guard.branchExempt
      ? Array.from(branchMap.values())
      : Array.from(branchMap.values()).filter((b) => String(b.id) === String(guard.branchId));
    const summary = {
      total: visible.length,
      unassigned: visible.filter((e) => !e.branch).length,
      by_branch: Object.fromEntries(
        branches.map((b) => [
          b.id,
          { label: b.name, status: b.status, count: visible.filter((e) => e.branch === b.id).length },
        ]),
      ),
    };

    return NextResponse.json({ employees: visible, summary });
  } catch (error) {
    return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });
  }
}

export async function POST(request) {
  const guard = await requirePermission(request, "branch_assignment", "update");
  if (guard.denied) return guard.denied;

  try {
    const body = await request.json();
    const userId = normalizeText(body.user_id);
    const branchId = normalizeText(body.branch_id || body.branch);
    const assignedBy = normalizeText(body.assigned_by, "admin");

    if (!userId || !branchId) {
      return NextResponse.json({ error: "user_id and branch_id are required." }, { status: 400 });
    }

    // Assigning WITHIN your own branch is allowed; moving staff ACROSS
    // branches is Super Admin's alone, so the destination has to be the
    // caller's own branch.
    const foreignDestination = denyForeignBranch(guard, branchId);
    if (foreignDestination) return foreignDestination;

    const supabase = getAdminClient();

    const branchResult = await supabase
      .from("branches")
      .select("id,name,status")
      .eq("id", branchId)
      .maybeSingle();

    if (branchResult.error || !branchResult.data) {
      return NextResponse.json({ error: "Branch not found." }, { status: 404 });
    }

    const { data: userData, error: userErr } = await supabase.auth.admin.getUserById(userId);
    if (userErr || !userData?.user) {
      return NextResponse.json({ error: "Employee not found." }, { status: 404 });
    }

    const user = userData.user;
    const meta = user.user_metadata || {};

    const { error: upsertErr } = await supabase.from("employee_branch_assignments").upsert(
      {
        user_id: userId,
        branch_id: branchId,
        assigned_by: assignedBy,
        assigned_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );

    if (upsertErr) {
      return NextResponse.json({ error: upsertErr.message }, { status: 400 });
    }

    // profiles.branch_id is what the session and the RLS policies read, so it
    // has to move with the assignment. (The database trigger added in
    // 20260903_rbac_branch_scoping.sql does this too — this keeps the row
    // correct even on an install where that migration has not been applied.)
    await supabase
      .from("profiles")
      .update({ branch_id: branchId, updated_at: new Date().toISOString() })
      .eq("id", userId);

    await appendAuditLog({
      module: "employees",
      action: "update",
      entity_type: "branch_assignment",
      entity_id: normalizeText(meta.employee_id, userId),
      description: `Employee ${normalizeText(meta.full_name, user.email)} assigned to ${branchResult.data.name} by ${assignedBy}.`,
      status: "success",
      source: "api",
      metadata: { user_id: userId, branch_id: branchId, branch_label: branchResult.data.name },
    });

    return NextResponse.json({ success: true, branch: branchId, branch_label: branchResult.data.name });
  } catch (error) {
    return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });
  }
}

export async function DELETE(request) {
  const guard = await requirePermission(request, "branch_assignment", "update");
  if (guard.denied) return guard.denied;

  try {
    const body = await request.json().catch(() => ({}));
    const userId = normalizeText(body.user_id);

    if (!userId) {
      return NextResponse.json({ error: "user_id is required." }, { status: 400 });
    }

    const supabase = getAdminClient();

    const existing = await supabase
      .from("employee_branch_assignments")
      .select("branch_id")
      .eq("user_id", userId)
      .maybeSingle();

    if (!existing.data) {
      return NextResponse.json(
        { error: "Employee is not assigned to any branch." },
        { status: 404 },
      );
    }

    // You can only unassign someone who is currently in your own branch.
    const foreignAssignment = denyForeignBranch(guard, existing.data.branch_id);
    if (foreignAssignment) return foreignAssignment;

    const branchResult = await supabase
      .from("branches")
      .select("name")
      .eq("id", existing.data.branch_id)
      .maybeSingle();

    const deleteResult = await supabase
      .from("employee_branch_assignments")
      .delete()
      .eq("user_id", userId);

    if (deleteResult.error) {
      return NextResponse.json({ error: deleteResult.error.message }, { status: 400 });
    }

    await supabase
      .from("profiles")
      .update({ branch_id: null, updated_at: new Date().toISOString() })
      .eq("id", userId);

    await appendAuditLog({
      module: "employees",
      action: "update",
      entity_type: "branch_assignment",
      entity_id: userId,
      description: `Employee was removed from ${branchResult.data?.name || "their branch"}.`,
      status: "success",
      source: "api",
      metadata: { user_id: userId, branch_id: existing.data.branch_id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });
  }
}
