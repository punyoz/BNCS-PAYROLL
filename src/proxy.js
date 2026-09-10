/**
 * RBAC proxy (Next.js 16's replacement for middleware.js) — the first thing
 * every request passes through.
 *
 * Two jobs:
 *
 *   1. API routes — map each /api/** path to a module, map the HTTP verb to an
 *      action, and reject the request with 401/403 before the handler runs if
 *      the caller's role has no such permission in the matrix.
 *
 *   2. Portal pages — keep a signed-in user out of another role's portal
 *      (/admin, /super-admin, ...). Until now this was enforced only in
 *      public/legacy/js/app.js from a localStorage value the user can edit.
 *
 * This is the coarse, uniform layer: "may this role touch this module at all".
 * Branch scoping and the User Management role ceiling need to look at the
 * request body or the rows involved, so they are enforced inside the handlers
 * via src/lib/rbac/guard.js. Both layers read the same matrix.
 *
 * Session verification uses node:crypto, which needs the Node.js runtime —
 * that's the default for this file (Next.js's middleware/proxy layer runs on
 * Node.js unless told otherwise), so nothing has to opt into it. Setting
 * `runtime` explicitly in this config is invalid in Next.js 16 and throws on
 * every request, which is worse than not setting it at all: don't add it back.
 */

import { NextResponse } from "next/server";
import { readSession } from "@/lib/rbac/session";
import { can, isKnownRole } from "@/lib/rbac/permissions";

export const config = {
  matcher: [
    "/api/:path*",
    "/super-admin/:path*",
    "/admin/:path*",
    "/hr/:path*",
    "/accountant/:path*",
    "/employee/:path*",
  ],
};

/** Paths that must stay reachable without a session. */
const PUBLIC_PATHS = [
  "/api/legacy-auth/login",
  "/api/legacy-auth/logout",
  "/api/legacy-auth/reset-password",
];

/**
 * API path prefix -> module. Longest prefix wins, so a more specific entry can
 * override a broader one.
 */
const API_MODULES = [
  ["/api/rbac/me", null],                                  // session-derived, self-guarding
  ["/api/legacy-auth/change-password", "profile"],
  ["/api/legacy-auth/update-profile", "profile"],
  ["/api/admin/users", "user_management"],
  ["/api/admin/employees", "employee_information"],
  ["/api/admin/employee-info", "employee_info_readonly"],
  ["/api/admin/transfer-requests", "transfer_requests"],
  ["/api/admin/attendance", "attendance"],
  ["/api/admin/audit-logs", "audit_logs"],
  ["/api/admin/branch-employees", "branch_assignment"],
  ["/api/admin/branch-reports", "branch_reports"],
  ["/api/admin/branches", "branch_management"],
  ["/api/admin/config", "system_configuration"],
  ["/api/admin/system", "system_maintenance"],
  ["/api/admin/backup", "backup_recovery"],
  ["/api/admin/roles", "roles_permissions"],
  ["/api/admin/dashboard", "dashboard"],
  ["/api/hr/employees", "employee_information"],
  ["/api/hr/attendance", "attendance"],
  ["/api/hr/leave-requests", "leave_approval"],
  ["/api/hr/reports", "hr_reports"],
  ["/api/hr/dashboard", "dashboard"],
  ["/api/accountant/payroll", "process_payroll"],
  ["/api/accountant/leave-requests", "leave_approval"],
  ["/api/accountant/approval-status", "payroll_records"],
  ["/api/employee/payslips", "payslips"],
  ["/api/employee/timesheet", "timesheet"],
  ["/api/employee/leave-requests", "leave_approval"],
  ["/api/employee/stats", "dashboard"],
];

/**
 * Reads are reads; every mutation verb maps to a write action. PATCH is
 * treated as "update" here — an archive (which the matrix calls delete) is
 * sent as PATCH { action: 'archive' }, and the handler checks that separately,
 * because only the body says which it is.
 */
const METHOD_ACTIONS = {
  GET: "read",
  HEAD: "read",
  OPTIONS: "read",
  POST: "create",
  PUT: "update",
  PATCH: "update",
  DELETE: "delete",
};

/**
 * Routes whose POST is not a creation but an action on existing data, so the
 * matrix's "update" permission is the right one to require.
 */
const POST_IS_UPDATE = [
  "/api/admin/attendance",       // recording/correcting a scan
  "/api/admin/branch-employees", // assigning staff to a branch
];

/**
 * Appending to your own activity trail is not a privileged write — every role
 * that can see the Audit Logs module also records into it as it navigates
 * (public/legacy/js/admin.js). Requiring "read" keeps that working while the
 * matrix still decides who has the module at all.
 */
const POST_IS_READ = [
  "/api/admin/audit-logs",
];

/** Portal path -> the role allowed to open it. */
const PORTAL_ROLES = {
  "/super-admin": "super_admin",
  "/admin": "admin",
  "/hr": "hr",
  "/accountant": "accountant",
  "/employee": "employee",
};

const ROLE_HOME = {
  super_admin: "/super-admin",
  admin: "/admin",
  hr: "/hr",
  accountant: "/accountant",
  employee: "/employee",
};

function moduleForPath(pathname) {
  let match = null;
  let matchedPrefix = "";

  for (const [prefix, module] of API_MODULES) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
      if (prefix.length > matchedPrefix.length) {
        matchedPrefix = prefix;
        match = module;
      }
    }
  }

  return { module: match, matched: Boolean(matchedPrefix) };
}

function actionForRequest(pathname, method) {
  const action = METHOD_ACTIONS[method] || "update";
  if (action === "create" && POST_IS_READ.some((p) => pathname.startsWith(p))) {
    return "read";
  }
  if (action === "create" && POST_IS_UPDATE.some((p) => pathname.startsWith(p))) {
    return "update";
  }
  return action;
}

/**
 * Reading the branch list is a label lookup every portal needs — Admin and HR
 * both render branch names on their Branch Assignment screens. Only creating,
 * editing and closing branch records is Branch Management, and that stays
 * Super Admin exclusive through the normal matrix check below.
 */
function isBranchLabelRead(pathname, method) {
  return pathname.startsWith("/api/admin/branches") && METHOD_ACTIONS[method] === "read";
}

export function proxy(request) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }

  const session = readSession(request);

  // ── Portal pages ──
  const portal = Object.keys(PORTAL_ROLES).find(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );

  if (portal) {
    if (!session || !isKnownRole(session.role)) {
      return NextResponse.redirect(new URL("/login", request.url));
    }
    if (session.role !== PORTAL_ROLES[portal]) {
      // Signed in, but this is not their portal — send them to their own.
      return NextResponse.redirect(new URL(ROLE_HOME[session.role] || "/login", request.url));
    }
    return NextResponse.next();
  }

  // ── API routes ──
  if (!pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  if (!session || !isKnownRole(session.role)) {
    return NextResponse.json(
      { error: "Your session has expired. Please sign in again." },
      { status: 401 },
    );
  }

  const { module, matched } = moduleForPath(pathname);

  // An unmapped /api path is a mistake, not a free pass: fail closed so a new
  // route cannot ship unguarded by accident.
  if (!matched) {
    return NextResponse.json(
      { error: "You do not have permission to perform this action." },
      { status: 403 },
    );
  }

  // module === null means "authenticated session is the whole requirement"
  // (currently just /api/rbac/me, which derives everything from the cookie).
  if (module === null) {
    return NextResponse.next();
  }

  if (isBranchLabelRead(pathname, request.method)) {
    return NextResponse.next();
  }

  const action = actionForRequest(pathname, request.method);

  if (!can(session.role, module, action)) {
    return NextResponse.json(
      { error: "You do not have permission to perform this action." },
      { status: 403 },
    );
  }

  return NextResponse.next();
}
