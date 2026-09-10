/**
 * Sidebar menu builder.
 *
 * The portals used to hardcode their nav items in
 * public/legacy/pages/<role>.html, one <div class="ni"> per module per role —
 * which is exactly how Admin ended up with System Maintenance and no Reports
 * section. Menu items are now derived from ROLE_PERMISSIONS instead, so the
 * matrix is the only place a module's visibility is decided.
 *
 * The markup this produces is byte-for-byte the same shape the pages already
 * ship — same `.sb-sec` headers, same `.ni` rows, same inline SVGs, same
 * adminNav()/saNav()/hrNav()/acctNav() handlers — so nothing about the look or
 * behaviour of the sidebar changes. Only *which* rows appear does.
 */

import { allowedModules, MODULES } from "@/lib/rbac/permissions";

/** The nav click handler each portal already defines. */
const NAV_HANDLER = {
  super_admin: "saNav",
  admin: "adminNav",
  hr: "hrNav",
  accountant: "acctNav",
};

/** Section order down the sidebar. */
const SECTION_ORDER = [
  "Overview",
  "Management",
  "Employees",
  "Attendance",
  "Leave",
  "Payroll",
  "Reference",
  "Monitoring",
  "Reports",
  "System",
  "Account",
];

/** Icons lifted verbatim from the existing sidebars so the UI is unchanged. */
export const ICONS = {
  grid: '<svg width="14" height="14" fill="none" viewBox="0 0 16 16"><rect x="1" y="1" width="6" height="6" rx="1.5" fill="currentColor"/><rect x="9" y="1" width="6" height="6" rx="1.5" fill="currentColor" opacity=".5"/><rect x="1" y="9" width="6" height="6" rx="1.5" fill="currentColor" opacity=".5"/><rect x="9" y="9" width="6" height="6" rx="1.5" fill="currentColor" opacity=".5"/></svg>',
  gridOutline: '<svg width="14" height="14" fill="none" viewBox="0 0 16 16"><rect x="1" y="1" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1.5"/><rect x="9" y="1" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1.5"/><rect x="1" y="9" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1.5"/><rect x="9" y="9" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1.5"/></svg>',
  check: '<svg width="14" height="14" fill="none" viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M5 8l2 2 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  users: '<svg width="14" height="14" fill="none" viewBox="0 0 16 16"><circle cx="5.5" cy="5" r="2.5" fill="currentColor"/><circle cx="10.5" cy="5" r="2.5" fill="currentColor" opacity=".5"/><path d="M1 13c0-2.5 2-4 4.5-4s4.5 1.5 4.5 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M11 9c1.5 0 3 .8 3 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" opacity=".5"/></svg>',
  user: '<svg width="14" height="14" fill="none" viewBox="0 0 16 16"><circle cx="8" cy="5" r="3" fill="currentColor"/><path d="M2 13c0-3 2.7-5 6-5s6 2 6 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  buildings: '<svg width="14" height="14" fill="none" viewBox="0 0 16 16"><rect x="1" y="6" width="6" height="9" rx="1.5" stroke="currentColor" stroke-width="1.4"/><rect x="9" y="1" width="6" height="14" rx="1.5" stroke="currentColor" stroke-width="1.4"/><path d="M7 10h2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
  gear: '<svg width="14" height="14" fill="none" viewBox="0 0 16 16"><circle cx="8" cy="8" r="2.5" stroke="currentColor" stroke-width="1.4"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.1 3.1l1.4 1.4M11.5 11.5l1.4 1.4M3.1 12.9l1.4-1.4M11.5 4.5l1.4-1.4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" opacity=".7"/></svg>',
  list: '<svg width="14" height="14" fill="none" viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M5 6h6M5 8.5h6M5 11h4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
  backup: '<svg width="14" height="14" fill="none" viewBox="0 0 16 16"><path d="M8 2v8M5 7l3 3 3-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><rect x="2" y="11" width="12" height="3" rx="1.5" stroke="currentColor" stroke-width="1.4"/></svg>',
  document: '<svg width="14" height="14" fill="none" viewBox="0 0 16 16"><rect x="2" y="1" width="12" height="14" rx="1.5" stroke="currentColor" stroke-width="1.5"/><path d="M5 5h6M5 8h6M5 11h4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
  leave: '<svg width="14" height="14" fill="none" viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M5 5h6M5 8h6M5 11h4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
  trend: '<svg width="14" height="14" fill="none" viewBox="0 0 16 16"><path d="M2 12l4-4 3 3 5-7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  profile: '<svg width="14" height="14" fill="none" viewBox="0 0 16 16"><circle cx="8" cy="6" r="3" stroke="currentColor" stroke-width="1.5"/><path d="M2 14c0-3.314 2.686-5 6-5s6 1.686 6 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  plus: '<svg width="14" height="14" fill="none" viewBox="0 0 16 16"><path d="M8 1v14M1 8h14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  records: '<svg width="14" height="14" fill="none" viewBox="0 0 16 16"><path d="M4 4h8M4 8h6M4 12h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><rect x="1" y="1" width="14" height="14" rx="2" stroke="currentColor" stroke-width="1.5"/></svg>',
  payslip: '<svg width="14" height="14" fill="none" viewBox="0 0 16 16"><rect x="2" y="1" width="12" height="14" rx="1.5" stroke="currentColor" stroke-width="1.5"/><path d="M5 5h6M5 8h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  chart: '<svg width="14" height="14" fill="none" viewBox="0 0 16 16"><polyline points="2,11 5,7 8,10 12,5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/><rect x="1" y="1" width="14" height="14" rx="2" stroke="currentColor" stroke-width="1.5"/></svg>',
};

/** Default icon per module, with per-role overrides where the pages differ. */
const MODULE_ICON = {
  dashboard: { default: "grid", accountant: "gridOutline" },
  attendance: { default: "check" },
  user_management: { default: "users", hr: "user" },
  employee_information: { default: "document" },
  employee_info_readonly: { default: "document" },
  branch_management: { default: "buildings" },
  branch_assignment: { default: "buildings" },
  roles_permissions: { default: "users" },
  transfer_requests: { default: "buildings" },
  leave_approval: { default: "leave" },
  rfid_devices: { default: "check" },
  process_payroll: { default: "plus" },
  payroll_records: { default: "records" },
  payslips: { default: "payslip" },
  payroll_monitoring: { default: "chart" },
  system_maintenance: { default: "gear" },
  system_configuration: { default: "gear" },
  audit_logs: { default: "list" },
  backup_recovery: { default: "backup" },
  hr_reports: { default: "trend" },
  payroll_reports: { default: "records" },
  branch_reports: { default: "trend" },
  profile: { default: "profile" },
  timesheet: { default: "document" },
};

/**
 * The section a module sits under can differ per portal — the HR portal groups
 * its people modules under "Employees", the Accountant portal calls attendance
 * "Reference". Preserved so each sidebar keeps the headings it has today.
 */
const SECTION_OVERRIDE = {
  hr: {
    user_management: "Employees",
    employee_information: "Employees",
    branch_assignment: "Employees",
  },
  accountant: {
    attendance: "Reference",
  },
};

function iconFor(module, role) {
  const entry = MODULE_ICON[module] || {};
  return ICONS[entry[role] || entry.default] || "";
}

function labelFor(module, role) {
  const meta = MODULES[module] || {};
  return meta.labelOverride?.[role] || meta.label || module;
}

function sectionFor(module, role) {
  return SECTION_OVERRIDE[role]?.[module] || MODULES[module]?.section || "Overview";
}

/**
 * Build the menu for a role: an ordered list of sections, each with its items.
 * Modules the role cannot read, and modules with no page in that portal, are
 * left out entirely.
 *
 * @returns {Array<{ section: string, items: Array<{
 *   module: string, label: string, page: string, icon: string, handler: string
 * }> }>}
 */
export function buildMenu(role) {
  const normalized = String(role || "").toLowerCase();
  const handler = NAV_HANDLER[normalized];
  if (!handler) return [];

  const items = allowedModules(normalized)
    .map((module) => {
      const page = MODULES[module]?.page?.[normalized];
      if (!page) return null; // module has no screen in this portal
      return {
        module,
        label: labelFor(module, normalized),
        page,
        icon: iconFor(module, normalized),
        handler,
        section: sectionFor(module, normalized),
      };
    })
    .filter(Boolean);

  // Collapse modules that share a page (Super Admin's User Management and
  // Roles & Permissions are both `sa-roles`) so the sidebar shows one row.
  const seenPages = new Set();
  const deduped = items.filter((item) => {
    if (seenPages.has(item.page)) return false;
    seenPages.add(item.page);
    return true;
  });

  const bySection = new Map();
  deduped.forEach((item) => {
    if (!bySection.has(item.section)) bySection.set(item.section, []);
    bySection.get(item.section).push({
      module: item.module,
      label: item.label,
      page: item.page,
      icon: item.icon,
      handler: item.handler,
    });
  });

  return SECTION_ORDER.filter((section) => bySection.has(section)).map((section) => ({
    section,
    items: bySection.get(section),
  }));
}

/** The page id a portal should open first for this role. */
export function defaultPageFor(role) {
  const menu = buildMenu(role);
  return menu[0]?.items?.[0]?.page || "";
}

/** Every page id a role is allowed to open — the frontend page-level guard. */
export function allowedPagesFor(role) {
  return buildMenu(role).flatMap((section) => section.items.map((item) => item.page));
}
