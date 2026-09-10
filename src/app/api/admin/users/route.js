import { listUsersCached, invalidateUsersCache } from "@/lib/auth/users-cache";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sanitizeError } from "@/lib/api-error";
import { normalizeRole, normalizeRoleEmail, normalizeText } from "@/lib/auth/normalize";
import { appendAuditLog } from "@/lib/audit/store";
import {
  requirePermission,
  denyRoleEscalation,
  denyForeignBranch,
  scopeListToBranch,
} from "@/lib/rbac/guard";

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

function shapeUser(user, profile) {
  const metadata = user.user_metadata || {};
  const role = normalizeRole(metadata.role);
  return {
    id: user.id,
    email: normalizeText(profile?.email, user.email),
    full_name: normalizeText(profile?.full_name, normalizeText(metadata.full_name, user.email)),
    role,
    employee_id: normalizeText(metadata.employee_id, ""),
    branch_id: profile?.branch_id || metadata.branch_id || null,
    archived: Boolean(metadata.archived),
    last_sign_in: user.last_sign_in_at || null,
    created_at: user.created_at || null,
    // Live on profiles, not user_metadata (see
    // supabase/migrations/20260910_transfer_requests_and_employee_contact.sql).
    // Displayed on the merged employee table; not editable from this route's
    // own modal (sa-admin-user-modal covers account fields only).
    cp_number: normalizeText(profile?.cp_number, ""),
    date_hired: normalizeText(profile?.date_hired, ""),
  };
}

/**
 * The branch a user belongs to, read from profiles first (the source of truth
 * since 20260903_rbac_branch_scoping.sql) and falling back to auth metadata for
 * accounts created before that column existed.
 */
async function fetchUserBranch(supabase, userId, metadata) {
  const profileResult = await supabase
    .from("profiles")
    .select("branch_id,role")
    .eq("id", userId)
    .maybeSingle();

  if (!profileResult.error && profileResult.data?.branch_id) {
    return profileResult.data.branch_id;
  }
  return metadata?.branch_id || null;
}

async function fetchAllUsers(supabase) {
  const usersResult = await listUsersCached(supabase);
  if (usersResult.error) {
    throw new Error(`Failed to list users: ${usersResult.error.message}`);
  }

  const users = usersResult.data.users || [];
  const userIds = users.map((u) => u.id);
  const profileMap = new Map();

  if (userIds.length) {
    const profileResult = await supabase
      .from("profiles")
      .select("id,email,full_name,role,branch_id,cp_number,date_hired")
      .in("id", userIds);

    if (!profileResult.error) {
      (profileResult.data || []).forEach((p) => profileMap.set(p.id, p));
    }
  }

  return users
    .map((user) => shapeUser(user, profileMap.get(user.id)))
    .sort((a, b) => a.full_name.localeCompare(b.full_name));
}

export async function GET(request) {
  const guard = await requirePermission(request, "user_management", "read");
  if (guard.denied) return guard.denied;

  try {
    const supabase = getAdminClient();
    const users = await fetchAllUsers(supabase);

    // Branch-scoped roles see only their own branch's accounts, and never the
    // admin / super_admin accounts they are not allowed to manage.
    const visible = guard.branchExempt
      ? users
      : scopeListToBranch(users, guard, (u) => u.branch_id)
          .filter((u) => !["admin", "super_admin"].includes(u.role));

    return NextResponse.json({ users: visible });
  } catch (error) {
    return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });
  }
}

export async function POST(request) {
  const guard = await requirePermission(request, "user_management", "create");
  if (guard.denied) return guard.denied;

  try {
    const body = await request.json();
    const role = normalizeRole(body.role);
    const email = normalizeRoleEmail(body.email);
    const fullName = normalizeText(body.full_name);
    const password = normalizeText(body.password);

    // An Admin may create HR / Accountant / Employee accounts only. Minting an
    // admin or super_admin — the privilege-escalation path — stops here.
    const escalation = denyRoleEscalation(guard, role);
    if (escalation) return escalation;

    // The new account is pinned to the creator's own branch; a branch-scoped
    // caller cannot plant a user in someone else's branch.
    const branchId = guard.branchExempt
      ? (normalizeText(body.branch_id) || null)
      : guard.branchId;

    if (!guard.branchExempt) {
      const foreign = denyForeignBranch(guard, normalizeText(body.branch_id));
      if (foreign) return foreign;
    }

    if (!email || !fullName || !password) {
      return NextResponse.json(
        { error: "full_name, email, and password are required." },
        { status: 400 },
      );
    }

    if (password.length < 6) {
      return NextResponse.json(
        { error: "Password must be at least 6 characters." },
        { status: 400 },
      );
    }

    const supabase = getAdminClient();
    const metadata = {
      role,
      full_name: fullName,
      archived: false,
      branch_id: branchId,
    };

    const createResult = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: metadata,
    });

    if (createResult.error) {
      return NextResponse.json({ error: sanitizeError(createResult.error) }, { status: 400 });
    }

    invalidateUsersCache();

    const newUser = createResult.data.user;
    const profileResult = await supabase.from("profiles").upsert(
      { id: newUser.id, email, role, full_name: fullName, branch_id: branchId },
      { onConflict: "id" },
    );

    // The auth account already exists at this point either way — surfacing
    // this loudly (instead of the previous silent failure) is what actually
    // matters: a profiles-less account can't be the subject or actor of
    // anything that references profiles by foreign key (e.g. transfer
    // requests), and that failure mode is much harder to diagnose later.
    if (profileResult.error) {
      return NextResponse.json(
        { error: `Account created, but its profile record failed: ${sanitizeError(profileResult.error)}` },
        { status: 500 },
      );
    }

    await appendAuditLog({
      module: "users",
      action: "create",
      entity_type: "user",
      entity_id: newUser.id,
      description: `User ${fullName} (${role}) was created by admin.`,
      status: "success",
      source: "api",
      metadata: { user_id: newUser.id, role, email },
    });

    return NextResponse.json(
      { user: shapeUser(newUser, { email, full_name: fullName, role }) },
      { status: 201 },
    );
  } catch (error) {
    return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });
  }
}

export async function PATCH(request) {
  const body = await request.json().catch(() => ({}));
  const requestedAction = normalizeText(body.action, "update").toLowerCase();

  // Archiving is the matrix's "delete"; everything else on this route is an
  // update. Ask for the permission that actually matches the intent.
  const guard = await requirePermission(
    request,
    "user_management",
    requestedAction === "archive" ? "delete" : "update",
  );
  if (guard.denied) return guard.denied;

  try {
    const id = normalizeText(body.id);
    const action = requestedAction;

    if (!id) {
      return NextResponse.json({ error: "User id is required." }, { status: 400 });
    }

    const supabase = getAdminClient();
    const userResult = await supabase.auth.admin.getUserById(id);
    if (userResult.error || !userResult.data?.user) {
      return NextResponse.json({ error: "User not found." }, { status: 404 });
    }

    const existingUser = userResult.data.user;
    const currentMetadata = existingUser.user_metadata || {};

    // Two separate checks, because privilege escalation can come from either
    // direction: editing an account that already outranks the caller, or
    // promoting a low-privilege account into one that does.
    const currentRole = normalizeRole(currentMetadata.role);
    const escalationOnTarget = denyRoleEscalation(guard, currentRole);
    if (escalationOnTarget) return escalationOnTarget;

    if (action === "update" && body.role) {
      const escalationOnNewRole = denyRoleEscalation(guard, normalizeRole(body.role));
      if (escalationOnNewRole) return escalationOnNewRole;
    }

    // ...and the target must live in the caller's own branch. An account with
    // no branch on file is refused rather than allowed through: a branch-scoped
    // caller has no claim on a record it cannot place.
    const targetBranch = await fetchUserBranch(supabase, id, currentMetadata);
    if (!guard.branchExempt && !targetBranch) {
      return NextResponse.json(
        { error: "That account is not assigned to your branch." },
        { status: 403 },
      );
    }
    const foreign = denyForeignBranch(guard, targetBranch);
    if (foreign) return foreign;

    const nextMetadata = { ...currentMetadata };

    if (action === "archive") {
      nextMetadata.archived = true;
    } else if (action === "restore") {
      nextMetadata.archived = false;
    } else {
      nextMetadata.role = normalizeRole(body.role || currentMetadata.role);
      nextMetadata.full_name = normalizeText(
        body.full_name,
        normalizeText(currentMetadata.full_name, existingUser.email),
      );
    }

    const updatePayload = { user_metadata: nextMetadata };

    if (action === "update") {
      const email = normalizeRoleEmail(normalizeText(body.email, existingUser.email));
      if (email) updatePayload.email = email;
      const password = normalizeText(body.password);
      if (password) {
        if (password.length < 6) {
          return NextResponse.json(
            { error: "Password must be at least 6 characters." },
            { status: 400 },
          );
        }
        updatePayload.password = password;
      }
    }

    const updatedResult = await supabase.auth.admin.updateUserById(id, updatePayload);
    if (updatedResult.error) {
      return NextResponse.json({ error: sanitizeError(updatedResult.error) }, { status: 400 });
    }

    invalidateUsersCache();

    if (action === "update") {
      const email = updatePayload.email || existingUser.email;
      const profileResult = await supabase.from("profiles").upsert(
        { id, email, role: nextMetadata.role, full_name: nextMetadata.full_name },
        { onConflict: "id" },
      );
      if (profileResult.error) {
        return NextResponse.json(
          { error: `Account updated, but its profile record failed: ${sanitizeError(profileResult.error)}` },
          { status: 500 },
        );
      }
    }

    const updatedUser = updatedResult.data.user;
    await appendAuditLog({
      module: "users",
      action,
      entity_type: "user",
      entity_id: id,
      description: `User ${nextMetadata.full_name || existingUser.email} was ${action}d by admin.`,
      status: "success",
      source: "api",
      metadata: { user_id: id, role: nextMetadata.role, action },
    });

    return NextResponse.json({
      user: shapeUser(updatedUser, {
        email: updatePayload.email || existingUser.email,
        full_name: nextMetadata.full_name,
        role: nextMetadata.role,
      }),
    });
  } catch (error) {
    return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });
  }
}
