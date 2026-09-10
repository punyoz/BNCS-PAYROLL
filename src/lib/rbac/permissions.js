/**
 * SACS Payroll — single source of truth for role-based access control.
 *
 * Mirrors "Section 2 — Full Ordered Permission Matrix" in
 * SACS-Payroll-Permission-Matrix.md. Nothing in this system should hardcode a
 * role name to decide access; ask this table instead, via can() / scopeFor().
 *
 * Two independent dimensions, exactly as the matrix describes them:
 *
 *   SCOPE  — how much data a role may reach:
 *            'all'    every branch (super_admin only)
 *            'branch' rows whose branch_id equals the caller's own branch
 *            'self'   rows belonging to the caller personally
 *            'none'   no access to the module at all
 *
 *   ACTIONS — what the role may do inside that scope: create / read /
 *             update / delete.
 *
 * NOTE ON 'delete': across this system "delete" means ARCHIVE (set the record
 * inactive), never a physical row removal. Payroll and attendance history must
 * stay referentially intact, so no role — super_admin included — is granted a
 * hard delete. See assertNoHardDelete() below.
 */

export const ROLES = ["super_admin", "admin", "hr", "accountant", "employee"];

export const SCOPE_ALL = "all";
export const SCOPE_BRANCH = "branch";
export const SCOPE_SELF = "self";
export const SCOPE_NONE = "none";

/** Roles whose every query must be filtered down to their own branch_id. */
export const BRANCH_SCOPED_ROLES = ["admin", "hr", "accountant", "employee"];

const CRUD = ["create", "read", "update", "delete"];
const READ = ["read"];
const READ_WRITE = ["read", "update"];

/** Shorthand: full CRUD within the given scope. */
const full = (scope) => ({ scope, actions: CRUD });
/** Shorthand: view-only within the given scope. */
const view = (scope) => ({ scope, actions: READ });
/** Shorthand: no access at all. */
const none = () => ({ scope: SCOPE_NONE, actions: [] });

/**
 * Module registry. `label`, `section` and `page` drive the dynamically
 * rendered sidebar (see src/lib/rbac/menu.js); `order` follows the matrix's
 * own numbering so the sidebar keeps the documented ordering.
 *
 * `page` maps a module to the existing legacy page id per role, so the
 * generated sidebar keeps calling the same adminNav()/saNav()/hrNav()/
 * acctNav() handlers the portals already define — no page markup changes.
 */
export const MODULES = {
  dashboard: {
    order: 1, label: "Dashboard", section: "Overview",
    page: { super_admin: "sa-dashboard", admin: "adm-dashboard", hr: "hr-dashboard", accountant: "ac-dashboard" },
    labelOverride: { super_admin: "SA Dashboard", hr: "HR Dashboard" },
  },
  attendance: {
    order: 2, label: "Attendance", section: "Overview",
    page: { super_admin: "sa-attendance", admin: "adm-attendance", hr: "hr-attendance", accountant: "ac-attendance" },
    labelOverride: { hr: "Attendance Monitoring", accountant: "View Attendance" },
  },
  user_management: {
    order: 3, label: "User Management", section: "Management",
    page: { super_admin: "sa-roles", admin: "adm-users", hr: "hr-employees" },
  },
  employee_information: {
    order: 4, label: "Employee Information", section: "Management",
    page: { hr: "hr-employee-info" },
  },
  // Read-only summary view (id, full_name, cp_number, branch_id, position,
  // status, date_hired) backed by public.employee_info_view — separate from
  // employee_information's full CRUD table above.
  employee_info_readonly: {
    order: 4.5, label: "Employee Info", section: "Management",
    page: { admin: "adm-employee-info", super_admin: "sa-employee-info", hr: "hr-employee-directory" },
    // HR already owns a full-CRUD "Employee Information" page for the same
    // module (employee_information above) — a distinct label keeps the two
    // from reading as duplicates in HR's sidebar.
    labelOverride: { hr: "Employee Directory" },
  },
  branch_management: {
    order: 5, label: "Branch Management", section: "Management",
    page: { super_admin: "sa-branches" },
  },
  branch_assignment: {
    order: 6, label: "Branch Assignment", section: "Management",
    page: { super_admin: "sa-branch-assign", admin: "adm-branch-assign", hr: "hr-branch-assign" },
  },
  roles_permissions: {
    order: 7, label: "Roles & Permissions", section: "Management",
    page: { super_admin: "sa-roles" },
  },
  // Admin requests a branch move for staff in their own branch; Super Admin
  // reviews and approves/rejects (public.transfer_requests + its trigger
  // moves profiles.branch_id automatically on approval).
  transfer_requests: {
    order: 6.5, label: "Transfer Requests", section: "Management",
    page: { admin: "adm-transfer-requests", super_admin: "sa-transfer-requests" },
  },
  leave_approval: {
    order: 8, label: "Leave Approval", section: "Leave",
    page: { hr: "hr-leaves" },
  },
  rfid_devices: {
    order: 9, label: "RFID Devices", section: "Attendance",
    page: {},
  },
  process_payroll: {
    order: 10, label: "Process Payroll", section: "Payroll",
    page: { accountant: "ac-process" },
  },
  payroll_records: {
    order: 11, label: "Payroll Records", section: "Payroll",
    page: { accountant: "ac-records" },
  },
  payslips: {
    order: 12, label: "Payslips", section: "Payroll",
    page: { accountant: "ac-payslips" },
  },
  payroll_monitoring: {
    order: 13, label: "Payroll Monitoring", section: "Monitoring",
    page: { accountant: "ac-monitoring" },
  },
  system_maintenance: {
    order: 14, label: "System Maintenance", section: "System",
    page: { super_admin: "sa-maintenance" },
  },
  system_configuration: {
    order: 15, label: "System Configuration", section: "System",
    page: { super_admin: "sa-config" },
  },
  audit_logs: {
    // Super Admin's is system-wide (logins, config changes, backups);
    // Admin's is their own branch's activity only.
    order: 16, label: "Audit Logs", section: "System",
    page: { super_admin: "sa-audit", admin: "adm-audit-logs" },
    labelOverride: { super_admin: "Audit & Monitoring" },
  },
  backup_recovery: {
    order: 17, label: "Backup & Recovery", section: "System",
    page: { super_admin: "sa-backup" },
  },
  hr_reports: {
    order: 18, label: "HR Reports", section: "Reports",
    page: { hr: "hr-reports" },
  },
  payroll_reports: {
    order: 19, label: "Payroll Reports", section: "Reports",
    page: { accountant: "ac-reports" },
  },
  branch_reports: {
    // NEW — the branch-level summary the matrix flags as missing for Admin.
    // View-only: attendance, headcount and payroll status for the Admin's own
    // branch. Payroll figures stay editable by the Accountant alone.
    order: 20, label: "Branch Reports", section: "Reports",
    page: { admin: "adm-branch-reports" },
  },
  profile: {
    order: 21, label: "Profile", section: "Account",
    page: { super_admin: "sa-profile", admin: "adm-profile", hr: "hr-profile", accountant: "ac-profile" },
  },
  timesheet: {
    order: 22, label: "Timesheet", section: "Account",
    page: {},
  },
};

/**
 * THE MATRIX. Rows = modules, columns = roles.
 * Any module a role is missing from is implicitly no-access.
 */
export const ROLE_PERMISSIONS = {
  super_admin: {
    // System-wide + configuration authority: full reach on every module,
    // unrestricted by branch.
    dashboard: full(SCOPE_ALL),
    attendance: full(SCOPE_ALL),
    user_management: full(SCOPE_ALL),
    employee_information: full(SCOPE_ALL),
    employee_info_readonly: view(SCOPE_ALL),
    branch_management: full(SCOPE_ALL),
    branch_assignment: full(SCOPE_ALL),
    roles_permissions: full(SCOPE_ALL),
    // Sole approver: only Super Admin may update a transfer request's status.
    transfer_requests: full(SCOPE_ALL),
    leave_approval: full(SCOPE_ALL),
    rfid_devices: full(SCOPE_ALL),
    // Oversight/approval only — the Accountant owns payroll processing.
    process_payroll: { scope: SCOPE_ALL, actions: READ_WRITE },
    payroll_records: full(SCOPE_ALL),
    payslips: full(SCOPE_ALL),
    payroll_monitoring: full(SCOPE_ALL),
    system_maintenance: full(SCOPE_ALL),
    system_configuration: full(SCOPE_ALL),
    audit_logs: full(SCOPE_ALL),
    backup_recovery: full(SCOPE_ALL),
    hr_reports: full(SCOPE_ALL),
    payroll_reports: full(SCOPE_ALL),
    branch_reports: view(SCOPE_ALL),
    profile: full(SCOPE_SELF),
    timesheet: full(SCOPE_ALL),
  },

  admin: {
    // Operational authority, boxed inside one branch. Never system config,
    // role definitions, branch records, backups, or peer/superior accounts.
    dashboard: view(SCOPE_BRANCH),
    attendance: { scope: SCOPE_BRANCH, actions: READ_WRITE },
    user_management: { scope: SCOPE_BRANCH, actions: CRUD },
    // CRUD rather than the matrix's view/edit wording because creating and
    // archiving an *employee* account is exactly what the matrix grants Admin
    // under User Management, and both flows run through the same employees
    // endpoint. The ceiling that matters is MANAGEABLE_ROLES below: Admin can
    // reach hr / accountant / employee records only, inside its own branch.
    employee_information: { scope: SCOPE_BRANCH, actions: CRUD },
    employee_info_readonly: view(SCOPE_BRANCH),
    branch_management: none(),
    branch_assignment: { scope: SCOPE_BRANCH, actions: READ_WRITE },
    roles_permissions: none(),
    // Admin may raise a transfer request out of its own branch and read its
    // own requests, but never decide one — approval is Super Admin's alone.
    transfer_requests: { scope: SCOPE_BRANCH, actions: ["create", "read"] },
    leave_approval: view(SCOPE_BRANCH),
    rfid_devices: view(SCOPE_BRANCH),
    process_payroll: none(),
    payroll_records: view(SCOPE_BRANCH),
    payslips: view(SCOPE_BRANCH),
    payroll_monitoring: view(SCOPE_BRANCH),
    system_maintenance: none(),
    system_configuration: none(),
    audit_logs: view(SCOPE_BRANCH),
    backup_recovery: none(),
    hr_reports: view(SCOPE_BRANCH),
    payroll_reports: view(SCOPE_BRANCH),
    branch_reports: view(SCOPE_BRANCH),
    profile: full(SCOPE_SELF),
    timesheet: view(SCOPE_BRANCH),
  },

  hr: {
    dashboard: view(SCOPE_BRANCH),
    attendance: { scope: SCOPE_BRANCH, actions: READ_WRITE },
    user_management: { scope: SCOPE_BRANCH, actions: READ_WRITE },
    // Primary owner of employee records / 201 files for their branch.
    employee_information: full(SCOPE_BRANCH),
    employee_info_readonly: view(SCOPE_BRANCH),
    branch_management: none(),
    branch_assignment: { scope: SCOPE_BRANCH, actions: READ_WRITE },
    roles_permissions: none(),
    leave_approval: full(SCOPE_BRANCH),
    rfid_devices: none(),
    process_payroll: none(),
    payroll_records: view(SCOPE_BRANCH),
    payslips: view(SCOPE_BRANCH),
    payroll_monitoring: none(),
    system_maintenance: none(),
    system_configuration: none(),
    audit_logs: none(),
    backup_recovery: none(),
    hr_reports: full(SCOPE_BRANCH),
    payroll_reports: none(),
    branch_reports: none(),
    profile: full(SCOPE_SELF),
    timesheet: view(SCOPE_BRANCH),
  },

  accountant: {
    dashboard: view(SCOPE_BRANCH),
    attendance: view(SCOPE_BRANCH),
    user_management: none(),
    employee_information: view(SCOPE_BRANCH),
    branch_management: none(),
    branch_assignment: none(),
    roles_permissions: none(),
    // First-stage leave review before it reaches HR (status pending_accountant).
    leave_approval: { scope: SCOPE_BRANCH, actions: READ_WRITE },
    rfid_devices: none(),
    process_payroll: full(SCOPE_BRANCH),
    payroll_records: full(SCOPE_BRANCH),
    payslips: full(SCOPE_BRANCH),
    payroll_monitoring: full(SCOPE_BRANCH),
    system_maintenance: none(),
    system_configuration: none(),
    audit_logs: none(),
    backup_recovery: none(),
    hr_reports: none(),
    payroll_reports: full(SCOPE_BRANCH),
    branch_reports: none(),
    profile: full(SCOPE_SELF),
    timesheet: view(SCOPE_BRANCH),
  },

  employee: {
    dashboard: view(SCOPE_SELF),
    attendance: view(SCOPE_SELF),
    user_management: none(),
    employee_information: view(SCOPE_SELF),
    branch_management: none(),
    branch_assignment: none(),
    roles_permissions: none(),
    // Submit own requests only.
    leave_approval: { scope: SCOPE_SELF, actions: ["create", "read"] },
    rfid_devices: none(),
    process_payroll: none(),
    payroll_records: none(),
    payslips: view(SCOPE_SELF),
    payroll_monitoring: none(),
    system_maintenance: none(),
    system_configuration: none(),
    audit_logs: none(),
    backup_recovery: none(),
    hr_reports: none(),
    payroll_reports: none(),
    branch_reports: none(),
    profile: full(SCOPE_SELF),
    timesheet: view(SCOPE_SELF),
  },
};

/**
 * Which roles each role may create / edit / archive through User Management.
 * Admin's ceiling is the whole point of this table: an Admin may never mint,
 * edit, or elevate anyone into admin or super_admin.
 */
export const MANAGEABLE_ROLES = {
  super_admin: ["super_admin", "admin", "hr", "accountant", "employee"],
  admin: ["hr", "accountant", "employee"],
  hr: ["employee"],
  accountant: [],
  employee: [],
};

/** Modules that are Super Admin exclusive, and the routes that expose them. */
export const SUPER_ADMIN_ONLY_MODULES = [
  "roles_permissions",
  "branch_management",
  "system_configuration",
  "system_maintenance",
  "backup_recovery",
];

/** Public URL path -> module, for the frontend route guard and its tests. */
export const ROUTE_MODULES = {
  "/roles-permissions": "roles_permissions",
  "/branch-management": "branch_management",
  "/system-configuration": "system_configuration",
  "/system-maintenance": "system_maintenance",
  "/backup-recovery": "backup_recovery",
  "/branch-reports": "branch_reports",
  "/user-management": "user_management",
  "/audit-logs": "audit_logs",
  "/attendance": "attendance",
  "/branch-assignment": "branch_assignment",
};

export function isKnownRole(role) {
  return ROLES.includes(String(role || "").toLowerCase());
}

/** The permission entry for a role/module pair, or a closed one. */
export function permissionFor(role, module) {
  const entry = ROLE_PERMISSIONS[String(role || "").toLowerCase()]?.[module];
  if (!entry) return { scope: SCOPE_NONE, actions: [] };
  return entry;
}

/** True when `role` may perform `action` on `module`. */
export function can(role, module, action = "read") {
  return permissionFor(role, module).actions.includes(String(action).toLowerCase());
}

/** 'all' | 'branch' | 'self' | 'none' for a role/module pair. */
export function scopeFor(role, module) {
  return permissionFor(role, module).scope;
}

/** True when the role sees every branch (super_admin bypasses branch checks). */
export function isBranchExempt(role) {
  return String(role || "").toLowerCase() === "super_admin";
}

/** True when the role's queries must carry a branch_id filter. */
export function isBranchScoped(role) {
  return BRANCH_SCOPED_ROLES.includes(String(role || "").toLowerCase());
}

/** True when `actorRole` may create/edit/archive an account of `targetRole`. */
export function canManageRole(actorRole, targetRole) {
  const allowed = MANAGEABLE_ROLES[String(actorRole || "").toLowerCase()] || [];
  return allowed.includes(String(targetRole || "").toLowerCase());
}

/** Every module a role can at least read — drives the sidebar. */
export function allowedModules(role) {
  const table = ROLE_PERMISSIONS[String(role || "").toLowerCase()] || {};
  return Object.keys(table)
    .filter((m) => table[m].actions.includes("read"))
    .sort((a, b) => (MODULES[a]?.order || 99) - (MODULES[b]?.order || 99));
}

/**
 * Hard-delete kill switch. Accounts and any record payroll/attendance history
 * depends on are archived, never destroyed. Call this on any code path that
 * would physically remove such a row; it always throws.
 */
export function assertNoHardDelete(entity = "record") {
  throw new Error(
    "Hard delete is disabled system-wide: a " + entity + " can only be archived " +
    "(status set to inactive), so payroll and attendance history stays intact.",
  );
}
