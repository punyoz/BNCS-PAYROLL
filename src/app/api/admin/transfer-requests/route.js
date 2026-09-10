import { NextResponse } from "next/server";
import { sanitizeError } from "@/lib/api-error";
import { normalizeText } from "@/lib/auth/normalize";
import { appendAuditLog } from "@/lib/audit/store";
import { requirePermission, denyForeignBranch, scopeListToBranch } from "@/lib/rbac/guard";
import {
  readAllTransferRequests,
  insertTransferRequest,
  updateTransferRequestStatus,
} from "@/lib/transfer-requests/store";

export async function GET(request) {
  const guard = await requirePermission(request, "transfer_requests", "read");
  if (guard.denied) return guard.denied;

  try {
    const allRequests = await readAllTransferRequests();

    // Super Admin sees every request; Admin sees only the ones it raised out
    // of its own branch.
    const scoped = scopeListToBranch(allRequests, guard, (r) => r.from_branch_id);

    const pending = scoped.filter((r) => r.status === "pending");
    const history = scoped.filter((r) => r.status !== "pending");

    return NextResponse.json({
      requests: scoped,
      pending_requests: pending,
      history_requests: history,
    });
  } catch (error) {
    return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });
  }
}

export async function POST(request) {
  const guard = await requirePermission(request, "transfer_requests", "create");
  if (guard.denied) return guard.denied;

  try {
    const body = await request.json().catch(() => ({}));
    const employeeId = normalizeText(body.employee_id);
    const toBranchId = normalizeText(body.to_branch_id);
    const remarks = normalizeText(body.remarks);

    if (!employeeId || !toBranchId) {
      return NextResponse.json(
        { error: "employee_id and to_branch_id are required." },
        { status: 400 },
      );
    }

    // The request always originates from the caller's own branch — Admin can
    // never name a foreign from_branch_id; Super Admin (branch-exempt) must
    // name one explicitly since it has no single "own branch".
    const fromBranchId = guard.branchExempt ? normalizeText(body.from_branch_id) : guard.branchId;
    if (!fromBranchId) {
      return NextResponse.json({ error: "from_branch_id is required." }, { status: 400 });
    }

    const foreignBranch = denyForeignBranch(guard, fromBranchId);
    if (foreignBranch) return foreignBranch;

    if (fromBranchId === toBranchId) {
      return NextResponse.json(
        { error: "Destination branch must be different from the current branch." },
        { status: 400 },
      );
    }

    const request_ = await insertTransferRequest({
      employee_id: employeeId,
      from_branch_id: fromBranchId,
      to_branch_id: toBranchId,
      // Identity comes from the signed session cookie, never the body — the
      // caller cannot submit a request as someone else.
      requested_by: guard.userId,
      remarks,
    });

    await appendAuditLog({
      module: "transfer_requests",
      action: "create",
      entity_type: "transfer_request",
      entity_id: request_.id,
      description: `Transfer request raised for employee ${employeeId} to another branch.`,
      status: "success",
      source: "api",
      metadata: { employee_id: employeeId, from_branch_id: fromBranchId, to_branch_id: toBranchId },
    });

    return NextResponse.json({ request: request_ }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });
  }
}

export async function PATCH(request) {
  const guard = await requirePermission(request, "transfer_requests", "update");
  if (guard.denied) return guard.denied;

  try {
    const body = await request.json().catch(() => ({}));
    const id = normalizeText(body.id);
    const action = normalizeText(body.action).toLowerCase();

    if (!id) return NextResponse.json({ error: "id is required." }, { status: 400 });
    if (action !== "approve" && action !== "reject") {
      return NextResponse.json({ error: "action must be approve or reject." }, { status: 400 });
    }

    const allRequests = await readAllTransferRequests();
    const current = allRequests.find((r) => r.id === id);
    if (!current) {
      return NextResponse.json({ error: "Transfer request not found." }, { status: 404 });
    }

    if (current.status !== "pending") {
      return NextResponse.json(
        { error: `Cannot ${action} a transfer request with status: ${current.status}.` },
        { status: 409 },
      );
    }

    const nextStatus = action === "approve" ? "approved" : "rejected";
    const { request: updated } = await updateTransferRequestStatus(id, nextStatus, {
      reviewedBy: guard.userId,
    });

    await appendAuditLog({
      module: "transfer_requests",
      action: nextStatus,
      entity_type: "transfer_request",
      entity_id: id,
      description: `Transfer request for employee ${current.employee_id} was ${nextStatus}.`,
      status: "success",
      source: "api",
      metadata: { employee_id: current.employee_id, to_branch_id: current.to_branch_id },
    });

    return NextResponse.json({ request: updated });
  } catch (error) {
    return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });
  }
}
