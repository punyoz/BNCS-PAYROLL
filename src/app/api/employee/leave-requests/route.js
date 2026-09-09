import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { sanitizeError } from "@/lib/api-error";
import {
  readAllLeaveRequests,
  insertLeaveRequest,
  normalizeLeaveRequest,
  summarizeLeaveBalance,
} from "@/lib/leave-requests/store";
import { requirePermission, resolveTargetUserId } from "@/lib/rbac/guard";
import { SCOPE_SELF } from "@/lib/rbac/permissions";

export async function GET(request) {
  try {
    const guard = await requirePermission(request, "leave_approval", "read");
    if (guard.denied) return guard.denied;

    const url = new URL(request.url);
    const isSelfScoped = guard.scope === SCOPE_SELF;

    // The filter below matches on id OR name, so a self-scoped caller must be
    // pinned on BOTH. Pinning only the id would still let someone pass
    // ?employee_name=<colleague> and pull that colleague's leave history back
    // through the other half of the OR.
    const employeeId = resolveTargetUserId(guard, url.searchParams.get("employee_id"));
    const employeeName = isSelfScoped
      ? String(guard.session?.full_name || "").trim().toLowerCase()
      : String(url.searchParams.get("employee_name") || "").trim().toLowerCase();

    if (!employeeId && !employeeName) {
      return NextResponse.json({ requests: [] });
    }

    const allRequests = await readAllLeaveRequests();
    const requests = allRequests.filter((row) => {
      if (employeeId && row.employee_id === employeeId) return true;
      if (employeeName && row.employee_name.toLowerCase() === employeeName) return true;
      return false;
    });

    const balance = summarizeLeaveBalance(requests, employeeId);

    return NextResponse.json({ requests, balance });
  } catch (error) {
    return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const guard = await requirePermission(request, "leave_approval", "create");
    if (guard.denied) return guard.denied;

    const body = await request.json();

    // Whose request this is comes from the signed session, not the body, so a
    // caller cannot file (or later cancel) leave in a colleague's name.
    const employeeId = resolveTargetUserId(guard, body.employee_id);
    const employeeName = guard.scope === SCOPE_SELF
      ? String(guard.session?.full_name || "").trim()
      : String(body.employee_name || "").trim();
    const position = String(body.position || "Employee").trim();
    const leaveType = String(body.leave_type || "").trim();
    const payStatus = String(body.pay_status || "with_pay").trim().toLowerCase() === "without_pay"
      ? "without_pay"
      : "with_pay";
    const startDate = String(body.start_date || "").trim();
    const endDate = String(body.end_date || "").trim();
    const reason = String(body.reason || "").trim();
    // Preserve proof_url exactly — it may be a large base64 data URL.
    const proofUrl = String(body.proof_url || "");

    if (!employeeName || !leaveType || !startDate || !endDate || !reason) {
      return NextResponse.json(
        { error: "employee_name, leave_type, start_date, end_date, and reason are required." },
        { status: 400 },
      );
    }

    if (startDate > endDate) {
      return NextResponse.json(
        { error: "start_date must not be after end_date." },
        { status: 400 },
      );
    }

    const allRequests = await readAllLeaveRequests();
    const hasDuplicatePending = allRequests.some((row) => {
      const isSameEmployee = employeeId
        ? row.employee_id === employeeId
        : row.employee_name.toLowerCase() === employeeName.toLowerCase();

      if (!isSameEmployee) return false;
      if (row.status === "pending_accountant" || row.status === "pending_admin") {
        return row.leave_type === leaveType && row.start_date === startDate && row.end_date === endDate;
      }
      return false;
    });

    if (hasDuplicatePending) {
      return NextResponse.json(
        { error: "This leave request is already submitted and awaiting approval." },
        { status: 409 },
      );
    }

    const nowIso = new Date().toISOString();
    const newRequest = normalizeLeaveRequest({
      id: crypto.randomUUID(),
      employee_id: employeeId,
      employee_name: employeeName,
      position,
      leave_type: leaveType,
      pay_status: payStatus,
      start_date: startDate,
      end_date: endDate,
      reason,
      proof_url: proofUrl,
      status: "pending_admin",
      submitted_at: nowIso,
      decided_at: null,
      updated_at: nowIso,
    });

    const saved = await insertLeaveRequest(newRequest);
    return NextResponse.json({ success: true, request: saved }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });
  }
}
