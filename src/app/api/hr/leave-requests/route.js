import { NextResponse } from "next/server";
import { readAllLeaveRequests, updateLeaveRequestStatus } from "@/lib/leave-requests/store";
import { sanitizeError } from "@/lib/api-error";

export async function GET(request) {
  try {
    const url = new URL(request.url);
    const status = String(url.searchParams.get("status") || "pending").trim().toLowerCase();

    const allRequests = await readAllLeaveRequests();
    // pending_accountant is a legacy status from before Leave Approval moved to HR —
    // treat it the same as pending_admin so any request stuck in that state (submitted
    // before this fix) still surfaces here instead of being invisible.
    const pending = allRequests.filter(
      (r) => r.status === "pending_admin" || r.status === "pending_accountant",
    );
    const history = allRequests.filter(
      (r) => r.status !== "pending_admin" && r.status !== "pending_accountant",
    );

    let requests;
    if (status === "all") {
      requests = allRequests;
    } else if (status === "history") {
      requests = history;
    } else if (status === "pending") {
      requests = pending;
    } else {
      requests = allRequests.filter((r) => r.status === status);
    }

    return NextResponse.json({
      requests,
      pending_requests: pending,
      history_requests: history,
      generated_at: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });
  }
}

export async function PATCH(request) {
  try {
    const body = await request.json();
    const id = String(body.id || "").trim();
    const action = String(body.action || "").trim().toLowerCase();

    if (!id) return NextResponse.json({ error: "id is required." }, { status: 400 });
    if (action !== "approve" && action !== "reject") {
      return NextResponse.json({ error: "action must be approve or reject." }, { status: 400 });
    }

    const allRequests = await readAllLeaveRequests();
    const current = allRequests.find((r) => r.id === id);

    if (!current) {
      return NextResponse.json({ error: "Leave request not found." }, { status: 404 });
    }

    if (current.status !== "pending_admin" && current.status !== "pending_accountant") {
      return NextResponse.json(
        { error: `Cannot ${action} a leave request with status: ${current.status}.` },
        { status: 409 },
      );
    }

    const newStatus = action === "approve" ? "approved" : "rejected";
    await updateLeaveRequestStatus(id, newStatus, { decided_by: "hr", decided_at: new Date().toISOString() });

    return NextResponse.json({ success: true, new_status: newStatus });
  } catch (error) {
    return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });
  }
}
