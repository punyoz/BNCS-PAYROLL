import { listUsersCached, invalidateUsersCache } from "@/lib/auth/users-cache";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sanitizeError } from "@/lib/api-error";
import { normalizeRoleEmail, normalizeText } from "@/lib/auth/normalize";

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

function toTitleCaseWords(value) {
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) return "";

  return normalized
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

const ALLOWED_NAME_SUFFIXES = ["Jr.", "Sr.", "II", "III", "IV", "V"];

function normalizeSuffix(value) {
  return normalizeText(value).slice(0, 16);
}

function stripAllowedSuffix(fullName) {
  const tokens = String(fullName || "").trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return "";
  const last = tokens[tokens.length - 1];
  if (ALLOWED_NAME_SUFFIXES.includes(last)) {
    return tokens.slice(0, -1).join(" ");
  }
  return tokens.join(" ");
}

// Composes full_name from split first/middle/last/suffix fields when
// provided (the Edit Employee form's Name section); falls back to a plain
// full_name string otherwise.
function buildFullNameFromParts(body) {
  const first = toTitleCaseWords(body?.first_name);
  const middle = normalizeText(body?.middle_initial);
  const last = toTitleCaseWords(body?.last_name);
  const suffix = normalizeSuffix(body?.suffix);

  if (first && last) {
    return [first, middle, last, suffix].filter(Boolean).join(" ");
  }

  return normalizeText(body?.full_name);
}

function isValidEmployeeName(nameInput) {
  const withoutSuffix = stripAllowedSuffix(normalizeText(nameInput));
  return withoutSuffix.length > 0 && /^[A-Za-z\s]+$/.test(withoutSuffix);
}

function shapeEmployee(user, profile) {
  const meta = user.user_metadata || {};
  return {
    id: user.id,
    email: normalizeText(profile?.email, user.email),
    full_name: normalizeText(profile?.full_name, normalizeText(meta.full_name, user.email)),
    employee_id: normalizeText(meta.employee_id),
    role: normalizeText(meta.role, "employee"),
    employee_type: normalizeText(meta.employee_type, "Teaching"),
    position: normalizeText(meta.position, "Employee"),
    employee_status: normalizeText(meta.employee_status, "Active"),
    date_of_birth: normalizeText(meta.date_of_birth),
    archived: Boolean(meta.archived),
    created_at: user.created_at,
    address: normalizeText(meta.address, ""),
    sss_number: normalizeText(meta.sss_number, ""),
    pagibig_number: normalizeText(meta.pagibig_number, ""),
    philhealth_number: normalizeText(meta.philhealth_number, ""),
    bank_name: normalizeText(meta.bank_name, ""),
    bank_account_number: normalizeText(meta.bank_account_number, ""),
    // Live on profiles, not user_metadata (see
    // supabase/migrations/20260910_transfer_requests_and_employee_contact.sql).
    cp_number: normalizeText(profile?.cp_number, ""),
    date_hired: normalizeText(profile?.date_hired, ""),
    branch_id: profile?.branch_id || meta.branch_id || null,
  };
}

export async function GET(request) {
  try {
    const supabase = getAdminClient();
    const url = new URL(request.url);
    const includeArchived = url.searchParams.get("archived") === "true";

    const usersResult = await listUsersCached(supabase);
    if (usersResult.error) throw new Error(usersResult.error.message);

    const allUsers = usersResult.data.users || [];
    const employeeUsers = allUsers.filter((u) => {
      const role = String(u.user_metadata?.role || "employee").toLowerCase();
      return role === "employee" || role === "accountant";
    });

    const userIds = employeeUsers.map((u) => u.id);
    const profileMap = new Map();

    if (userIds.length) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id,email,full_name,employee_id,employee_type,position,employee_status,cp_number,date_hired,branch_id")
        .in("id", userIds);
      (profiles || []).forEach((p) => profileMap.set(p.id, p));
    }

    let employees = employeeUsers.map((u) => shapeEmployee(u, profileMap.get(u.id)));

    if (!includeArchived) {
      employees = employees.filter((e) => !e.archived);
    }

    employees.sort((a, b) => a.full_name.localeCompare(b.full_name));

    return NextResponse.json({ employees, total: employees.length });
  } catch (error) {
    return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });
  }
}

// HR can update employee identity/status/contact info, but never role or
// basic_salary — those stay Accountant/Admin-only, so this handler never
// reads body.role or body.basic_salary at all.
export async function PATCH(request) {
  try {
    const supabase = getAdminClient();
    const body = await request.json();
    const { id, employee_status, position, employee_type } = body;

    if (!id) {
      return NextResponse.json({ error: "Employee id is required." }, { status: 400 });
    }

    const { data: userData, error: fetchErr } = await supabase.auth.admin.getUserById(id);
    if (fetchErr || !userData?.user) {
      return NextResponse.json({ error: "Employee not found." }, { status: 404 });
    }

    const currentMeta = userData.user.user_metadata || {};
    const updatedMeta = { ...currentMeta };

    const hasNameParts = body.first_name !== undefined || body.last_name !== undefined;
    if (hasNameParts || body.full_name !== undefined) {
      const nextFullName = hasNameParts
        ? buildFullNameFromParts(body)
        : normalizeText(body.full_name, currentMeta.full_name);

      if (!isValidEmployeeName(nextFullName)) {
        return NextResponse.json(
          { error: "Full name must contain letters and spaces only." },
          { status: 400 },
        );
      }
      updatedMeta.full_name = nextFullName;
    }

    if (body.date_of_birth !== undefined) updatedMeta.date_of_birth = normalizeText(body.date_of_birth, currentMeta.date_of_birth);
    if (employee_status !== undefined) updatedMeta.employee_status = normalizeText(employee_status, currentMeta.employee_status);
    if (position !== undefined) updatedMeta.position = normalizeText(position, currentMeta.position);
    if (employee_type !== undefined) updatedMeta.employee_type = normalizeText(employee_type, currentMeta.employee_type);
    if (body.address !== undefined) updatedMeta.address = normalizeText(body.address, normalizeText(currentMeta.address, ""));
    if (body.sss_number !== undefined) updatedMeta.sss_number = normalizeText(body.sss_number, normalizeText(currentMeta.sss_number, ""));
    if (body.pagibig_number !== undefined) updatedMeta.pagibig_number = normalizeText(body.pagibig_number, normalizeText(currentMeta.pagibig_number, ""));
    if (body.philhealth_number !== undefined) updatedMeta.philhealth_number = normalizeText(body.philhealth_number, normalizeText(currentMeta.philhealth_number, ""));
    if (body.bank_name !== undefined) updatedMeta.bank_name = normalizeText(body.bank_name, normalizeText(currentMeta.bank_name, ""));
    if (body.bank_account_number !== undefined) updatedMeta.bank_account_number = normalizeText(body.bank_account_number, normalizeText(currentMeta.bank_account_number, ""));
    if (body.cp_number !== undefined) updatedMeta.cp_number = normalizeText(body.cp_number, "");
    if (body.date_hired !== undefined) updatedMeta.date_hired = normalizeText(body.date_hired, "");

    const nextEmail = body.email !== undefined
      ? normalizeRoleEmail(normalizeText(body.email, userData.user.email))
      : undefined;

    const updatePayload = { user_metadata: updatedMeta };
    if (nextEmail) updatePayload.email = nextEmail;

    const { error: updateErr } = await supabase.auth.admin.updateUserById(id, updatePayload);
    if (updateErr) throw new Error(updateErr.message);

    invalidateUsersCache();

    // Sync profile table
    const profilePatch = {};
    if (updatedMeta.full_name !== undefined) profilePatch.full_name = updatedMeta.full_name;
    if (nextEmail) profilePatch.email = nextEmail;
    if (employee_type !== undefined) profilePatch.employee_type = normalizeText(employee_type);
    if (position !== undefined) profilePatch.position = normalizeText(position);
    // profiles is authoritative for these two (employee_info_view reads from
    // profiles, not user_metadata) — only touch them when supplied.
    if (body.cp_number !== undefined) profilePatch.cp_number = normalizeText(body.cp_number, "") || null;
    if (body.date_hired !== undefined) profilePatch.date_hired = normalizeText(body.date_hired, "") || null;
    if (Object.keys(profilePatch).length) {
      await supabase.from("profiles").update(profilePatch).eq("id", id);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });
  }
}
