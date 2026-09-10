import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sanitizeError } from "@/lib/api-error";
import { normalizeText } from "@/lib/auth/normalize";
import { appendAuditLog } from "@/lib/audit/store";
import { readSession } from "@/lib/rbac/session";
import { requirePermission } from "@/lib/rbac/guard";
import { can, isBranchExempt } from "@/lib/rbac/permissions";

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

function shapeBranch(row) {
  return {
    id: row.id,
    name: normalizeText(row.name),
    location: normalizeText(row.location),
    code: normalizeText(row.code),
    status: normalizeText(row.status, "Active"),
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
  };
}

export async function GET(request) {
  // Reading the branch list is a label lookup, not Branch Management — every
  // branch-scoped role needs at least its own branch's name somewhere in the
  // UI. Whether a role sees OTHER branches too depends on whether it can act
  // on transfer_requests (see canSeeAllBranches below). Creating, editing and
  // closing branches (below) stays Super Admin exclusive regardless.
  const session = readSession(request);
  if (!session) {
    return NextResponse.json(
      { error: "Your session has expired. Please sign in again." },
      { status: 401 },
    );
  }

  try {
    const supabase = getAdminClient();
    const result = await supabase
      .from("branches")
      .select("*")
      .order("created_at", { ascending: true });

    if (result.error) {
      return NextResponse.json({ error: sanitizeError(result.error) }, { status: 500 });
    }

    const rows = (result.data || []).map(shapeBranch);

    // Super Admin always sees every branch. A branch-scoped role sees every
    // branch ONLY if it can act on transfer_requests (currently just Admin):
    // that's the one legitimate reason a branch-scoped role needs to see a
    // branch other than its own here — picking a transfer destination in the
    // "New Transfer Request" modal. Every other branch-scoped role (HR,
    // Accountant, Employee) stays limited to its own branch, matching this
    // endpoint's original label-lookup purpose.
    const canSeeAllBranches = isBranchExempt(session.role) || can(session.role, "transfer_requests", "create");
    const visible = canSeeAllBranches
      ? rows
      : rows.filter((b) => String(b.id) === String(session.branch_id || ""));

    return NextResponse.json({ branches: visible });
  } catch (error) {
    return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });
  }
}

export async function POST(request) {
  const guard = await requirePermission(request, "branch_management", "create");
  if (guard.denied) return guard.denied;

  try {
    const body = await request.json();
    const name = normalizeText(body.name);
    const location = normalizeText(body.location);
    const code = normalizeText(body.code);
    const status = normalizeText(body.status, "Active");

    if (!name) {
      return NextResponse.json({ error: "Branch name is required." }, { status: 400 });
    }
    if (!location) {
      return NextResponse.json({ error: "Branch location is required." }, { status: 400 });
    }

    const supabase = getAdminClient();
    const result = await supabase
      .from("branches")
      .insert({ name, location, code: code || null, status, updated_at: new Date().toISOString() })
      .select("*")
      .maybeSingle();

    if (result.error) {
      return NextResponse.json({ error: sanitizeError(result.error) }, { status: 400 });
    }

    await appendAuditLog({
      module: "branches",
      action: "create",
      entity_type: "branch",
      entity_id: result.data?.id,
      description: `Branch "${name}" was created.`,
      status: "success",
      source: "api",
      metadata: { name, location, code, status },
    });

    return NextResponse.json({ branch: shapeBranch(result.data) }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });
  }
}

export async function PATCH(request) {
  const guard = await requirePermission(request, "branch_management", "update");
  if (guard.denied) return guard.denied;

  try {
    const body = await request.json();
    const id = normalizeText(body.id);

    if (!id) {
      return NextResponse.json({ error: "Branch id is required." }, { status: 400 });
    }

    const supabase = getAdminClient();
    const existing = await supabase.from("branches").select("*").eq("id", id).maybeSingle();
    if (existing.error || !existing.data) {
      return NextResponse.json({ error: "Branch not found." }, { status: 404 });
    }

    const name = normalizeText(body.name, existing.data.name);
    const location = normalizeText(body.location, existing.data.location);
    const code = body.code !== undefined ? normalizeText(body.code) : existing.data.code;
    const status = normalizeText(body.status, existing.data.status);

    if (!name) return NextResponse.json({ error: "Branch name is required." }, { status: 400 });
    if (!location) return NextResponse.json({ error: "Branch location is required." }, { status: 400 });

    const result = await supabase
      .from("branches")
      .update({ name, location, code: code || null, status, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("*")
      .maybeSingle();

    if (result.error) {
      return NextResponse.json({ error: sanitizeError(result.error) }, { status: 400 });
    }

    await appendAuditLog({
      module: "branches",
      action: "update",
      entity_type: "branch",
      entity_id: id,
      description: `Branch "${name}" was updated.`,
      status: "success",
      source: "api",
      metadata: { name, location, code, status },
    });

    return NextResponse.json({ branch: shapeBranch(result.data) });
  } catch (error) {
    return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });
  }
}

export async function DELETE(request) {
  const guard = await requirePermission(request, "branch_management", "delete");
  if (guard.denied) return guard.denied;

  try {
    const { searchParams } = new URL(request.url);
    const id = normalizeText(searchParams.get("id"));

    if (!id) {
      return NextResponse.json({ error: "Branch id is required." }, { status: 400 });
    }

    const supabase = getAdminClient();
    const existing = await supabase.from("branches").select("name").eq("id", id).maybeSingle();
    if (existing.error || !existing.data) {
      return NextResponse.json({ error: "Branch not found." }, { status: 404 });
    }

    const result = await supabase.from("branches").delete().eq("id", id);
    if (result.error) {
      return NextResponse.json({ error: sanitizeError(result.error) }, { status: 400 });
    }

    await appendAuditLog({
      module: "branches",
      action: "delete",
      entity_type: "branch",
      entity_id: id,
      description: `Branch "${existing.data.name}" was deleted.`,
      status: "success",
      source: "api",
      metadata: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });
  }
}
