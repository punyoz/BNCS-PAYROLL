import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { normalizeRole, normalizeRoleEmail, normalizeText } from "@/lib/auth/normalize";
import { attachSession } from "@/lib/rbac/session";

const roleRoutes = {
  super_admin: "/super-admin",
  admin: "/admin",
  accountant: "/accountant",
  employee: "/employee",
  hr: "/hr",
};

const ADMIN_USERNAME = normalizeText(process.env.SEED_ADMIN_USERNAME, "sacsadmin").toLowerCase();
const ADMIN_EMAIL = normalizeText(process.env.SEED_ADMIN_EMAIL, "admin@example.com");
const HR_USERNAME = normalizeText(process.env.SEED_HR_USERNAME, "sacshr").toLowerCase();
const HR_EMAIL = normalizeText(process.env.SEED_HR_EMAIL, "hr@example.com");
const SUPER_ADMIN_USERNAME = normalizeText(process.env.SEED_SUPER_ADMIN_USERNAME, "sacssuperadmin").toLowerCase();
const SUPER_ADMIN_EMAIL = normalizeText(process.env.SEED_SUPER_ADMIN_EMAIL, "superadmin@example.com");

const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function toTitleCaseWords(value) {
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) return "";

  return normalized
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function inferNameFromEmail(email) {
  const raw = normalizeText(email);
  const localPart = raw.includes("@") ? raw.split("@")[0] : raw;
  if (!localPart) return "";

  const cleaned = localPart.replace(/[._-]+/g, " ");
  return toTitleCaseWords(cleaned);
}

function normalizePositionForRole(positionInput, roleInput) {
  const role = normalizeRole(roleInput);
  const position = normalizeText(positionInput).toLowerCase();

  if (role === "accountant" || position === "accountant" || position.includes("account")) {
    return "Accountant";
  }

  return "Employee";
}

function resolveLoginEmail(identityInput) {
  const identity = normalizeText(identityInput);

  if (!identity) {
    return "";
  }

  const lowered = identity.toLowerCase();

  if (lowered === SUPER_ADMIN_USERNAME) {
    return normalizeRoleEmail(SUPER_ADMIN_EMAIL);
  }

  if (lowered === ADMIN_USERNAME) {
    return normalizeRoleEmail(ADMIN_EMAIL);
  }

  if (lowered === HR_USERNAME) {
    return normalizeRoleEmail(HR_EMAIL);
  }

  if (lowered.includes("@")) {
    return normalizeRoleEmail(identity);
  }

  return "";
}

export async function POST(request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    return NextResponse.json({ error: "Supabase env values are missing." }, { status: 500 });
  }

  const body = await request.json().catch(() => ({}));
  const identityInput = body?.employeeId || body?.username;
  const password = body?.password;

  if (!identityInput || !password) {
    return NextResponse.json({ error: "Login identity and password are required." }, { status: 400 });
  }

  const resolvedEmail = resolveLoginEmail(identityInput);
  if (!resolvedEmail) {
    return NextResponse.json({ error: "Use a valid username or email to sign in." }, { status: 400 });
  }

  const supabase = createClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const { data, error } = await supabase.auth.signInWithPassword({ email: resolvedEmail, password });

  if (error || !data?.user) {
    return NextResponse.json({ error: error?.message || "Invalid login credentials." }, { status: 401 });
  }

  if (data.user.user_metadata?.archived === true) {
    await supabase.auth.signOut();
    return NextResponse.json(
      { error: "This account has been archived and can no longer sign in." },
      { status: 403 },
    );
  }

  // Check the raw role string directly against the known routable roles —
  // do NOT go through normalizeRole() here, since it silently falls back to
  // "employee" for anything it doesn't recognize. That fallback is fine for
  // display/formatting purposes elsewhere, but here it would let an account
  // whose role has become momentarily unrecognized (e.g. a role renamed or
  // temporarily removed in code) log in *as a different role* instead of
  // being rejected — exactly the bug that once silently reassigned the
  // super_admin account to the employee portal.
  const actualRole = normalizeText(data.user.user_metadata?.role).toLowerCase();

  if (!actualRole || !Object.prototype.hasOwnProperty.call(roleRoutes, actualRole)) {
    await supabase.auth.signOut();
    return NextResponse.json(
      {
        error: `Could not determine valid role for account. Role is '${actualRole || "unknown"}'.`,
      },
      { status: 403 },
    );
  }

  await supabase.auth.signOut();

  const metadata = data.user.user_metadata || {};

  let profileRow = null;
  if (SERVICE_ROLE_KEY) {
    const adminClient = createClient(url, SERVICE_ROLE_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    const profileResult = await adminClient
      .from("profiles")
      .select("id,email,full_name,role,employee_id,employee_type,position,branch_id,cp_number,date_hired,address,sss_number,pagibig_number,philhealth_number,bank_name,bank_account_number")
      .eq("id", data.user.id)
      .maybeSingle();

    if (!profileResult.error) {
      profileRow = profileResult.data || null;
    }
  }

  const resolvedEmailOutput = normalizeText(profileRow?.email, normalizeText(data.user.email));
  const resolvedFullName = normalizeText(
    profileRow?.full_name,
    normalizeText(metadata.full_name, inferNameFromEmail(resolvedEmailOutput)),
  );
  const resolvedRole = normalizeRole(profileRow?.role || actualRole);
  const resolvedEmployeeId = normalizeText(profileRow?.employee_id, normalizeText(metadata.employee_id));
  const resolvedEmployeeType = normalizeText(profileRow?.employee_type, normalizeText(metadata.employee_type));
  const resolvedPosition = normalizeText(
    profileRow?.position,
    normalizeText(metadata.position, normalizePositionForRole(metadata.position, resolvedRole)),
  );

  // The branch this account is boxed inside. profiles.branch_id is the source
  // of truth (see supabase/migrations/20260903_rbac_branch_scoping.sql); the
  // auth metadata copy is only a fallback for accounts created before that
  // column existed. Super Admin is deliberately left null — it is branch-exempt.
  const resolvedBranchId = resolvedRole === "super_admin"
    ? null
    : normalizeText(profileRow?.branch_id, normalizeText(metadata.branch_id)) || null;

  const response = NextResponse.json({
    redirectTo: roleRoutes[resolvedRole],
    role: resolvedRole,
    profile: {
      role: resolvedRole,
      full_name: resolvedFullName,
      email: resolvedEmailOutput,
      employee_id: resolvedEmployeeId,
      employee_type: resolvedEmployeeType,
      position: resolvedPosition,
      branch_id: resolvedBranchId,
      // profiles is authoritative for these (real, constrained columns —
      // see supabase/migrations/20260914_profile_id_fields_and_perf.sql);
      // metadata is only a fallback for a profile row not yet backfilled.
      // This context feeds every role's own "Profile" self-view, so this is
      // the one place all of them read from.
      cp_number: normalizeText(profileRow?.cp_number, normalizeText(metadata.cp_number, "")),
      date_hired: normalizeText(profileRow?.date_hired, normalizeText(metadata.date_hired, "")),
      address: normalizeText(profileRow?.address, normalizeText(metadata.address, "")),
      sss_number: normalizeText(profileRow?.sss_number, normalizeText(metadata.sss_number, "")),
      pagibig_number: normalizeText(profileRow?.pagibig_number, normalizeText(metadata.pagibig_number, "")),
      philhealth_number: normalizeText(profileRow?.philhealth_number, normalizeText(metadata.philhealth_number, "")),
      bank_name: normalizeText(profileRow?.bank_name, normalizeText(metadata.bank_name, "")),
      bank_account_number: normalizeText(profileRow?.bank_account_number, normalizeText(metadata.bank_account_number, "")),
    },
  });

  // Issue the signed HttpOnly session every API guard reads. The response body
  // above still feeds localStorage for display, but authorization decisions are
  // made from this cookie alone, which the browser cannot forge or edit.
  return attachSession(response, {
    user_id: data.user.id,
    role: resolvedRole,
    branch_id: resolvedBranchId,
    email: resolvedEmailOutput,
    full_name: resolvedFullName,
  });
}
