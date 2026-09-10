/* ═══════════════════════════════════════
   admin.js — Administrator role logic
   Handles: page navigation, approvals
   Edit this file for admin-specific features
   ═══════════════════════════════════════ */

'use strict';

/* ── PAGE MAP ── */
const ADMIN_PAGES = {
  'adm-dashboard':    'Dashboard',
  'adm-attendance':   'Attendance',
  'adm-audit-logs':   'Audit Logs',
  'adm-users':        'User Management',
  'adm-transfer-requests':'Transfer Requests',
  'adm-branch-assign':'Branch Assignment',
  'adm-maintenance':  'System Maintenance',
  'adm-branch-reports':'Branch Reports',
  'adm-profile':      'Profile',
};

const AVATAR_COLORS = ['#3EC97A', '#F5A623', '#1DB8A0', '#E85555', '#7F77DD'];
let dashboardData = null;
let attendanceData = null;
let auditLogsData = [];
let auditSummary = { total: 0, success: 0, failed: 0 };
let auditSearch = '';
let auditModuleFilter = 'all';
let auditActionFilter = 'all';

let attPaginator = null;
let auditPaginator = null;

/* ── USER MANAGEMENT STATE ── */
let allUsers = [];
let userRoleFilter = 'all';
let userSearch = '';
let currentEditingUser = null;
let usersPaginator = null;

/* ── TRANSFER REQUESTS STATE ── */
let adminTransferPending = [];
let adminTransferHistory = [];

/* ── BRANCH ASSIGNMENT STATE ── */
let branchAllEmployees = [];
let branchFilter = 'all';
let branchSearch = '';
let currentBranchEmployee = null;
let branchPaginator = null;
let admAssignBranches = [];

/* ── SYSTEM MAINTENANCE STATE ── */
let systemData = null;
let allRfidDevices = [];
let rfidDeviceSearch = '';
let rfidPaginator = null;
let currentEditingRfid = null;

/* ── NAVIGATE ── */
function adminNav(pageId, navEl) {
  // hide all admin pages
  Object.keys(ADMIN_PAGES).forEach(id => {
    document.getElementById(id)?.classList.remove('active');
  });

  // show target page
  document.getElementById(pageId)?.classList.add('active');

  // update sidebar highlight
  document.querySelectorAll('#s-admin .ni').forEach(n => n.classList.remove('active'));
  if (navEl) navEl.classList.add('active');

  // update topbar title
  const titleEl = document.getElementById('adm-tb-title');
  if (titleEl) titleEl.textContent = ADMIN_PAGES[pageId] || '';

  if (window.persistRolePageState) {
    window.persistRolePageState('admin', pageId);
  }

  if (pageId === 'adm-dashboard') {
    loadDashboard();
  }

  if (pageId === 'adm-attendance') {
    loadAttendanceData();
    // Auto-focus the scan field so a HID RFID reader's keystrokes land there
    // immediately without an extra click.
    setTimeout(() => document.getElementById('adm-rfid-input')?.focus(), 0);
  }

  if (pageId === 'adm-audit-logs') {
    loadAuditLogs();
  }

  if (pageId === 'adm-users') {
    loadUsers();
  }

  if (pageId === 'adm-transfer-requests') {
    loadAdminTransferRequests();
  }

  if (pageId === 'adm-branch-assign') {
    loadBranchAssignment();
  }

  if (pageId === 'adm-maintenance') {
    loadSystemData();
  }

  if (pageId === 'adm-branch-reports') {
    loadBranchReports();
  }

  if (pageId === 'adm-profile') {
    loadAdminProfile();
  }

  logAuditMovement({
    module: 'ui',
    action: 'navigate',
    entity_type: 'page',
    entity_id: pageId,
    description: `Admin opened ${ADMIN_PAGES[pageId] || 'page'}.`,
    source: 'ui',
    metadata: { page_id: pageId },
  });
}

function getAdminNavByPageId(pageId) {
  const navItems = Array.from(document.querySelectorAll('#s-admin .ni'));
  return navItems.find((item) => String(item.getAttribute('onclick') || '').includes(`'${pageId}'`)) || null;
}


function getInitials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'NA';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

function applyAdminIdentity() {
  const context = window.getLegacyAuthContext ? window.getLegacyAuthContext() : null;
  const fullName = String(context?.full_name || '').trim();
  const displayName = fullName || 'Admin User';

  const avatarEl = document.querySelector('#s-admin .sb-foot .av');
  if (avatarEl) avatarEl.textContent = getInitials(displayName);

  const nameEl = document.querySelector('#s-admin .sb-foot .un');
  if (nameEl) nameEl.textContent = displayName;

  const roleEl = document.querySelector('#s-admin .sb-foot .ur');
  if (roleEl) roleEl.textContent = 'Administrator';
}

function loadAdminProfile() {
  const ctx = window.getLegacyAuthContext ? window.getLegacyAuthContext() : null;
  if (!ctx) return;

  const initials = (String(ctx.full_name || '').trim()
    .split(/\s+/).slice(0, 2).map(w => w[0] || '').join('') || 'AD').toUpperCase();

  const setTxt = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val || '—'; };

  setTxt('adm-ep-avatar',    initials);
  setTxt('adm-ep-name',      ctx.full_name    || 'Admin User');
  setTxt('adm-ep-pos',       ctx.position     || 'Administrator');
  setTxt('adm-ep-role-tag',  ctx.role         || 'Administrator');
  setTxt('adm-ep-info-name',    ctx.full_name);
  setTxt('adm-ep-info-id',     ctx.employee_id);
  setTxt('adm-ep-info-email',  ctx.email);
  setTxt('adm-ep-info-role',   ctx.role);
  setTxt('adm-ep-bank-name',   ctx.bank_name);
  setTxt('adm-ep-bank-account',ctx.bank_account_number);
}

function handleLegacyAuthContextChange() {
  applyAdminIdentity();
}

function getAvatarColor(seed) {
  let hash = 0;
  const text = String(seed || 'employee');
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash) + text.charCodeAt(i);
    hash |= 0;
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

/* ── BRANCH REPORTS ──
   View-only branch summary: attendance, headcount and payroll status for the
   Admin's own branch. Every figure comes from /api/admin/branch-reports, which
   scopes itself to the caller's branch_id from their session — this screen has
   no edit affordance because payroll figures belong to the Accountant. */
async function loadBranchReports() {
  const setText = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };

  const payrollBody = document.getElementById('adm-br-payroll-body');
  if (payrollBody) payrollBody.innerHTML = skeletonRows(2, 3);

  try {
    const response = await fetch('/api/admin/branch-reports', { method: 'GET' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Failed to load branch reports.');

    setText('adm-br-branch', data.branch?.label || '—');
    setText('adm-br-generated', data.branch?.all_branches
      ? 'All branches — view-only summary'
      : 'View-only summary');

    setText('adm-br-headcount', data.headcount?.total ?? 0);
    const byRole = data.headcount?.by_role || {};
    const roleParts = Object.keys(byRole)
      .sort()
      .map((role) => `${byRole[role]} ${role.replace('_', ' ')}`);
    setText('adm-br-headcount-breakdown', roleParts.length
      ? roleParts.join(' · ')
      : 'Staff assigned to this branch');

    setText('adm-br-unassigned', data.unassigned_staff ?? 0);
    setText('adm-br-present', data.attendance?.present ?? 0);
    setText('adm-br-late', data.attendance?.late ?? 0);
    setText('adm-br-absent', data.attendance?.absent ?? 0);
    setText('adm-br-date', data.attendance?.date || '—');

    if (payrollBody) {
      const payroll = data.payroll || {};
      const rows = [
        ['Latest pay period', payroll.latest_period || 'None processed yet'],
        ['Employees processed this period', payroll.processed_this_period ?? 0],
        ['Awaiting processing', payroll.awaiting_processing ?? 0],
        ['Pending payroll entries', payroll.pending_entries ?? 0],
        ['Total net pay this period', formatMoney(payroll.total_net_pay_this_period)],
      ];
      payrollBody.innerHTML = rows
        .map(([label, value]) => `<tr><td>${escapeHtml(label)}</td><td>${escapeHtml(String(value))}</td></tr>`)
        .join('');
    }
  } catch (error) {
    if (payrollBody) {
      payrollBody.innerHTML = `<tr><td colspan="2">${escapeHtml(error.message || 'Unable to load branch reports.')}</td></tr>`;
    }
  }
}

function formatMoney(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '₱ 0';
  return `₱ ${amount.toLocaleString('en-PH', { maximumFractionDigits: 0 })}`;
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeJsString(value) {
  return String(value || '').replaceAll('\\', '\\\\').replaceAll("'", "\\'");
}

function normalizePortalPosition(positionValue, roleValue) {
  const role = String(roleValue || '').trim().toLowerCase();
  const position = String(positionValue || '').trim().toLowerCase();

  if (role === 'accountant' || position === 'accountant' || position.includes('account')) {
    return 'Accountant';
  }

  if (role === 'hr' || position === 'hr officer' || position.includes('hr officer')) {
    return 'HR Officer';
  }

  return 'Employee';
}

const ALLOWED_SUFFIXES = ['', 'Jr.', 'Sr.', 'II', 'III', 'IV', 'V'];

function isValidNamePart(nameValue) {
  const normalized = String(nameValue || '').trim();
  return normalized.length > 0 && /^[A-Za-z]+(?:\s+[A-Za-z]+)*$/.test(normalized);
}

function setupNameFieldValidation() {
  const INVALID_CHARS = /[^A-Za-z\s]/g;

  document.querySelectorAll('.name-input').forEach((input) => {
    const errorSpan = input.nextElementSibling;

    input.addEventListener('input', () => {
      const original = input.value;
      const cleaned = original.replace(INVALID_CHARS, '');

      if (cleaned !== original) {
        const pos = input.selectionStart - (original.length - cleaned.length);
        input.value = cleaned;
        input.setSelectionRange(pos, pos);
        if (errorSpan) errorSpan.textContent = 'Only letters and spaces are allowed.';
      } else {
        if (errorSpan) errorSpan.textContent = '';
      }
    });
  });
}

const ADMIN_SALARY_MAX = 9999999.99;

function setupSalaryFieldValidation(scope = document) {
  scope.querySelectorAll('.salary-input').forEach((input) => {
    if (input.dataset.salaryClampBound === '1') return;
    input.dataset.salaryClampBound = '1';

    const errorSpan = input.nextElementSibling;

    input.addEventListener('keydown', (e) => {
      if (e.key === 'e' || e.key === 'E' || e.key === '+') {
        e.preventDefault();
        if (errorSpan) { errorSpan.textContent = 'Only numbers are allowed.'; }
        setTimeout(() => { if (errorSpan) errorSpan.textContent = ''; }, 2000);
      }
    });

    input.addEventListener('input', () => {
      const raw = input.value;
      if (!raw) { if (errorSpan) errorSpan.textContent = ''; return; }

      const intPart = raw.split('.')[0].replace(/^-/, '');
      if (intPart.length > 7) {
        const decimalIndex = raw.indexOf('.');
        const trimmedInt = intPart.slice(0, 7);
        input.value = decimalIndex >= 0
          ? `${trimmedInt}${raw.slice(decimalIndex)}`
          : trimmedInt;
      }

      const value = Number(input.value);
      if (Number.isFinite(value) && value > ADMIN_SALARY_MAX) {
        input.value = String(ADMIN_SALARY_MAX);
      }

      if (errorSpan) errorSpan.textContent = '';
    });
  });
}

function setupGovIdBankFieldValidation(scope = document) {
  const INVALID_CHARS = /[A-Za-z]/g;
  const fields = ['sss_number', 'pagibig_number', 'philhealth_number', 'bank_account_number'];

  fields.forEach((fieldName) => {
    scope.querySelectorAll(`[name="${fieldName}"]`).forEach((input) => {
      if (input.dataset.govIdBound === '1') return;
      input.dataset.govIdBound = '1';
      const errorSpan = input.nextElementSibling;
      input.addEventListener('input', () => {
        const original = input.value;
        const cleaned = original.replace(INVALID_CHARS, '');
        if (cleaned !== original) {
          const pos = input.selectionStart - (original.length - cleaned.length);
          input.value = cleaned;
          input.setSelectionRange(Math.max(0, pos), Math.max(0, pos));
          if (errorSpan && errorSpan.classList.contains('field-error')) {
            errorSpan.textContent = 'Letters are not allowed in this field.';
          }
        } else {
          if (errorSpan && errorSpan.classList.contains('field-error')) {
            errorSpan.textContent = '';
          }
        }
      });
    });
  });
}

function normalizeSuffix(value) {
  return String(value || '').trim().slice(0, 16);
}

function toTitleCaseWords(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return '';

  return normalized
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatDateOfBirthForPassword(dateValue) {
  const raw = String(dateValue || '').trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!match) return '';

  const [, year, month, day] = match;
  return `${month}${day}${year}`;
}

function buildDefaultPassword(lastName, dateOfBirth) {
  const sanitizedLastName = toTitleCaseWords(lastName).replaceAll(/\s+/g, '');
  const dobDigits = formatDateOfBirthForPassword(dateOfBirth);
  if (!sanitizedLastName || !dobDigits) return '';
  return `${sanitizedLastName}${dobDigits}`;
}

function composeFullName({ first_name = '', middle_initial = '', last_name = '', suffix = '' }) {
  const first = toTitleCaseWords(first_name);
  const middle = String(middle_initial || '').trim();
  const last = toTitleCaseWords(last_name);
  const resolvedSuffix = normalizeSuffix(suffix);

  const parts = [first, middle, last].filter(Boolean);
  return [parts.join(' '), resolvedSuffix].filter(Boolean).join(' ');
}

function splitFullName(fullName) {
  const raw = String(fullName || '').trim();
  if (!raw) {
    return {
      first_name: '',
      second_name: '',
      middle_initial: '',
      last_name: '',
      suffix: '',
    };
  }

  const tokens = raw.split(/\s+/).filter(Boolean);
  const result = {
    first_name: '',
    second_name: '',
    middle_initial: '',
    last_name: '',
    suffix: '',
  };

  if (tokens.length === 1) {
    result.first_name = tokens[0];
    return result;
  }

  let nameTokens = [...tokens];
  const maybeSuffix = nameTokens[nameTokens.length - 1];
  if (ALLOWED_SUFFIXES.includes(maybeSuffix)) {
    result.suffix = maybeSuffix;
    nameTokens.pop();
  }

  if (!nameTokens.length) return result;

  const maybeMiddle = nameTokens[nameTokens.length - 2] || '';
  if (/^[A-Za-z]\.?$/.test(maybeMiddle)) {
    result.middle_initial = maybeMiddle[0].toUpperCase();
    nameTokens.splice(nameTokens.length - 2, 1);
  }

  result.first_name = nameTokens[0] || '';
  result.last_name = nameTokens[nameTokens.length - 1] || '';
  result.second_name = nameTokens.slice(1, -1).join(' ');

  if (!result.second_name) {
    result.second_name = result.last_name;
  }

  return result;
}

function syncPositionFieldWithRole(form) {
  if (!form?.elements) return;

  const role = String(form.elements.role?.value || 'employee').toLowerCase();
  const positionInput = form.elements.position;
  if (!positionInput) return;

  positionInput.value = normalizePortalPosition(positionInput.value, role);
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Unknown date';
  }

  return new Intl.DateTimeFormat('en-PH', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatTimeOnly(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-PH', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}

function formatHours(value) {
  const total = Number(value || 0);
  if (!Number.isFinite(total) || total <= 0) return '—';

  const wholeHours = Math.floor(total);
  const minutes = Math.round((total - wholeHours) * 60);
  return `${wholeHours}h ${String(minutes).padStart(2, '0')}m`;
}

function renderDashboardPanels(panels = {}) {
  const totalEmployeesEl = document.getElementById('adm-panel-total-employees');
  const totalPayrollEl = document.getElementById('adm-panel-total-payroll');
  const absentTodayEl = document.getElementById('adm-panel-absent-today');

  if (totalEmployeesEl) totalEmployeesEl.textContent = String(panels.total_employees || 0);
  if (totalPayrollEl) totalPayrollEl.textContent = formatMoney(panels.total_payroll_month || 0);
  if (absentTodayEl) absentTodayEl.textContent = String(panels.absent_today || 0);

  const presentTodayEl = document.getElementById('adm-panel-present-today');
  const lateTodayEl = document.getElementById('adm-panel-late-today');
  const teachingCountEl = document.getElementById('adm-panel-teaching-count');
  const nonTeachingHintEl = document.getElementById('adm-panel-non-teaching-hint');
  const empBreakdownEl = document.getElementById('adm-panel-emp-breakdown');

  if (presentTodayEl) presentTodayEl.textContent = String(panels.present_today || 0);
  if (lateTodayEl) lateTodayEl.textContent = String(panels.late_today || 0);
  if (teachingCountEl) teachingCountEl.textContent = String(panels.teaching_count || 0);
  if (nonTeachingHintEl) nonTeachingHintEl.textContent = `Non-Teaching: ${panels.non_teaching_count || 0}`;
  if (empBreakdownEl) {
    const t = panels.teaching_count || 0;
    const nt = panels.non_teaching_count || 0;
    empBreakdownEl.textContent = `Teaching: ${t} · Non-Teaching: ${nt}`;
  }
}


function renderMonthlyPayrollChart(monthlyPayroll = []) {
  const chartContainer = document.getElementById('adm-monthly-payroll-chart');
  const avgEl = document.getElementById('adm-monthly-avg');
  const ytdEl = document.getElementById('adm-ytd-total');
  if (!chartContainer || !avgEl || !ytdEl) return;

  if (!monthlyPayroll.length) {
    chartContainer.innerHTML = '<div class="bc"><div class="bar active" style="height:42px;"></div><div class="bl">N/A</div></div>';
    avgEl.textContent = '₱ 0';
    ytdEl.textContent = '₱ 0';
    return;
  }

  const maxValue = Math.max(...monthlyPayroll.map((entry) => Number(entry.amount || 0)), 1);
  const total = monthlyPayroll.reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
  const avg = total / monthlyPayroll.length;

  chartContainer.innerHTML = monthlyPayroll.map((entry) => {
    const amount = Number(entry.amount || 0);
    const height = Math.max(24, Math.round((amount / maxValue) * 78));
    const label = escapeHtml(entry.label || 'N/A');
    const activeClass = entry.isCurrentMonth ? ' active' : '';
    return `<div class="bc"><div class="bar${activeClass}" style="height:${height}px;"></div><div class="bl">${label}</div></div>`;
  }).join('');

  avgEl.textContent = formatMoney(avg);
  ytdEl.textContent = formatMoney(total);
}

function renderRecentPayrollActivity(activity = []) {
  const list = document.getElementById('adm-recent-activity-list');
  if (!list) return;

  if (!activity.length) {
    list.innerHTML = '<div class="ai-item"><div class="ai2"><div class="s">No recent payroll activity available.</div></div></div>';
    return;
  }

  list.innerHTML = activity.slice(0, 5).map((item) => {
    const initials = getInitials(item.name);
    const avatarColor = getAvatarColor(item.id || item.name);
    const name = escapeHtml(item.name);
    const type = escapeHtml(item.employee_type);
    const subText = escapeHtml(item.sub_text || item.period || '');
    const status = String(item.status || '').toLowerCase();
    const isPaid = status === 'paid' || status === 'approved';
    const isRejected = status === 'on_hold' || status === 'rejected';
    const isNotPaid = status === 'not_paid' || status === 'unpaid';
    const statusClass = isPaid ? 'bg' : isRejected || isNotPaid ? 'br' : 'ba';
    const statusText = isPaid
      ? 'Paid'
      : isRejected
        ? 'On Hold'
        : isNotPaid
          ? 'Not Paid'
          : 'Pending';

    return `
      <div class="ai-item">
        <div class="av" style="width:32px;height:32px;font-size:11px;background:${avatarColor};">${initials}</div>
        <div class="ai2">
          <div class="n">${name} — ${type}</div>
          <div class="s">${subText}</div>
        </div>
        <div class="air">
          <div class="amt">${formatMoney(item.amount)}</div>
          <div class="st"><span class="badge ${statusClass}"><span class="bd"></span>${statusText}</span></div>
        </div>
      </div>
    `;
  }).join('');
}

function renderAttendancePanels(payload = {}) {
  const panels = payload?.panels || {};
  const presentEl = document.getElementById('adm-att-present');
  const lateEl = document.getElementById('adm-att-late');
  const absentEl = document.getElementById('adm-att-absent');
  const titleEl = document.getElementById('adm-attendance-title');

  if (presentEl) presentEl.textContent = String(panels.present_today || 0);
  if (lateEl) lateEl.textContent = String(panels.late_today || 0);
  if (absentEl) absentEl.textContent = String(panels.absent_today || 0);
  if (titleEl) {
    const dateLabel = payload?.date_label || 'Today';
    titleEl.textContent = `Attendance Log — ${dateLabel}`;
  }
}

function renderAttendanceTable(rows = []) {
  const tbody = document.getElementById('adm-attendance-table-body');
  if (!tbody) return;

  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="color:var(--t3);">No attendance records found for today.</td></tr>';
    return;
  }

  tbody.innerHTML = rows.map((row) => {
    const name = escapeHtml(row.employee_name || 'Unknown Employee');
    const type = escapeHtml(row.employee_type || 'Teaching');
    const typeBadgeClass = type === 'Non-Teaching' ? 'ba' : 'bt2';

    const status = String(row.status || 'Absent');
    const normalizedStatus = status.toLowerCase();
    const statusClass = normalizedStatus === 'late'
      ? 'ba'
      : (normalizedStatus === 'present' ? 'bg' : 'br');

    return `
      <tr>
        <td class="nm">${name}</td>
        <td><span class="badge ${typeBadgeClass}">${type}</span></td>
        <td class="mn">${formatTimeOnly(row.time_in)}</td>
        <td class="mn">${formatTimeOnly(row.time_out)}</td>
        <td class="mn">${formatHours(row.total_hours)}</td>
        <td><span class="badge ${statusClass}"><span class="bd"></span>${escapeHtml(status)}</span></td>
      </tr>
    `;
  }).join('');
}

function showRfidFeedback(message, isError = false) {
  const feedback = document.getElementById('adm-rfid-feedback');
  if (!feedback) return;

  feedback.textContent = message;
  feedback.classList.toggle('err', isError);
  feedback.classList.toggle('ok', !isError && Boolean(message));
}

async function loadAttendanceData() {
  const tbody = document.getElementById('adm-attendance-table-body');
  if (tbody) {
    tbody.innerHTML = skeletonRows(6);
  }

  try {
    const response = await fetch('/api/admin/attendance', { method: 'GET' });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || 'Failed to load attendance data');
    }

    attendanceData = payload;
    renderAttendancePanels(payload);
    if (attPaginator) {
      attPaginator.setData(payload.attendance_logs || []);
    } else {
      renderAttendanceTable(payload.attendance_logs || []);
    }
  } catch (error) {
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="6" style="color:#E85555;">${escapeHtml(error.message)}</td></tr>`;
    }
  }
}

function formatRfidScanFeedback(record) {
  if (!record) return '';
  const name = record.employee_name || 'Employee';
  if (record.time_out) {
    return `${name}: Time Out recorded at ${formatTimeOnly(record.time_out)}.`;
  }
  return `${name}: Time In recorded at ${formatTimeOnly(record.time_in)} (${record.status || 'Present'}).`;
}

// USB RFID readers plug in as HID keyboards: tapping a card types the UID
// into whichever input has focus, then sends Enter. Bound once so the field
// auto-submits on Enter instead of requiring a manual button click.
function attachRfidScannerInput() {
  const input = document.getElementById('adm-rfid-input');
  if (!input || input.dataset.scannerBound === '1') return;
  input.dataset.scannerBound = '1';

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      submitRfidAttendanceScan();
    }
  });

  // Some readers never send Enter/Tab after a tap — auto-submit once
  // keystrokes stop arriving for a beat so those readers still work.
  // Restricted to purely numeric values (RFID UIDs) so a paused manual
  // employee-ID entry (e.g. "SACS-001") never auto-fires mid-typing.
  let idleTimer = null;
  input.addEventListener('input', () => {
    clearTimeout(idleTimer);
    const value = input.value.trim();
    if (!/^\d{6,}$/.test(value)) return;
    idleTimer = setTimeout(() => {
      if (/^\d{6,}$/.test(input.value.trim()) && !rfidScanInFlight) submitRfidAttendanceScan();
    }, 400);
  });
}

let rfidScanInFlight = false;

async function submitRfidAttendanceScan() {
  const input = document.getElementById('adm-rfid-input');
  if (!input || rfidScanInFlight) return;

  const rfidCode = String(input.value || '').trim();
  if (!rfidCode) {
    showRfidFeedback('Enter RFID or employee ID first.', true);
    return;
  }

  rfidScanInFlight = true;
  input.disabled = true;

  try {
    showRfidFeedback('Processing RFID scan...', false);

    const response = await fetch('/api/admin/attendance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rfid_code: rfidCode }),
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || 'Failed to process RFID scan');
    }

    input.value = '';
    showRfidFeedback(formatRfidScanFeedback(payload.record) || payload.message || 'RFID scan recorded.', false);
    logAuditMovement({
      module: 'ui',
      action: 'rfid_scan',
      entity_type: 'attendance',
      entity_id: rfidCode,
      description: 'Admin submitted RFID attendance scan.',
      source: 'ui',
      metadata: { persisted: Boolean(payload.persisted) },
    });
    await loadAttendanceData();
  } catch (error) {
    showRfidFeedback(error.message, true);
  } finally {
    rfidScanInFlight = false;
    input.disabled = false;
    input.focus();
  }
}

function exportAttendanceCsv() {
  const rows = attendanceData?.attendance_logs || [];
  if (!rows.length) {
    window.alert('No attendance data available to export.');
    return;
  }

  const headers = ['Employee', 'Type', 'Time In', 'Time Out', 'Hours', 'Status'];
  const lines = [headers.join(',')];

  rows.forEach((row) => {
    lines.push([
      toCsvValue(row.employee_name || ''),
      toCsvValue(row.employee_type || ''),
      toCsvValue(formatTimeOnly(row.time_in)),
      toCsvValue(formatTimeOnly(row.time_out)),
      toCsvValue(formatHours(row.total_hours)),
      toCsvValue(row.status || ''),
    ].join(','));
  });

  const csvContent = `\uFEFF${lines.join('\n')}`;
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  const dateKey = String(attendanceData?.date_key || 'today').replaceAll('/', '-');

  anchor.href = url;
  anchor.download = `sacs-attendance-${dateKey}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);

  logAuditMovement({
    module: 'ui',
    action: 'export_csv',
    entity_type: 'attendance',
    entity_id: dateKey,
    description: 'Admin exported attendance CSV.',
    source: 'ui',
    metadata: { row_count: rows.length },
  });
}

function toCsvValue(value) {
  const text = String(value ?? '');
  if (text.includes(',') || text.includes('"') || text.includes('\n')) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

async function logAuditMovement(payload) {
  try {
    await fetch('/api/admin/audit-logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    // Keep user flow unaffected when audit endpoint is unavailable.
  }
}

function renderAuditSummary(summary = {}) {
  const totalEl = document.getElementById('adm-audit-total');
  const successEl = document.getElementById('adm-audit-success');
  const failedEl = document.getElementById('adm-audit-failed');

  if (totalEl) totalEl.textContent = String(summary.total || 0);
  if (successEl) successEl.textContent = String(summary.success || 0);
  if (failedEl) failedEl.textContent = String(summary.failed || 0);
}

function renderAuditTable(logs = []) {
  const tbody = document.getElementById('adm-audit-table-body');
  if (!tbody) return;

  if (!logs.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="color:var(--t3);">No audit logs found for current filters.</td></tr>';
    return;
  }

  tbody.innerHTML = logs.map((log) => {
    const timestamp = escapeHtml(formatDateTime(log.created_at));
    const moduleName = escapeHtml(String(log.module || '').replaceAll('_', ' '));
    const action = escapeHtml(String(log.action || '').replaceAll('_', ' '));
    const entity = `${escapeHtml(log.entity_type || '')}${log.entity_id ? ` · ${escapeHtml(log.entity_id)}` : ''}`;
    const description = escapeHtml(log.description || 'No description provided.');
    const status = String(log.status || '').toLowerCase();
    const statusClass = status === 'success' ? 'bg' : status === 'failed' ? 'br' : 'ba';
    const source = escapeHtml(log.source || 'api');

    return `
      <tr>
        <td class="mn">${timestamp}</td>
        <td>${moduleName}</td>
        <td>${action}</td>
        <td class="mn">${entity || '—'}</td>
        <td>${description}</td>
        <td><span class="badge ${statusClass}"><span class="bd"></span>${escapeHtml(status)}</span></td>
        <td>${source}</td>
      </tr>
    `;
  }).join('');
}

function setAuditSearch(value) {
  auditSearch = String(value || '').trim();
  loadAuditLogs();
}

function setAuditModuleFilter(value) {
  auditModuleFilter = String(value || 'all').trim().toLowerCase();
  loadAuditLogs();
}

function setAuditActionFilter(value) {
  auditActionFilter = String(value || 'all').trim().toLowerCase();
  loadAuditLogs();
}

async function loadAuditLogs() {
  const tbody = document.getElementById('adm-audit-table-body');
  if (tbody) {
    tbody.innerHTML = skeletonRows(7);
  }

  try {
    const params = new URLSearchParams({
      module: auditModuleFilter,
      action: auditActionFilter,
      search: auditSearch,
      limit: '250',
    });

    const response = await fetch(`/api/admin/audit-logs?${params.toString()}`, { method: 'GET' });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || 'Failed to load audit logs');
    }

    auditLogsData = payload.logs || [];
    auditSummary = payload.summary || { total: 0, success: 0, failed: 0 };
    renderAuditSummary(auditSummary);
    if (auditPaginator) {
      auditPaginator.setData(auditLogsData);
    } else {
      renderAuditTable(auditLogsData);
    }
  } catch (error) {
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="7" style="color:#E85555;">${escapeHtml(error.message)}</td></tr>`;
    }
  }
}

function exportAuditLogsCsv() {
  if (!auditLogsData.length) {
    window.alert('No audit logs available to export.');
    return;
  }

  const headers = ['Timestamp', 'Module', 'Action', 'Entity Type', 'Entity ID', 'Description', 'Status', 'Source'];
  const lines = [headers.join(',')];

  auditLogsData.forEach((log) => {
    lines.push([
      toCsvValue(formatDateTime(log.created_at)),
      toCsvValue(log.module || ''),
      toCsvValue(log.action || ''),
      toCsvValue(log.entity_type || ''),
      toCsvValue(log.entity_id || ''),
      toCsvValue(log.description || ''),
      toCsvValue(log.status || ''),
      toCsvValue(log.source || ''),
    ].join(','));
  });

  const csvContent = `\uFEFF${lines.join('\n')}`;
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');

  anchor.href = url;
  anchor.download = 'sacs-audit-logs.csv';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);

  logAuditMovement({
    module: 'ui',
    action: 'export_csv',
    entity_type: 'audit_logs',
    entity_id: 'audit_logs',
    description: 'Admin exported audit logs CSV.',
    source: 'ui',
    metadata: { row_count: auditLogsData.length },
  });
}

function renderDashboard(data) {
  dashboardData = data || null;
  const panels = data?.panels || {};

  renderDashboardPanels(panels);
  renderRecentPayrollActivity(data?.recent_activity || []);
}

async function loadDashboard() {
  try {
    const response = await fetch('/api/admin/dashboard', { method: 'GET' });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || 'Failed to load dashboard data');
    }

    renderDashboard(payload);
  } catch (error) {
    console.error('Dashboard load error:', error.message);
  }
}

window.onAddUserRoleChange = onAddUserRoleChange;
window.openAddUserModal = openAddUserModal;
window.closeAddUserModal = closeAddUserModal;
window.submitAddUser = submitAddUser;
window.openEditUserModal = openEditUserModal;
window.closeEditUserModal = closeEditUserModal;
window.submitEditUser = submitEditUser;
window.toggleArchiveCurrentUser = toggleArchiveCurrentUser;
window.setUserRoleFilter = setUserRoleFilter;
window.setUserSearch = setUserSearch;
window.openRfidEditModal = openRfidEditModal;
window.closeRfidEditModal = closeRfidEditModal;
window.submitRfidUpdate = submitRfidUpdate;
window.voidRfidCard = voidRfidCard;
window.setRfidDeviceSearch = setRfidDeviceSearch;
window.loadSystemData = loadSystemData;
window.submitRfidAttendanceScan = submitRfidAttendanceScan;
window.exportAttendanceCsv = exportAttendanceCsv;
window.setAuditSearch = setAuditSearch;
window.setAuditModuleFilter = setAuditModuleFilter;
window.setAuditActionFilter = setAuditActionFilter;
window.exportAuditLogsCsv = exportAuditLogsCsv;
window.loadBranchAssignment = loadBranchAssignment;
window.setBranchFilter = setBranchFilter;
window.setBranchSearch = setBranchSearch;
window.openBranchAssignModal = openBranchAssignModal;
window.closeBranchAssignModal = closeBranchAssignModal;
window.submitBranchAssign = submitBranchAssign;
window.loadAdminProfile = loadAdminProfile;

/* ── CHANGE PASSWORD ── */
function showAdmChangePasswordFeedback(message, isError = false) {
  const el = document.getElementById('adm-change-password-feedback');
  if (!el) return;
  el.textContent = message;
  el.classList.toggle('err', isError);
  el.classList.toggle('ok', !isError && Boolean(message));
}

async function submitAdminChangePassword() {
  const context = window.getLegacyAuthContext ? window.getLegacyAuthContext() : null;
  const email = String(context?.email || '').trim();

  const currentPassword = String(document.getElementById('adm-cur-password')?.value || '').trim();
  const newPassword = String(document.getElementById('adm-new-password')?.value || '').trim();
  const confirmPassword = String(document.getElementById('adm-confirm-password')?.value || '').trim();

  if (!email) { showAdmChangePasswordFeedback('Unable to identify account. Please sign in again.', true); return; }
  if (!currentPassword || !newPassword || !confirmPassword) { showAdmChangePasswordFeedback('All password fields are required.', true); return; }
  if (newPassword !== confirmPassword) { showAdmChangePasswordFeedback('New passwords do not match.', true); return; }
  if (newPassword.length < 8) { showAdmChangePasswordFeedback('New password must be at least 8 characters.', true); return; }

  try {
    showAdmChangePasswordFeedback('Updating password...', false);
    const response = await fetch('/api/legacy-auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, current_password: currentPassword, new_password: newPassword }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Failed to update password.');

    document.getElementById('adm-cur-password').value = '';
    document.getElementById('adm-new-password').value = '';
    document.getElementById('adm-confirm-password').value = '';

    showAdmChangePasswordFeedback('Password updated successfully.', false);
    window.pushNotification?.('Password Changed', 'Your account password has been updated successfully.', 'success');
    setTimeout(() => window.closeSettingsModal?.('adm'), 1200);
  } catch (error) {
    showAdmChangePasswordFeedback(error.message, true);
  }
}

window.submitAdminChangePassword = submitAdminChangePassword;

/* ═══════════════════════════════════════
   USER MANAGEMENT
   ═══════════════════════════════════════ */

const ROLE_LABELS = {
  admin:     'Administrator',
  hr:        'HR',
  accountant:'Accountant',
  employee:  'Employee',
};

const ROLE_BADGE_CLASS = {
  admin:     'ba',
  hr:        'bt2',
  accountant:'bt2',
  employee:  'bg',
};

function getRoleLabel(role) {
  return ROLE_LABELS[String(role || '').toLowerCase()] || 'Employee';
}

function getRoleBadgeClass(role) {
  return ROLE_BADGE_CLASS[String(role || '').toLowerCase()] || 'bg';
}

function updateUserPanels() {
  const active = allUsers.filter((u) => !u.archived);
  const archived = allUsers.filter((u) => u.archived);

  const totalEl = document.getElementById('adm-users-total');
  const activeEl = document.getElementById('adm-users-active');
  const archivedEl = document.getElementById('adm-users-archived');

  if (totalEl) totalEl.textContent = String(allUsers.length);
  if (activeEl) activeEl.textContent = String(active.length);
  if (archivedEl) archivedEl.textContent = String(archived.length);

  document.querySelectorAll('#adm-users-filter-chips .chip').forEach((chip) => {
    const filter = chip.getAttribute('data-role-filter');
    if (filter === 'all') {
      chip.textContent = `All (${active.length})`;
    } else if (filter === 'archived') {
      chip.textContent = `Archived (${archived.length})`;
    } else {
      const count = active.filter((u) => u.role === filter).length;
      chip.textContent = `${getRoleLabel(filter)} (${count})`;
    }
  });
}

function getFilteredUsers() {
  const search = userSearch.toLowerCase();
  return allUsers.filter((user) => {
    if (userRoleFilter === 'archived') return user.archived;
    if (user.archived) return false;
    if (userRoleFilter !== 'all' && user.role !== userRoleFilter) return false;
    if (!search) return true;
    const haystack = [user.full_name, user.email, user.role, user.employee_type, user.employee_id]
      .map((v) => String(v || '').toLowerCase())
      .join(' ');
    return haystack.includes(search);
  });
}

function renderUsers(users) {
  const tbody = document.getElementById('adm-users-table-body');
  if (!tbody) return;

  if (!users.length) {
    tbody.innerHTML = `<tr><td colspan="11" style="color:var(--t3);">No users found.</td></tr>`;
    return;
  }

  tbody.innerHTML = users.map((user) => {
    const initials = getInitials(user.full_name);
    const avatarColor = getAvatarColor(user.email || user.id);
    const role = String(user.role || 'employee').toLowerCase();
    const badgeClass = getRoleBadgeClass(role);
    const statusClass = user.archived ? 'br' : 'bg';
    const statusText = user.archived ? 'Archived' : 'Active';
    const lastLogin = user.last_sign_in ? formatDateTime(user.last_sign_in) : 'Never';
    const safeId = escapeHtml(user.id);
    const safeName = escapeHtml(user.full_name);
    const safeEmail = escapeHtml(user.email);
    const typeText = user.employee_type ? escapeHtml(user.employee_type) : '—';
    const typeClass = user.employee_type === 'Non-Teaching' ? 'ba' : (user.employee_type ? 'bt2' : '');
    const empIdText = user.employee_id ? escapeHtml(user.employee_id) : '—';
    const cpNumberText = user.cp_number ? escapeHtml(user.cp_number) : '—';
    const branchText = user.branch_id
      ? escapeHtml(admAssignBranches.find((b) => b.id === user.branch_id)?.name || user.branch_id)
      : '—';
    const dateHiredText = user.date_hired ? escapeHtml(user.date_hired) : '—';

    return `
      <tr>
        <td class="nm">
          <div style="display:flex;align-items:center;gap:9px;">
            <div class="av" style="width:28px;height:28px;font-size:10px;background:${avatarColor};">${initials}</div>
            ${safeName}
          </div>
        </td>
        <td class="mn">${safeEmail}</td>
        <td><span class="badge ${badgeClass}">${escapeHtml(getRoleLabel(role))}</span></td>
        <td>${typeClass ? `<span class="badge ${typeClass}">${typeText}</span>` : `<span style="color:var(--t3);">—</span>`}</td>
        <td class="mn">${empIdText}</td>
        <td class="mn">${cpNumberText}</td>
        <td class="mn">${branchText}</td>
        <td class="mn" style="font-size:11px;">${dateHiredText}</td>
        <td class="mn" style="font-size:11px;">${escapeHtml(lastLogin)}</td>
        <td><span class="badge ${statusClass}"><span class="bd"></span>${statusText}</span></td>
        <td><button class="btn btn-outline" style="font-size:11px;padding:5px 11px;" onclick="openEditUserModal('${safeId}')">Edit</button></td>
      </tr>
    `;
  }).join('');
}

function renderFilteredUsers() {
  updateUserPanels();
  if (usersPaginator) {
    usersPaginator.setData(getFilteredUsers());
  } else {
    renderUsers(getFilteredUsers());
  }
}

function setUserRoleFilter(filter) {
  userRoleFilter = filter;
  document.querySelectorAll('#adm-users-filter-chips .chip').forEach((chip) => {
    chip.classList.toggle('active', chip.getAttribute('data-role-filter') === filter);
  });
  renderFilteredUsers();
}

function setUserSearch(value) {
  userSearch = String(value || '').trim();
  renderFilteredUsers();
}

async function loadUsers() {
  const tbody = document.getElementById('adm-users-table-body');
  if (tbody) tbody.innerHTML = skeletonRows(11);

  try {
    const [usersRes, empRes, branches] = await Promise.all([
      fetch('/api/admin/users', { method: 'GET' }),
      fetch('/api/admin/employees', { method: 'GET' }),
      fetchBranchesCached().catch(() => admAssignBranches),
    ]);
    admAssignBranches = branches;
    const usersPayload = await usersRes.json();
    if (!usersRes.ok) throw new Error(usersPayload.error || 'Failed to load users');

    const empPayload = empRes.ok ? await empRes.json() : { employees: [] };
    const empMap = new Map((empPayload.employees || []).map((e) => [e.id, e]));

    allUsers = (usersPayload.users || []).map((u) => {
      const empData = empMap.get(u.id) || {};
      return { ...u, ...empData, last_sign_in: u.last_sign_in, created_at: u.created_at };
    });

    renderFilteredUsers();
  } catch (error) {
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="11" style="color:#E85555;">${escapeHtml(error.message)}</td></tr>`;
    }
  }
}

function showAddUserFeedback(message, isError = false) {
  const el = document.getElementById('add-user-feedback');
  if (!el) return;
  el.textContent = message;
  el.classList.toggle('err', isError);
  el.classList.toggle('ok', !isError && Boolean(message));
}

function onAddUserRoleChange(role) {
  const form = document.getElementById('add-user-form');
  if (!form) return;
  const isEmpRole = ['employee', 'accountant', 'hr'].includes(String(role || '').toLowerCase());
  form.querySelectorAll('.adm-emp-fields').forEach((el) => { el.style.display = isEmpRole ? '' : 'none'; });
  form.querySelectorAll('.adm-nomp-fields').forEach((el) => { el.style.display = isEmpRole ? 'none' : ''; });
  syncPositionFieldWithRole(form);
}

function openAddUserModal() {
  const modal = document.getElementById('add-user-modal');
  const form = document.getElementById('add-user-form');
  if (!modal || !form) return;
  form.reset();
  if (form.elements.suffix) form.elements.suffix.value = '';
  showAddUserFeedback('');
  form.querySelectorAll('.field-error').forEach((el) => { el.textContent = ''; });
  onAddUserRoleChange('employee');
  modal.style.display = 'flex';
}

function closeAddUserModal() {
  const modal = document.getElementById('add-user-modal');
  if (modal) modal.style.display = 'none';
}

async function submitAddUser(event) {
  event.preventDefault();
  const form = event.target;
  const submitBtn = form.querySelector('button[type="submit"]');
  const formData = new FormData(form);

  const role = String(formData.get('role') || 'employee').trim().toLowerCase();
  const firstName = String(formData.get('first_name') || '').trim();
  const lastName = String(formData.get('last_name') || '').trim();
  const middleInitial = String(formData.get('middle_initial') || '').trim();
  const suffix = String(formData.get('suffix') || '').trim();
  const email = String(formData.get('email') || '').trim();
  const isEmpRole = ['employee', 'accountant', 'hr'].includes(role);

  if (!firstName || !lastName) {
    showAddUserFeedback('First name and last name are required.', true);
    return;
  }
  if (!email) {
    showAddUserFeedback('Email is required.', true);
    return;
  }

  const fullName = composeFullName({ first_name: firstName, middle_initial: middleInitial, last_name: lastName, suffix });

  try {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Creating...';

    let response;
    if (isEmpRole) {
      const dateOfBirth = String(formData.get('date_of_birth') || '').trim();
      if (!dateOfBirth) {
        showAddUserFeedback('Date of birth is required.', true);
        submitBtn.disabled = false;
        submitBtn.textContent = 'Create User';
        return;
      }
      response = await fetch('/api/admin/employees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          first_name: firstName,
          middle_initial: middleInitial,
          last_name: lastName,
          suffix,
          email,
          role,
          date_of_birth: dateOfBirth,
          employee_type: String(formData.get('employee_type') || 'Teaching').trim(),
          position: String(formData.get('position') || '').trim(),
          basic_salary: Number(formData.get('basic_salary') || 0) || 0,
          employee_status: String(formData.get('employee_status') || 'Active').trim(),
          address: String(formData.get('address') || '').trim(),
          cp_number: String(formData.get('cp_number') || '').trim(),
          date_hired: String(formData.get('date_hired') || '').trim(),
          sss_number: String(formData.get('sss_number') || '').trim(),
          pagibig_number: String(formData.get('pagibig_number') || '').trim(),
          philhealth_number: String(formData.get('philhealth_number') || '').trim(),
          bank_name: String(formData.get('bank_name') || '').trim(),
          bank_account_number: String(formData.get('bank_account_number') || '').trim(),
        }),
      });
    } else {
      const password = String(formData.get('password') || '').trim();
      if (!password || password.length < 6) {
        showAddUserFeedback('Password must be at least 6 characters.', true);
        submitBtn.disabled = false;
        submitBtn.textContent = 'Create User';
        return;
      }
      response = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ full_name: fullName, email, role, password }),
      });
    }

    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Failed to create user');

    showAddUserFeedback('User account created successfully.', false);
    window.pushNotification?.('User Created', `New ${role} account created for ${fullName}.`, 'success');
    await loadUsers();
    setTimeout(() => closeAddUserModal(), 500);
  } catch (error) {
    showAddUserFeedback(error.message, true);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Create User';
  }
}

function showEditUserFeedback(message, isError = false) {
  const el = document.getElementById('edit-user-feedback');
  if (!el) return;
  el.textContent = message;
  el.classList.toggle('err', isError);
  el.classList.toggle('ok', !isError && Boolean(message));
}

function openEditUserModal(userId) {
  const modal = document.getElementById('edit-user-modal');
  const form = document.getElementById('edit-user-form');
  const archiveBtn = document.getElementById('archive-user-button');
  if (!modal || !form || !archiveBtn) return;

  currentEditingUser = allUsers.find((u) => u.id === userId);
  if (!currentEditingUser) {
    window.alert('User record not found. Please refresh the list.');
    return;
  }

  const nameParts = splitFullName(currentEditingUser.full_name || '');

  form.elements.id.value = currentEditingUser.id;
  const midName = nameParts.middle_initial
    || (nameParts.second_name && nameParts.second_name !== nameParts.last_name ? nameParts.second_name : '');

  if (form.elements.first_name) form.elements.first_name.value = nameParts.first_name || '';
  if (form.elements.middle_initial) form.elements.middle_initial.value = midName;
  if (form.elements.last_name) form.elements.last_name.value = nameParts.last_name || '';
  if (form.elements.suffix) form.elements.suffix.value = nameParts.suffix || '';
  form.elements.email.value = currentEditingUser.email || '';
  form.elements.role.value = currentEditingUser.role || 'employee';
  if (form.elements.password) form.elements.password.value = '';

  const hasEmpProfile = Boolean(currentEditingUser.employee_id);
  form.querySelectorAll('.adm-edit-emp-fields').forEach((el) => {
    el.style.display = hasEmpProfile ? '' : 'none';
  });

  if (hasEmpProfile) {
    if (form.elements.employee_id) form.elements.employee_id.value = currentEditingUser.employee_id || '';
    if (form.elements.date_of_birth) form.elements.date_of_birth.value = currentEditingUser.date_of_birth || '';
    if (form.elements.employee_type) form.elements.employee_type.value = currentEditingUser.employee_type || 'Teaching';
    if (form.elements.position) form.elements.position.value = currentEditingUser.position || 'Employee';
    if (form.elements.employee_status) form.elements.employee_status.value = currentEditingUser.employee_status || 'Active';
    if (form.elements.basic_salary) form.elements.basic_salary.value = currentEditingUser.basic_salary || 0;
    if (form.elements.address) form.elements.address.value = currentEditingUser.address || '';
    if (form.elements.cp_number) form.elements.cp_number.value = currentEditingUser.cp_number || '';
    if (form.elements.date_hired) form.elements.date_hired.value = currentEditingUser.date_hired || '';
    if (form.elements.sss_number) form.elements.sss_number.value = currentEditingUser.sss_number || '';
    if (form.elements.pagibig_number) form.elements.pagibig_number.value = currentEditingUser.pagibig_number || '';
    if (form.elements.philhealth_number) form.elements.philhealth_number.value = currentEditingUser.philhealth_number || '';
    if (form.elements.bank_name) form.elements.bank_name.value = currentEditingUser.bank_name || '';
    if (form.elements.bank_account_number) form.elements.bank_account_number.value = currentEditingUser.bank_account_number || '';
  }

  archiveBtn.className = currentEditingUser.archived ? 'btn btn-green' : 'btn btn-red';
  archiveBtn.textContent = currentEditingUser.archived ? 'Restore User' : 'Archive User';

  showEditUserFeedback('');
  form.querySelectorAll('.field-error').forEach((el) => { el.textContent = ''; });
  modal.style.display = 'flex';
}

function closeEditUserModal() {
  const modal = document.getElementById('edit-user-modal');
  if (modal) modal.style.display = 'none';
}

async function toggleArchiveCurrentUser() {
  if (!currentEditingUser) return;
  const archiveBtn = document.getElementById('archive-user-button');
  if (!archiveBtn) return;

  const action = currentEditingUser.archived ? 'restore' : 'archive';
  const prompt = action === 'archive'
    ? 'archive this user account'
    : 'restore this user account';
  const detail = action === 'archive'
    ? 'Archived users cannot log in and will be hidden from active lists.'
    : 'This user account will be restored to active status.';

  // Restoring is a positive action, so it uses the green confirm dialog;
  // archiving keeps the red warning.
  const confirmFn = action === 'restore'
    ? (window.confirmApproveAction
        && ((p, d) => window.confirmApproveAction(p, d, { title: 'Confirm Restore', confirmLabel: 'Restore' })))
    : window.confirmDestructiveAction;

  if (confirmFn && !(await confirmFn(prompt, detail))) {
    return;
  }

  try {
    archiveBtn.disabled = true;
    archiveBtn.textContent = action === 'archive' ? 'Archiving...' : 'Restoring...';

    const response = await fetch('/api/admin/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: currentEditingUser.id, action }),
    });

    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Failed to update user');

    showEditUserFeedback(action === 'archive' ? 'User archived.' : 'User restored.', false);
    window.pushNotification?.(
      action === 'archive' ? 'User Archived' : 'User Restored',
      action === 'archive' ? 'The user account has been archived.' : 'The user account has been restored.',
      'info',
    );
    await loadUsers();
    closeEditUserModal();
  } catch (error) {
    showEditUserFeedback(error.message, true);
  } finally {
    archiveBtn.disabled = false;
    archiveBtn.textContent = currentEditingUser?.archived ? 'Restore User' : 'Archive User';
  }
}

async function submitEditUser(event) {
  event.preventDefault();
  const form = event.target;
  const submitBtn = form.querySelector('button[type="submit"]');
  const formData = new FormData(form);

  const id = String(formData.get('id') || '').trim();
  const firstName = String(formData.get('first_name') || '').trim();
  const lastName = String(formData.get('last_name') || '').trim();
  const middleInitial = String(formData.get('middle_initial') || '').trim();
  const suffix = String(formData.get('suffix') || '').trim();
  const email = String(formData.get('email') || '').trim();
  const role = String(formData.get('role') || 'employee').trim();
  const password = String(formData.get('password') || '').trim();

  if (!id || !firstName || !lastName || !email) {
    showEditUserFeedback('First name, last name, and email are required.', true);
    return;
  }

  if (password && password.length < 6) {
    showEditUserFeedback('Password must be at least 6 characters.', true);
    return;
  }

  const fullName = composeFullName({ first_name: firstName, middle_initial: middleInitial, last_name: lastName, suffix });
  const hasEmpProfile = Boolean(currentEditingUser?.employee_id);

  try {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Saving...';

    let response;
    if (hasEmpProfile) {
      const payload = {
        id,
        action: 'update',
        full_name: fullName,
        email,
        role,
        employee_type: String(formData.get('employee_type') || 'Teaching').trim(),
        position: String(formData.get('position') || '').trim(),
        basic_salary: Number(formData.get('basic_salary') || 0) || 0,
        date_of_birth: String(formData.get('date_of_birth') || '').trim(),
        employee_status: String(formData.get('employee_status') || 'Active').trim(),
        address: String(formData.get('address') || '').trim(),
        cp_number: String(formData.get('cp_number') || '').trim(),
        date_hired: String(formData.get('date_hired') || '').trim(),
        sss_number: String(formData.get('sss_number') || '').trim(),
        pagibig_number: String(formData.get('pagibig_number') || '').trim(),
        philhealth_number: String(formData.get('philhealth_number') || '').trim(),
        bank_name: String(formData.get('bank_name') || '').trim(),
        bank_account_number: String(formData.get('bank_account_number') || '').trim(),
      };
      if (password) payload.password = password;

      response = await fetch('/api/admin/employees', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } else {
      const payload = { id, action: 'update', full_name: fullName, email, role };
      if (password) payload.password = password;

      response = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    }

    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Failed to update user');

    showEditUserFeedback('User account updated.', false);
    window.pushNotification?.('User Updated', 'User account details have been saved.', 'success');
    await loadUsers();
    closeEditUserModal();
  } catch (error) {
    showEditUserFeedback(error.message, true);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Save Changes';
  }
}

/* ═══════════════════════════════════════
   TRANSFER REQUESTS (Admin: create + view own)
   ═══════════════════════════════════════ */

async function loadAdminTransferRequests() {
  const tbody = document.getElementById('adm-transfer-requests-table-body');
  if (tbody) tbody.innerHTML = skeletonRows(6);

  try {
    admAssignBranches = await fetchBranchesCached();
    if (!allUsers.length) {
      await loadUsers();
    }

    const response = await fetch('/api/admin/transfer-requests');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Failed to load transfer requests.');

    adminTransferPending = data.pending_requests || [];
    adminTransferHistory = data.history_requests || [];
    renderAdminTransferRequests();
  } catch (error) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="6" style="color:#E85555;">${escapeHtml(error.message)}</td></tr>`;
  }
}

function branchNameById(branchId) {
  return admAssignBranches.find((b) => b.id === branchId)?.name || branchId || '—';
}

function transferStatusBadge(status) {
  if (status === 'approved') return '<span class="badge bg"><span class="bd"></span>Approved</span>';
  if (status === 'rejected') return '<span class="badge br"><span class="bd"></span>Rejected</span>';
  return '<span class="badge ba"><span class="bd"></span>Pending</span>';
}

function renderAdminTransferRequests() {
  const tbody = document.getElementById('adm-transfer-requests-table-body');
  if (!tbody) return;

  const rows = [...adminTransferPending, ...adminTransferHistory];
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="color:var(--t3);">No transfer requests yet.</td></tr>';
    return;
  }

  tbody.innerHTML = rows.map((req) => `
    <tr>
      <td>${escapeHtml(req.employee_name || req.employee_id || 'Unknown')}</td>
      <td>${escapeHtml(branchNameById(req.from_branch_id))}</td>
      <td>${escapeHtml(branchNameById(req.to_branch_id))}</td>
      <td>${transferStatusBadge(req.status)}</td>
      <td>${escapeHtml(req.remarks || '—')}</td>
      <td>${req.created_at ? new Date(req.created_at).toLocaleDateString() : '—'}</td>
    </tr>
  `).join('');
}

function openTransferRequestModal() {
  const modal = document.getElementById('transfer-request-modal');
  const employeeSelect = document.getElementById('transfer-request-employee');
  const branchSelect = document.getElementById('transfer-request-to-branch');
  if (!modal || !employeeSelect || !branchSelect) return;

  employeeSelect.innerHTML = allUsers
    .filter((u) => !u.archived)
    .map((u) => `<option value="${escapeHtml(u.id)}">${escapeHtml(u.full_name || u.email)}</option>`)
    .join('');

  branchSelect.innerHTML = admAssignBranches
    .map((b) => `<option value="${escapeHtml(b.id)}">${escapeHtml(b.name)}</option>`)
    .join('');

  const form = document.getElementById('transfer-request-form');
  form?.reset();
  const feedback = document.getElementById('transfer-request-feedback');
  if (feedback) { feedback.textContent = ''; feedback.classList.remove('ok', 'err'); }

  modal.style.display = 'flex';
}

function closeTransferRequestModal() {
  const modal = document.getElementById('transfer-request-modal');
  if (modal) modal.style.display = 'none';
}

async function submitTransferRequest(event) {
  event.preventDefault();
  const form = event.target;
  const submitBtn = form.querySelector('button[type="submit"]');
  const formData = new FormData(form);
  const feedback = document.getElementById('transfer-request-feedback');

  const employeeId = String(formData.get('employee_id') || '').trim();
  const toBranchId = String(formData.get('to_branch_id') || '').trim();
  const remarks = String(formData.get('remarks') || '').trim();

  if (!employeeId || !toBranchId) {
    if (feedback) { feedback.textContent = 'Employee and destination branch are required.'; feedback.classList.add('err'); }
    return;
  }

  try {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting...';

    const response = await fetch('/api/admin/transfer-requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employee_id: employeeId, to_branch_id: toBranchId, remarks }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Failed to submit transfer request.');

    window.pushNotification?.('Transfer Request Submitted', 'Waiting for Super Admin approval.', 'success');
    await loadAdminTransferRequests();
    setTimeout(() => closeTransferRequestModal(), 500);
  } catch (error) {
    if (feedback) { feedback.textContent = error.message; feedback.classList.add('err'); }
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Submit Request';
  }
}

/* ═══════════════════════════════════════
   SYSTEM MAINTENANCE
   ═══════════════════════════════════════ */

function renderSystemHealthPanels(data) {
  const dbStatus = document.getElementById('adm-sys-db-status');
  const attStatus = document.getElementById('adm-sys-att-status');
  const payStatus = document.getElementById('adm-sys-pay-status');
  const rfidCount = document.getElementById('adm-sys-rfid-count');
  const rfidHint = document.getElementById('adm-sys-rfid-hint');

  const dbOk = data?.database_status?.connection === 'ok';
  const attOk = data?.database_status?.attendance_logs === 'ok';
  const payOk = data?.database_status?.payroll_records === 'ok';

  if (dbStatus) {
    dbStatus.textContent = dbOk ? 'OK' : 'Error';
    dbStatus.className = `cv ${dbOk ? 'g' : 'r'}`;
  }
  if (attStatus) {
    attStatus.textContent = attOk ? 'OK' : 'Missing';
    attStatus.className = `cv ${attOk ? 'g' : 'a'}`;
  }
  if (payStatus) {
    payStatus.textContent = payOk ? 'OK' : 'Missing';
    payStatus.className = `cv ${payOk ? 'g' : 'a'}`;
  }
  const stats = data?.system_stats || {};
  if (rfidCount) rfidCount.textContent = String(stats.rfid_registered || 0);
  if (rfidHint) rfidHint.textContent = `Unregistered: ${stats.rfid_unregistered || 0}`;
}

function renderSecurityEvents(logs = []) {
  const tbody = document.getElementById('adm-security-events-body');
  if (!tbody) return;

  if (!logs.length) {
    tbody.innerHTML = `<tr><td colspan="5" style="color:var(--t3);">No recent security events.</td></tr>`;
    return;
  }

  tbody.innerHTML = logs.slice(0, 10).map((log) => {
    const timestamp = escapeHtml(formatDateTime(log.created_at));
    const moduleName = escapeHtml(String(log.module || '').replaceAll('_', ' '));
    const action = escapeHtml(String(log.action || '').replaceAll('_', ' '));
    const description = escapeHtml(log.description || 'No description.');
    const status = String(log.status || '').toLowerCase();
    const statusClass = status === 'success' ? 'bg' : status === 'failed' ? 'br' : 'ba';

    return `
      <tr>
        <td class="mn">${timestamp}</td>
        <td>${moduleName}</td>
        <td>${action}</td>
        <td>${description}</td>
        <td><span class="badge ${statusClass}"><span class="bd"></span>${escapeHtml(status)}</span></td>
      </tr>
    `;
  }).join('');
}

function getFilteredRfidDevices() {
  const search = rfidDeviceSearch.toLowerCase();
  if (!search) return allRfidDevices;
  return allRfidDevices.filter((device) => {
    const haystack = [device.full_name, device.employee_id, device.rfid_uid]
      .map((v) => String(v || '').toLowerCase())
      .join(' ');
    return haystack.includes(search);
  });
}

function renderRfidDevices(devices) {
  const tbody = document.getElementById('adm-rfid-table-body');
  if (!tbody) return;

  if (!devices.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="color:var(--t3);">No employees found.</td></tr>`;
    return;
  }

  tbody.innerHTML = devices.map((device) => {
    const safeName = escapeHtml(device.full_name);
    const safeEmpId = escapeHtml(device.employee_id || 'N/A');
    const safeType = escapeHtml(device.employee_type || 'Teaching');
    const typeBadge = safeType === 'Non-Teaching' ? 'ba' : 'bt2';
    const hasRfid = Boolean(String(device.rfid_uid || '').trim());
    const rfidDisplay = hasRfid ? escapeHtml(device.rfid_uid) : '—';
    const rfidBadge = hasRfid ? 'bg' : 'ba';
    const rfidStatus = hasRfid ? 'Assigned' : 'Unassigned';
    const deviceId = escapeHtml(device.id);
    const isArchived = device.archived;

    if (isArchived) return '';

    return `
      <tr>
        <td class="nm">${safeName}</td>
        <td class="mn">${safeEmpId}</td>
        <td><span class="badge ${typeBadge}">${safeType}</span></td>
        <td class="mn" style="font-family:var(--mono);font-size:12px;">${rfidDisplay}</td>
        <td><span class="badge ${rfidBadge}"><span class="bd"></span>${rfidStatus}</span></td>
        <td>
          <button class="btn btn-outline" style="font-size:11px;padding:5px 11px;" onclick="openRfidEditModal('${deviceId}')">
            ${hasRfid ? 'Update' : 'Assign'}
          </button>
          ${hasRfid ? `<button class="btn btn-red" style="font-size:11px;padding:5px 11px;margin-left:6px;" onclick="voidRfidCard('${deviceId}')">Void</button>` : ''}
        </td>
      </tr>
    `;
  }).filter(Boolean).join('');
}

function renderFilteredRfidDevices() {
  if (rfidPaginator) {
    rfidPaginator.setData(getFilteredRfidDevices().filter((d) => !d.archived));
  } else {
    renderRfidDevices(getFilteredRfidDevices().filter((d) => !d.archived));
  }
}

function setRfidDeviceSearch(value) {
  rfidDeviceSearch = String(value || '').trim();
  renderFilteredRfidDevices();
}

async function loadSystemData() {
  const rfidTbody = document.getElementById('adm-rfid-table-body');
  const securityTbody = document.getElementById('adm-security-events-body');

  if (rfidTbody) rfidTbody.innerHTML = skeletonRows(6);
  if (securityTbody) securityTbody.innerHTML = skeletonRows(5);

  try {
    const response = await fetch('/api/admin/system', { method: 'GET' });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Failed to load system data');

    systemData = payload;
    allRfidDevices = payload.rfid_devices || [];

    renderSystemHealthPanels(payload);
    renderSecurityEvents(payload.recent_security_events || []);
    renderFilteredRfidDevices();
  } catch (error) {
    if (rfidTbody) {
      rfidTbody.innerHTML = `<tr><td colspan="6" style="color:#E85555;">${escapeHtml(error.message)}</td></tr>`;
    }
    if (securityTbody) {
      securityTbody.innerHTML = `<tr><td colspan="5" style="color:#E85555;">${escapeHtml(error.message)}</td></tr>`;
    }
  }
}

function openRfidEditModal(employeeId) {
  const modal = document.getElementById('rfid-edit-modal');
  const form = document.getElementById('rfid-edit-form');
  if (!modal || !form) return;

  currentEditingRfid = allRfidDevices.find((d) => d.id === employeeId);
  if (!currentEditingRfid) {
    window.alert('Employee not found. Please refresh the list.');
    return;
  }

  form.elements.id.value = currentEditingRfid.id;
  form.elements.employee_display.value = `${currentEditingRfid.full_name} (${currentEditingRfid.employee_id || 'N/A'})`;
  form.elements.rfid_uid.value = currentEditingRfid.rfid_uid || '';

  const feedbackEl = document.getElementById('rfid-edit-feedback');
  if (feedbackEl) feedbackEl.textContent = '';

  modal.style.display = 'flex';

  // Auto-focus so a HID RFID reader's keystrokes land in the field immediately
  setTimeout(() => form.elements.rfid_uid?.select(), 0);
}

function closeRfidEditModal() {
  const modal = document.getElementById('rfid-edit-modal');
  if (modal) modal.style.display = 'none';
}

async function submitRfidUpdate(event) {
  event.preventDefault();
  const form = event.target;
  const submitBtn = form.querySelector('button[type="submit"]');
  const formData = new FormData(form);
  const feedbackEl = document.getElementById('rfid-edit-feedback');

  const payload = {
    id: String(formData.get('id') || '').trim(),
    rfid_uid: String(formData.get('rfid_uid') || '').trim(),
  };

  if (!payload.id) {
    if (feedbackEl) { feedbackEl.textContent = 'Employee ID is missing.'; feedbackEl.className = 'adm-feedback err'; }
    return;
  }

  try {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Saving...';

    const response = await fetch('/api/admin/system', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Failed to update RFID');

    if (feedbackEl) { feedbackEl.textContent = payload.rfid_uid ? 'RFID assigned successfully.' : 'RFID removed.'; feedbackEl.className = 'adm-feedback ok'; }
    window.pushNotification?.('RFID Updated', payload.rfid_uid ? 'RFID UID has been assigned to the employee.' : 'RFID UID has been removed.', 'success');
    await loadSystemData();
    setTimeout(() => closeRfidEditModal(), 500);
  } catch (error) {
    if (feedbackEl) { feedbackEl.textContent = error.message; feedbackEl.className = 'adm-feedback err'; }
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Save RFID';
  }
}

async function voidRfidCard(employeeId) {
  const device = allRfidDevices.find((d) => d.id === employeeId);
  if (!device) {
    window.alert('Employee not found. Please refresh the list.');
    return;
  }

  const confirmed = window.confirmDestructiveAction
    ? await window.confirmDestructiveAction(`void the RFID card for ${device.full_name}`, 'The employee will no longer be able to tap in with this card.')
    : window.confirm(`Void the RFID card for ${device.full_name}?`);
  if (!confirmed) return;

  try {
    const response = await fetch('/api/admin/system', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: employeeId, rfid_uid: '' }),
    });

    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Failed to void RFID card.');

    window.pushNotification?.('RFID Voided', `RFID card for ${device.full_name} has been voided.`, 'success');
    await loadSystemData();
  } catch (error) {
    window.pushNotification?.('Error', error.message, 'error');
  }
}

/* ── INIT ── */
function initAdminPortal() {
  const currentRole = new URLSearchParams(window.location.search).get('role');
  if (String(currentRole || '').toLowerCase() !== 'admin') {
    return;
  }

  applyAdminIdentity();

  attachSidebarSpotlight(document.querySelector('#s-admin .sidebar'));

  attPaginator = window.createPaginator({ id: 'adm-att', pageSize: 15, renderFn: renderAttendanceTable });
  auditPaginator = window.createPaginator({ id: 'adm-audit', pageSize: 20, renderFn: renderAuditTable });
  usersPaginator = window.createPaginator({ id: 'adm-users', pageSize: 20, renderFn: renderUsers });
  rfidPaginator = window.createPaginator({ id: 'adm-rfid', pageSize: 15, renderFn: renderRfidDevices });
  branchPaginator = window.createPaginator({ id: 'ba', pageSize: 20, renderFn: renderBranchTable });

  attachRfidScannerInput();

  const addUserForm = document.getElementById('add-user-form');
  if (addUserForm?.elements?.role) {
    addUserForm.elements.role.addEventListener('change', (e) => onAddUserRoleChange(e.target.value));
  }

  setupNameFieldValidation();
  setupSalaryFieldValidation();
  setupGovIdBankFieldValidation();

  const savedPage = window.getPersistedRolePageState
    ? window.getPersistedRolePageState('admin')
    : '';
  const initialPage = ADMIN_PAGES[savedPage] ? savedPage : 'adm-dashboard';
  const initialNav = getAdminNavByPageId(initialPage);

  adminNav(initialPage, initialNav);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAdminPortal);
} else {
  initAdminPortal();
}

window.addEventListener('sacs-auth-context-changed', handleLegacyAuthContextChange);

/* ═══════════════════════════════════════
   BRANCH ASSIGNMENT
   ═══════════════════════════════════════ */

const BRANCH_CARD_COLORS = ['a', 'b', 't', 'g', 'r'];
const BRANCH_BADGE_COLORS = ['var(--amber)', 'var(--blue)', 'var(--teal)', 'var(--green)', 'var(--red)'];

function renderBranchFilterUI() {
  if (branchFilter !== 'all' && branchFilter !== 'unassigned' && !admAssignBranches.some((b) => b.id === branchFilter)) {
    branchFilter = 'all';
  }

  const cardsEl = document.getElementById('ba-branch-cards');
  if (cardsEl) {
    let html = `
      <div class="card"><div class="ct">Total Employees</div><div class="cv" id="ba-count-total">0</div><div class="cch">All active employees</div></div>
      <div class="card"><div class="ct">Unassigned</div><div class="cv r" id="ba-count-unassigned">0</div><div class="cch">Not yet in a branch</div></div>
    `;
    admAssignBranches.forEach((b, i) => {
      const colorClass = BRANCH_CARD_COLORS[i % BRANCH_CARD_COLORS.length];
      html += `<div class="card"><div class="ct">${escapeHtml(b.name)}</div><div class="cv ${colorClass}" id="ba-count-${escapeHtml(b.id)}">0</div><div class="cch">Branch campus</div></div>`;
    });
    cardsEl.innerHTML = html;
  }

  const chipsEl = document.getElementById('ba-filter-chips');
  if (!chipsEl) return;

  let chipsHtml = `
    <div class="chip ${branchFilter === 'all' ? 'active' : ''}" data-bf="all" onclick="setBranchFilter('all')">All (0)</div>
    <div class="chip ${branchFilter === 'unassigned' ? 'active' : ''}" data-bf="unassigned" onclick="setBranchFilter('unassigned')">Unassigned (0)</div>
  `;

  if (admAssignBranches.length) {
    admAssignBranches.forEach((b) => {
      const isActive = branchFilter === b.id;
      chipsHtml += `<div class="chip ${isActive ? 'active' : ''}" data-bf="${escapeHtml(b.id)}" onclick="setBranchFilter('${escapeJsString(b.id)}')">${escapeHtml(b.name)} (0)</div>`;
    });
  } else {
    chipsHtml += `<span style="font-size:12px;color:var(--t3);padding:4px 8px;align-self:center;">No active branches configured — add one in Branch Management first.</span>`;
  }

  chipsEl.innerHTML = chipsHtml;
}

function updateBranchSummary() {
  const total = branchAllEmployees.length;
  const unassigned = branchAllEmployees.filter((e) => !e.branch).length;

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = String(val); };
  set('ba-count-total', total);
  set('ba-count-unassigned', unassigned);

  const countsByBranch = {};
  admAssignBranches.forEach((b) => {
    countsByBranch[b.id] = branchAllEmployees.filter((e) => e.branch === b.id).length;
    set(`ba-count-${b.id}`, countsByBranch[b.id]);
  });

  document.querySelectorAll('#ba-filter-chips .chip').forEach((chip) => {
    const bf = chip.getAttribute('data-bf');
    if (bf === 'all')             chip.textContent = `All (${total})`;
    else if (bf === 'unassigned') chip.textContent = `Unassigned (${unassigned})`;
    else {
      const branch = admAssignBranches.find((b) => b.id === bf);
      chip.textContent = `${branch ? branch.name : 'Branch'} (${countsByBranch[bf] ?? 0})`;
    }
  });
}

function getFilteredBranchEmployees() {
  const search = branchSearch.toLowerCase();
  return branchAllEmployees.filter((e) => {
    if (branchFilter === 'unassigned') { if (e.branch) return false; }
    else if (branchFilter !== 'all')   { if (e.branch !== branchFilter) return false; }
    if (!search) return true;
    const hay = [e.full_name, e.employee_id, e.email].map((v) => String(v || '').toLowerCase()).join(' ');
    return hay.includes(search);
  });
}

function renderBranchTable(employees) {
  const tbody = document.getElementById('ba-table-body');
  if (!tbody) return;

  if (!employees.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="color:var(--t3);">No employees found.</td></tr>`;
    return;
  }

  tbody.innerHTML = employees.map((emp) => {
    const initials = getInitials(emp.full_name);
    const avatarColor = getAvatarColor(emp.email || emp.id);
    const branchIdx = emp.branch ? admAssignBranches.findIndex((b) => b.id === emp.branch) : -1;
    const branchColor = branchIdx >= 0 ? BRANCH_BADGE_COLORS[branchIdx % BRANCH_BADGE_COLORS.length] : 'var(--t3)';
    const inactiveTag = emp.branch && emp.branch_status && emp.branch_status !== 'Active' ? ' (Inactive)' : '';
    const branchCell = emp.branch
      ? `<span style="display:inline-block;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600;background:${branchColor}22;color:${branchColor};border:1px solid ${branchColor}55;">${escapeHtml((emp.branch_label || 'Unknown branch') + inactiveTag)}</span>`
      : `<span class="badge br"><span class="bd"></span>Unassigned</span>`;
    const assignedAt = emp.assigned_at ? formatDateTime(emp.assigned_at) : '—';
    const typeClass = emp.employee_type === 'Non-Teaching' ? 'ba' : 'bt2';
    const safeId = escapeJsString(emp.id);
    const actionBtn = emp.branch
      ? `<button class="btn btn-outline" style="font-size:11px;padding:5px 11px;" onclick="openBranchAssignModal('${safeId}')">Reassign</button>`
      : `<button class="btn btn-primary" style="font-size:11px;padding:5px 11px;" onclick="openBranchAssignModal('${safeId}')">Assign</button>`;

    return `
      <tr>
        <td class="nm">
          <div style="display:flex;align-items:center;gap:9px;">
            <div class="av" style="width:28px;height:28px;font-size:10px;background:${avatarColor};">${initials}</div>
            ${escapeHtml(emp.full_name)}
          </div>
        </td>
        <td class="mn">${escapeHtml(emp.employee_id || '—')}</td>
        <td><span class="badge ${typeClass}">${escapeHtml(emp.employee_type || 'Teaching')}</span></td>
        <td class="mn">${escapeHtml(emp.position || '—')}</td>
        <td>${branchCell}</td>
        <td class="mn" style="font-size:11px;">${escapeHtml(assignedAt)}</td>
        <td>${actionBtn}</td>
      </tr>
    `;
  }).join('');
}

function renderFilteredBranchEmployees() {
  updateBranchSummary();
  if (branchPaginator) {
    branchPaginator.setData(getFilteredBranchEmployees());
  } else {
    renderBranchTable(getFilteredBranchEmployees());
  }
}

function setBranchFilter(filter) {
  branchFilter = filter;
  document.querySelectorAll('#ba-filter-chips .chip').forEach((chip) => {
    chip.classList.toggle('active', chip.getAttribute('data-bf') === filter);
  });
  renderFilteredBranchEmployees();
}

function setBranchSearch(value) {
  branchSearch = String(value || '').trim();
  renderFilteredBranchEmployees();
}

async function loadBranchAssignment() {
  const tbody = document.getElementById('ba-table-body');
  if (tbody) tbody.innerHTML = skeletonRows(7);

  try {
    admAssignBranches = await fetchBranchesCached().catch(() => admAssignBranches);
    renderBranchFilterUI();

    const response = await fetch('/api/admin/branch-employees', { method: 'GET' });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Failed to load branch assignments');

    branchAllEmployees = payload.employees || [];
    renderFilteredBranchEmployees();
  } catch (error) {
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="7" style="color:#E85555;">${escapeHtml(error.message)}</td></tr>`;
    }
  }
}

function openBranchAssignModal(userId) {
  const modal = document.getElementById('branch-assign-modal');
  const form = document.getElementById('branch-assign-form');
  if (!modal || !form) return;

  currentBranchEmployee = branchAllEmployees.find((e) => e.id === userId);
  if (!currentBranchEmployee) {
    window.alert('Employee not found. Please refresh.');
    return;
  }

  const titleEl = document.getElementById('ba-modal-title');
  if (titleEl) titleEl.textContent = currentBranchEmployee.branch ? 'Reassign Branch' : 'Assign Branch';

  form.elements.user_id.value = currentBranchEmployee.id;
  form.elements.employee_display.value = `${currentBranchEmployee.full_name} (${currentBranchEmployee.employee_id || 'N/A'})`;

  const branchSelect = form.elements.branch;
  if (branchSelect) {
    // Always offer active branches; also include the employee's current branch even if
    // it has since gone inactive, so reassigning away from it stays possible.
    const options = [...admAssignBranches];
    if (currentBranchEmployee.branch && !options.some((b) => b.id === currentBranchEmployee.branch)) {
      options.push({ id: currentBranchEmployee.branch, name: `${currentBranchEmployee.branch_label || 'Unknown branch'} (Inactive)` });
    }

    if (options.length) {
      branchSelect.innerHTML = options.map((b) =>
        `<option value="${escapeHtml(b.id)}">${escapeHtml(b.name)}</option>`
      ).join('');
    } else {
      branchSelect.innerHTML = '<option value="" disabled>No branches configured yet.</option>';
    }
    if (currentBranchEmployee.branch) branchSelect.value = currentBranchEmployee.branch;
  }

  const feedbackEl = document.getElementById('ba-modal-feedback');
  if (feedbackEl) feedbackEl.textContent = '';

  modal.style.display = 'flex';
}

function closeBranchAssignModal() {
  const modal = document.getElementById('branch-assign-modal');
  if (modal) modal.style.display = 'none';
}

async function submitBranchAssign(event) {
  event.preventDefault();
  const form = event.target;
  const submitBtn = form.querySelector('button[type="submit"]');
  const feedbackEl = document.getElementById('ba-modal-feedback');
  const formData = new FormData(form);

  const userId = String(formData.get('user_id') || '').trim();
  const branchId = String(formData.get('branch') || '').trim();

  if (!userId || !branchId) {
    if (feedbackEl) { feedbackEl.textContent = 'Missing required fields.'; feedbackEl.className = 'adm-feedback err'; }
    return;
  }

  try {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting...';

    // Branch Assignment and Transfer Requests now share one source of truth:
    // this creates a transfer_requests row pending Super Admin approval,
    // exactly like the dedicated Transfer Requests page does, instead of
    // writing branch_id immediately.
    const response = await fetch('/api/admin/transfer-requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employee_id: userId, to_branch_id: branchId, remarks: 'Branch assignment' }),
    });

    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Failed to submit transfer request');

    if (feedbackEl) { feedbackEl.textContent = 'Transfer request submitted — pending Super Admin approval.'; feedbackEl.className = 'adm-feedback ok'; }
    window.pushNotification?.('Transfer Requested', 'Waiting for Super Admin approval.', 'success');
    await loadBranchAssignment();
    setTimeout(() => closeBranchAssignModal(), 600);
  } catch (error) {
    if (feedbackEl) { feedbackEl.textContent = error.message; feedbackEl.className = 'adm-feedback err'; }
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Confirm Assignment';
  }
}
