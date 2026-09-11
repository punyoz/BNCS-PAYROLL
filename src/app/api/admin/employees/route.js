import { listUsersCached, invalidateUsersCache } from "@/lib/auth/users-cache";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sanitizeError } from "@/lib/api-error";
import { normalizeRole, normalizeRoleEmail, normalizeText, normalizeDigits } from "@/lib/auth/normalize";
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
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function buildEmployeeId(currentCount = 0) {
  const next = currentCount + 1;
  return `SACS-${String(next).padStart(3, "0")}`;
}

function parseEmployeeIdNumber(employeeId) {
  const match = /^SACS-(\d+)$/i.exec(String(employeeId || "").trim());
  if (!match) return null;
  return Number(match[1]);
}

function generateUniqueEmployeeId(existingEmployees = []) {
  const used = new Set();
  let max = 0;

  existingEmployees.forEach((employee) => {
    const normalized = normalizeText(employee.employee_id).toUpperCase();
    if (!normalized) return;
    used.add(normalized);

    const parsed = parseEmployeeIdNumber(normalized);
    if (parsed && parsed > max) {
      max = parsed;
    }
  });

  let next = max + 1;
  let candidate = `SACS-${String(next).padStart(3, "0")}`;

  while (used.has(candidate.toUpperCase())) {
    next += 1;
    candidate = `SACS-${String(next).padStart(3, "0")}`;
  }

  return candidate;
}

function normalizePositionForRole(positionInput, roleInput) {
  const role = normalizeRole(roleInput);
  const position = normalizeText(positionInput).toLowerCase();

  if (role === "accountant" || position === "accountant" || position.includes("account")) {
    return "Accountant";
  }

  if (role === "hr" || position === "hr officer" || position.includes("hr officer")) {
    return "HR Officer";
  }

  return "Employee";
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

function formatDateOfBirthForPassword(dateInput) {
  const raw = normalizeText(dateInput);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!match) return "";

  const [, year, month, day] = match;
  return `${month}${day}${year}`;
}

function buildDefaultPassword(lastNameInput, dateOfBirthInput) {
  const lastName = toTitleCaseWords(lastNameInput).replace(/\s+/g, "");
  const dobDigits = formatDateOfBirthForPassword(dateOfBirthInput);
  if (!lastName || !dobDigits) return "";

  return `${lastName}${dobDigits}`;
}

function shapeEmployee(user, profile, index) {
  const metadata = user.user_metadata || {};
  const fullName = normalizeText(profile?.full_name, normalizeText(metadata.full_name, user.email));
  const role = normalizeRole(metadata.role);
  const employeeStatus = normalizeText(
    metadata.employee_status,
    normalizeText(metadata.rfid_status, "Active"),
  );

  return {
    id: user.id,
    role,
    email: normalizeText(profile?.email, user.email),
    full_name: fullName,
    employee_id: normalizeText(metadata.employee_id, buildEmployeeId(index)),
    branch_id: profile?.branch_id || metadata.branch_id || null,
    employee_type: normalizeText(metadata.employee_type, "Teaching"),
    position: normalizePositionForRole(metadata.position, role),
    basic_salary: Number(metadata.basic_salary || 0),
    rfid_status: normalizeText(metadata.rfid_status, "Active"),
    employee_status: employeeStatus,
    employment_status: normalizeText(metadata.employment_status, "Regular"),
    archived: Boolean(metadata.archived),
    date_of_birth: normalizeText(metadata.date_of_birth, ""),
    // profiles is now authoritative for these (real, constrained columns —
    // see supabase/migrations/20260914_profile_id_fields_and_perf.sql);
    // metadata is only a fallback for a profile row not yet backfilled.
    address: normalizeText(profile?.address, normalizeText(metadata.address, "")),
    sss_number: normalizeText(profile?.sss_number, normalizeText(metadata.sss_number, "")),
    pagibig_number: normalizeText(profile?.pagibig_number, normalizeText(metadata.pagibig_number, "")),
    philhealth_number: normalizeText(profile?.philhealth_number, normalizeText(metadata.philhealth_number, "")),
    bank_name: normalizeText(profile?.bank_name, normalizeText(metadata.bank_name, "")),
    bank_account_number: normalizeText(profile?.bank_account_number, normalizeText(metadata.bank_account_number, "")),
    // Live on profiles, not user_metadata (see
    // supabase/migrations/20260910_transfer_requests_and_employee_contact.sql).
    cp_number: normalizeText(profile?.cp_number, ""),
    date_hired: normalizeText(profile?.date_hired, ""),
  };
}

/**
 * The branch an employee belongs to. profiles.branch_id is authoritative (see
 * supabase/migrations/20260903_rbac_branch_scoping.sql); auth metadata is the
 * fallback for accounts created before that column existed.
 */
async function fetchEmployeeBranch(supabase, userId, metadata) {
  const profileResult = await supabase
    .from("profiles")
    .select("branch_id")
    .eq("id", userId)
    .maybeSingle();

  if (!profileResult.error && profileResult.data?.branch_id) {
    return profileResult.data.branch_id;
  }
  return metadata?.branch_id || null;
}

async function fetchEmployees(supabase) {
  const usersResult = await listUsersCached(supabase);
  if (usersResult.error) {
    throw new Error(`Failed to list users: ${usersResult.error.message}`);
  }

  const employeeUsers = (usersResult.data.users || []).filter((user) => {
    const role = String(user.user_metadata?.role || "employee").toLowerCase();
    return role === "employee" || role === "accountant" || role === "hr";
  });

  const userIds = employeeUsers.map((user) => user.id);
  const profileMap = new Map();

  if (userIds.length) {
    const profileResult = await supabase
      .from("profiles")
      .select("id,email,full_name,role,branch_id,cp_number,date_hired,address,sss_number,pagibig_number,philhealth_number,bank_name,bank_account_number")
      .in("id", userIds);

    // Degrade to auth-metadata-only (matching /api/admin/users and
    // /api/hr/employees) instead of failing the whole list — this keeps
    // Admin's employee table working even mid-deploy, before
    // 20260914_profile_id_fields_and_perf.sql has been run against a given
    // environment, rather than a missing column taking the page down.
    if (profileResult.error) {
      console.error("Failed to fetch profiles:", profileResult.error.message);
    } else {
      (profileResult.data || []).forEach((profile) => {
        profileMap.set(profile.id, profile);
      });
    }
  }

  return employeeUsers
    .map((user, index) => shapeEmployee(user, profileMap.get(user.id), index))
    .sort((a, b) => a.full_name.localeCompare(b.full_name));
}

export async function GET(request) {
  const guard = await requirePermission(request, "employee_information", "read");
  if (guard.denied) return guard.denied;

  try {
    const supabase = getAdminClient();
    const employees = await fetchEmployees(supabase);

    // Super Admin sees every branch; everyone else only their own.
    return NextResponse.json({
      employees: scopeListToBranch(employees, guard, (e) => e.branch_id),
    });
  } catch (error) {
    return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });
  }
}

export async function POST(request) {
  const guard = await requirePermission(request, "employee_information", "create");
  if (guard.denied) return guard.denied;

  try {
    const body = await request.json();
    const role = normalizeRole(body.role);

    // The account being created must sit at or below the caller's ceiling —
    // an Admin can add HR / Accountant / Employee staff, never another Admin.
    const escalation = denyRoleEscalation(guard, role);
    if (escalation) return escalation;

    // New staff land in the caller's own branch. Only Super Admin may name a
    // branch explicitly, since only Super Admin can reach more than one.
    const branchId = guard.branchExempt
      ? (normalizeText(body.branch_id) || null)
      : guard.branchId;

    const foreignBranch = denyForeignBranch(guard, normalizeText(body.branch_id));
    if (foreignBranch) return foreignBranch;
    const email = normalizeRoleEmail(body.email);
    const defaultPassword = buildDefaultPassword(body.last_name, body.date_of_birth);
    const password = normalizeText(body.password, defaultPassword);
    const fullName = buildFullNameFromParts(body);
    const dateOfBirth = normalizeText(body.date_of_birth);

    if (!email || !password || !fullName || !dateOfBirth) {
      return NextResponse.json(
        { error: "full_name, email, and date_of_birth are required." },
        { status: 400 },
      );
    }

    if (!defaultPassword) {
      return NextResponse.json(
        { error: "Default password could not be generated. Check last name and date of birth." },
        { status: 400 },
      );
    }

    if (!isValidEmployeeName(fullName)) {
      return NextResponse.json(
        { error: "Full name must contain letters and spaces only." },
        { status: 400 },
      );
    }

    const supabase = getAdminClient();
    const employeesBefore = await fetchEmployees(supabase);
    const autoEmployeeId = generateUniqueEmployeeId(employeesBefore);

    const metadata = {
      role,
      full_name: fullName,
      branch_id: branchId,
      employee_id: autoEmployeeId,
      employee_type: normalizeText(body.employee_type, "Teaching"),
      position: normalizePositionForRole(body.position, role),
      basic_salary: Number(body.basic_salary || 0),
      date_of_birth: dateOfBirth,
      rfid_status: normalizeText(body.employee_status, "Active"),
      employee_status: normalizeText(body.employee_status, "Active"),
      employment_status: "Regular",
      archived: false,
      address: normalizeText(body.address, ""),
      sss_number: normalizeText(body.sss_number, ""),
      pagibig_number: normalizeText(body.pagibig_number, ""),
      philhealth_number: normalizeText(body.philhealth_number, ""),
      bank_name: normalizeText(body.bank_name, ""),
      bank_account_number: normalizeText(body.bank_account_number, ""),
    };

    const createUserResult = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: metadata,
    });

    if (createUserResult.error) {
      return NextResponse.json({ error: sanitizeError(createUserResult.error) }, { status: 400 });
    }

    invalidateUsersCache();

    const newUser = createUserResult.data.user;
    const profileResult = await supabase.from("profiles").upsert(
      {
        id: newUser.id,
        email,
        role,
        full_name: fullName,
        branch_id: branchId,
        cp_number: normalizeText(body.cp_number, "") || null,
        date_hired: normalizeText(body.date_hired, "") || null,
        address: normalizeText(body.address, "") || null,
        sss_number: normalizeDigits(body.sss_number, 10) || null,
        pagibig_number: normalizeDigits(body.pagibig_number, 12) || null,
        philhealth_number: normalizeDigits(body.philhealth_number, 12) || null,
        bank_name: normalizeText(body.bank_name, "") || null,
        bank_account_number: normalizeDigits(body.bank_account_number, 20) || null,
      },
      {
        onConflict: "id",
      },
    );

    if (profileResult.error) {
      return NextResponse.json({ error: sanitizeError(profileResult.error) }, { status: 400 });
    }

    const employee = shapeEmployee(newUser, {
      id: newUser.id,
      email,
      full_name: fullName,
      role,
      cp_number: normalizeText(body.cp_number, ""),
      date_hired: normalizeText(body.date_hired, ""),
      address: normalizeText(body.address, ""),
      sss_number: normalizeDigits(body.sss_number, 10),
      pagibig_number: normalizeDigits(body.pagibig_number, 12),
      philhealth_number: normalizeDigits(body.philhealth_number, 12),
      bank_name: normalizeText(body.bank_name, ""),
      bank_account_number: normalizeDigits(body.bank_account_number, 20),
    }, employeesBefore.length);

    await appendAuditLog({
      module: "employees",
      action: "create",
      entity_type: "employee",
      entity_id: employee.employee_id,
      description: `Employee ${employee.full_name} was created by admin.`,
      status: "success",
      source: "api",
      metadata: {
        user_id: employee.id,
        role: employee.role,
        employee_type: employee.employee_type,
      },
    });

    return NextResponse.json({ employee }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });
  }
}

export async function PATCH(request) {
  const body = await request.json().catch(() => ({}));
  const requestedAction = normalizeText(body.action, "update").toLowerCase();

  // "archive" is the matrix's delete; anything else here is an update.
  const guard = await requirePermission(
    request,
    "employee_information",
    requestedAction === "archive" ? "delete" : "update",
  );
  if (guard.denied) return guard.denied;

  try {
    const id = normalizeText(body.id);
    const action = requestedAction;

    if (!id) {
      return NextResponse.json({ error: "Employee id is required." }, { status: 400 });
    }

    const supabase = getAdminClient();
    const listResult = await listUsersCached(supabase);

    if (listResult.error) {
      return NextResponse.json({ error: sanitizeError(listResult.error) }, { status: 400 });
    }

    const existingUser = (listResult.data.users || []).find((user) => user.id === id);
    if (!existingUser) {
      return NextResponse.json({ error: "Employee not found." }, { status: 404 });
    }

    const currentMetadata = existingUser.user_metadata || {};
    const currentRole = normalizeRole(currentMetadata.role);
    const nextRole = action === "update"
      ? normalizeRole(body.role || currentRole)
      : currentRole;

    // Escalation can come from either end: editing an account that already
    // outranks the caller, or promoting one into a rank the caller cannot hold.
    const escalationOnTarget = denyRoleEscalation(guard, currentRole);
    if (escalationOnTarget) return escalationOnTarget;

    const escalationOnNewRole = denyRoleEscalation(guard, nextRole);
    if (escalationOnNewRole) return escalationOnNewRole;

    // ...and the record has to be in the caller's own branch.
    const targetBranch = await fetchEmployeeBranch(supabase, id, currentMetadata);
    if (!guard.branchExempt && !targetBranch) {
      return NextResponse.json(
        { error: "That employee is not assigned to your branch." },
        { status: 403 },
      );
    }
    const foreignBranch = denyForeignBranch(guard, targetBranch);
    if (foreignBranch) return foreignBranch;
    const nextMetadata = {
      ...currentMetadata,
      role: nextRole,
    };

    if (action === "archive") {
      nextMetadata.archived = true;
    } else if (action === "restore") {
      nextMetadata.archived = false;
    } else {
      const currentEmployeeId = normalizeText(currentMetadata.employee_id, "");
      if (!currentEmployeeId) {
        return NextResponse.json({ error: "Employee ID is required." }, { status: 400 });
      }

      nextMetadata.full_name = normalizeText(body.full_name, normalizeText(currentMetadata.full_name, existingUser.email));

      if (!isValidEmployeeName(nextMetadata.full_name)) {
        return NextResponse.json(
          { error: "Full name must contain letters and spaces only." },
          { status: 400 },
        );
      }

      nextMetadata.employee_id = currentEmployeeId;
      nextMetadata.employee_type = normalizeText(body.employee_type, normalizeText(currentMetadata.employee_type, "Teaching"));
      nextMetadata.position = normalizePositionForRole(body.position, nextRole);
      nextMetadata.basic_salary = Number(body.basic_salary ?? currentMetadata.basic_salary ?? 0);
      nextMetadata.employee_status = normalizeText(
        body.employee_status,
        normalizeText(currentMetadata.employee_status, normalizeText(currentMetadata.rfid_status, "Active")),
      );
      nextMetadata.rfid_status = nextMetadata.employee_status;
      if (body.date_of_birth !== undefined) {
        nextMetadata.date_of_birth = normalizeText(body.date_of_birth, normalizeText(currentMetadata.date_of_birth, ""));
      }
      if (typeof currentMetadata.archived !== "boolean") {
        nextMetadata.archived = false;
      }
      if (body.address !== undefined) nextMetadata.address = normalizeText(body.address, normalizeText(currentMetadata.address, ""));
      if (body.sss_number !== undefined) nextMetadata.sss_number = normalizeText(body.sss_number, normalizeText(currentMetadata.sss_number, ""));
      if (body.pagibig_number !== undefined) nextMetadata.pagibig_number = normalizeText(body.pagibig_number, normalizeText(currentMetadata.pagibig_number, ""));
      if (body.philhealth_number !== undefined) nextMetadata.philhealth_number = normalizeText(body.philhealth_number, normalizeText(currentMetadata.philhealth_number, ""));
      if (body.bank_name !== undefined) nextMetadata.bank_name = normalizeText(body.bank_name, normalizeText(currentMetadata.bank_name, ""));
      if (body.bank_account_number !== undefined) nextMetadata.bank_account_number = normalizeText(body.bank_account_number, normalizeText(currentMetadata.bank_account_number, ""));
      if (body.cp_number !== undefined) nextMetadata.cp_number = normalizeText(body.cp_number, "");
      if (body.date_hired !== undefined) nextMetadata.date_hired = normalizeText(body.date_hired, "");
    }

    const email = action === "update"
      ? normalizeRoleEmail(normalizeText(body.email, existingUser.email))
      : existingUser.email;

    const updatePayload = {
      email,
      user_metadata: nextMetadata,
    };

    if (action === "update") {
      const password = normalizeText(body.password);
      if (password) {
        updatePayload.password = password;
      }
    }

    const updatedResult = await supabase.auth.admin.updateUserById(id, updatePayload);
    if (updatedResult.error) {
      return NextResponse.json({ error: sanitizeError(updatedResult.error) }, { status: 400 });
    }

    invalidateUsersCache();

    if (action === "update") {
      const profilePatch = {
        id,
        email,
        role: nextRole,
        full_name: nextMetadata.full_name,
      };
      // profiles is authoritative for these (employee_info_view and every
      // other employee-listing route read from profiles, not user_metadata)
      // — only touch a field when the caller actually supplied it.
      if (body.cp_number !== undefined) profilePatch.cp_number = normalizeText(body.cp_number, "") || null;
      if (body.date_hired !== undefined) profilePatch.date_hired = normalizeText(body.date_hired, "") || null;
      if (body.address !== undefined) profilePatch.address = normalizeText(body.address, "") || null;
      if (body.sss_number !== undefined) profilePatch.sss_number = normalizeDigits(body.sss_number, 10) || null;
      if (body.pagibig_number !== undefined) profilePatch.pagibig_number = normalizeDigits(body.pagibig_number, 12) || null;
      if (body.philhealth_number !== undefined) profilePatch.philhealth_number = normalizeDigits(body.philhealth_number, 12) || null;
      if (body.bank_name !== undefined) profilePatch.bank_name = normalizeText(body.bank_name, "") || null;
      if (body.bank_account_number !== undefined) profilePatch.bank_account_number = normalizeDigits(body.bank_account_number, 20) || null;

      const profileResult = await supabase.from("profiles").upsert(profilePatch, {
        onConflict: "id",
      });

      if (profileResult.error) {
        return NextResponse.json({ error: sanitizeError(profileResult.error) }, { status: 400 });
      }
    }

    const updatedUser = updatedResult.data.user;
    const employee = shapeEmployee(updatedUser, {
      id,
      email,
      role: nextRole,
      full_name: nextMetadata.full_name || existingUser.user_metadata?.full_name || existingUser.email,
      cp_number: nextMetadata.cp_number,
      date_hired: nextMetadata.date_hired,
      address: nextMetadata.address,
      sss_number: nextMetadata.sss_number,
      pagibig_number: nextMetadata.pagibig_number,
      philhealth_number: nextMetadata.philhealth_number,
      bank_name: nextMetadata.bank_name,
      bank_account_number: nextMetadata.bank_account_number,
    }, 0);

    const actionLabel = action === "archive"
      ? "archive"
      : action === "restore"
        ? "restore"
        : "update";

    await appendAuditLog({
      module: "employees",
      action: actionLabel,
      entity_type: "employee",
      entity_id: employee.employee_id,
      description: `Employee ${employee.full_name} was ${actionLabel}d by admin.`,
      status: "success",
      source: "api",
      metadata: {
        user_id: employee.id,
        role: employee.role,
        employee_type: employee.employee_type,
        archived: employee.archived,
      },
    });

    return NextResponse.json({ employee });
  } catch (error) {
    return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });
  }
}

export async function DELETE(request) {
  const guard = await requirePermission(request, "employee_information", "delete");
  if (guard.denied) return guard.denied;

  try {
    const body = await request.json().catch(() => ({}));
    const id = normalizeText(body.id);

    if (!id) {
      return NextResponse.json({ error: "Employee id is required." }, { status: 400 });
    }

    // ARCHIVE, NOT DELETE.
    //
    // This handler used to remove the profiles row and then call
    // auth.admin.deleteUser(), destroying the account outright. Payroll
    // records, payslips and attendance logs all reference the employee by id,
    // so that silently orphaned history the school is required to keep.
    //
    // A DELETE request is now honoured as a soft delete: the account is
    // flagged archived and its employee_status set to Inactive, which is what
    // the portals already read to hide it from active lists. No role can
    // trigger a physical removal from here — and the block_hard_delete trigger
    // in supabase/migrations/20260903_rbac_branch_scoping.sql refuses it at the
    // database level too, so a direct SQL DELETE fails the same way.
    const supabase = getAdminClient();

    const userResult = await supabase.auth.admin.getUserById(id);
    if (userResult.error || !userResult.data?.user) {
      return NextResponse.json({ error: "Employee not found." }, { status: 404 });
    }

    const existingUser = userResult.data.user;
    const nextMetadata = {
      ...(existingUser.user_metadata || {}),
      archived: true,
      employee_status: "Inactive",
      rfid_status: "Inactive",
    };

    const archiveResult = await supabase.auth.admin.updateUserById(id, {
      user_metadata: nextMetadata,
    });
    if (archiveResult.error) {
      return NextResponse.json({ error: sanitizeError(archiveResult.error) }, { status: 400 });
    }

    const profileResult = await supabase
      .from("profiles")
      .update({ archived: true, employee_status: "Inactive", updated_at: new Date().toISOString() })
      .eq("id", id);
    if (profileResult.error) {
      return NextResponse.json({ error: sanitizeError(profileResult.error) }, { status: 400 });
    }

    invalidateUsersCache();

    await appendAuditLog({
      module: "employees",
      action: "archive",
      entity_type: "employee",
      entity_id: id,
      description: "Employee account was archived (soft-deleted) by admin.",
      status: "success",
      source: "api",
      metadata: {
        user_id: id,
        archived: true,
        hard_delete: false,
      },
    });

    return NextResponse.json({ success: true, archived: true, hard_deleted: false });
  } catch (error) {
    return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });
  }
}
