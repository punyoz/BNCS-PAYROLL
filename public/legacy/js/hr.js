/* ═══════════════════════════════════════
   hr.js — Human Resources role logic
   Handles: HR dashboard, employee records,
   attendance, leave management, reports
   ═══════════════════════════════════════ */

'use strict';

/* ── PAGE MAP ── */
const HR_PAGES = {
  'hr-dashboard':     'HR Dashboard',
  'hr-employees':     'User Management',
  'hr-employee-info': 'Employee Information',
  'hr-employee-directory': 'Employee Directory',
  'hr-branch-assign': 'Branch Assignment',
  'hr-attendance':    'Attendance Monitoring',
  'hr-leaves':        'Leave Approval',
  'hr-reports':       'HR Reports',
  'hr-profile':       'Profile',
};

let hrAllEmployees = [];
let hrEmployeeFilter = 'all';
let hrEmployeeSearch = '';
let hrInfoSearch = '';
let hrAttendanceLogs = [];
let hrLeaveRequests = [];
let hrLeaveHistory = [];
let hrReportData = [];
let hrReportType = 'attendance';
let hrCurrentEditEmployee = null;

let hrBranchAllEmployees = [];
let hrBranchFilter = 'all';
let hrBranchSearch = '';
let hrCurrentBranchEmployee = null;
let hrBranchPaginator = null;

let hrBranches = [];

let hrEmpPaginator = null;
let hrInfoPaginator = null;
let hrAttPaginator = null;
let hrLeaveHistPaginator = null;
let hrRepPaginator = null;

/* ── NAVIGATE ── */
function hrNav(pageId, navEl) {
  Object.keys(HR_PAGES).forEach((id) => {
    document.getElementById(id)?.classList.remove('active');
  });

  document.querySelectorAll('#s-hr .ni').forEach((el) => el.classList.remove('active'));

  const page = document.getElementById(pageId);
  if (page) page.classList.add('active');
  if (navEl) navEl.classList.add('active');

  const title = HR_PAGES[pageId] || 'HR Portal';
  const titleEl = document.getElementById('hr-tb-title');
  if (titleEl) titleEl.textContent = title;

  if (typeof persistRolePageState === 'function') persistRolePageState('hr', pageId);

  if (pageId === 'hr-dashboard') loadHRDashboard();
  else if (pageId === 'hr-employees') loadHREmployees();
  else if (pageId === 'hr-employee-info') loadHREmployeeInfo();
  else if (pageId === 'hr-employee-directory') loadHREmployeeDirectory();
  else if (pageId === 'hr-branch-assign') loadHrBranchAssignment();
  else if (pageId === 'hr-attendance') loadHRAttendance();
  else if (pageId === 'hr-leaves') loadHRLeaves();
  else if (pageId === 'hr-reports') { /* user clicks Generate */ }
  else if (pageId === 'hr-profile') loadHRProfile();
}

/* ── IDENTITY ── */
function applyHRIdentity() {
  if (typeof getLegacyAuthContext !== 'function') return;
  const ctx = getLegacyAuthContext();
  if (!ctx) return;

  const nameEl = document.getElementById('hr-user-name');
  if (nameEl && ctx.full_name) nameEl.textContent = ctx.full_name;

  const avatar = document.querySelector('#s-hr .sb-foot .av');
  if (avatar && ctx.full_name) {
    const parts = ctx.full_name.trim().split(/\s+/);
    avatar.textContent = parts.length >= 2
      ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
      : ctx.full_name.slice(0, 2).toUpperCase();
  }
}

/* ── DASHBOARD ── */
async function loadHRDashboard() {
  try {
    const res = await fetch('/api/hr/dashboard');
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || 'Failed to load dashboard.');

    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    set('hr-panel-total', data.total_employees ?? 0);
    set('hr-panel-present', data.present_today ?? 0);
    set('hr-panel-absent', data.absent_today ?? 0);
    set('hr-panel-leaves', data.pending_leaves ?? 0);
    set('hr-panel-teaching', data.teaching_staff ?? 0);
    set('hr-panel-non-teaching', data.non_teaching_staff ?? 0);
    set('hr-panel-late', data.late_today ?? 0);

    const badge = document.getElementById('hr-leave-badge');
    const dbBadge = document.getElementById('hr-dashboard-badge');
    const leaveBadge = document.getElementById('hr-leave-badge');
    const pendingCount = data.pending_leaves ?? 0;
    if (badge) { badge.textContent = pendingCount; badge.style.display = pendingCount > 0 ? '' : 'none'; }
    if (leaveBadge) { leaveBadge.textContent = pendingCount; leaveBadge.style.display = pendingCount > 0 ? '' : 'none'; }
    if (dbBadge) { dbBadge.textContent = pendingCount; dbBadge.style.display = pendingCount > 0 ? '' : 'none'; }

    renderHRDashboardLeaves(data.pending_leaves ?? 0);
    renderHRRecentActivity(data.recent_activity || []);
  } catch (err) {
    console.error('HR dashboard error:', err);
  }
}

function renderHRDashboardLeaves(pendingCount) {
  const el = document.getElementById('hr-dashboard-leave-list');
  if (!el) return;
  if (pendingCount === 0) {
    el.innerHTML = '<div class="approval-item"><div class="approval-info" style="color:var(--t3);">No pending leave requests.</div></div>';
    return;
  }
  el.innerHTML = `<div class="approval-item">
    <div class="approval-info"><strong style="color:var(--amber);">${pendingCount}</strong> leave request${pendingCount > 1 ? 's' : ''} awaiting your decision.</div>
    <button class="btn btn-outline" onclick="hrNav('hr-leaves', document.querySelectorAll('#s-hr .ni')[4])">Review Now</button>
  </div>`;
}

function renderHRRecentActivity(activity) {
  const el = document.getElementById('hr-recent-activity');
  if (!el) return;
  if (!activity.length) {
    el.innerHTML = '<div class="ai-item"><div class="ai2"><div class="s" style="color:var(--t3);">No recent attendance activity.</div></div></div>';
    return;
  }
  el.innerHTML = activity.map((row) => {
    const s = String(row.status || '').toLowerCase();
    const color = s === 'present' ? 'var(--green)' : s === 'late' ? 'var(--amber)' : 'var(--red)';
    return `<div class="ai-item">
      <div class="ai2">
        <div class="s">${row.employee_name || row.employee_id || 'Unknown'}</div>
        <div class="ss">${row.date || ''} · Time in: ${row.time_in || '—'}</div>
      </div>
      <span class="badge" style="background:${color}20;color:${color};border:1px solid ${color}50;">${row.status || '—'}</span>
    </div>`;
  }).join('');
}

/* ── EMPLOYEE RECORDS ── */
async function loadHREmployees() {
  const tbody = document.getElementById('hr-employee-table-body');
  if (tbody) tbody.innerHTML = skeletonRows(7);

  try {
    const includeArchived = hrEmployeeFilter === 'archived';
    const res = await fetch(`/api/hr/employees${includeArchived ? '?archived=true' : ''}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load employees.');

    hrAllEmployees = data.employees || [];
    updateHrEmployeeChips();
    renderHREmployeeTable();
  } catch (err) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="7" style="color:var(--red);">${err.message}</td></tr>`;
  }
}

function updateHrEmployeeChips() {
  const all = hrAllEmployees;
  const teaching = all.filter((e) => e.employee_type?.toLowerCase() === 'teaching').length;
  const nonTeaching = all.filter((e) => e.employee_type?.toLowerCase() === 'non-teaching').length;
  const archived = all.filter((e) => e.archived).length;

  const chips = document.querySelectorAll('#hr-emp-filter-chips .chip');
  const labels = [`All (${all.length})`, `Teaching (${teaching})`, `Non-Teaching (${nonTeaching})`, `Archived (${archived})`];
  chips.forEach((chip, i) => { if (labels[i]) chip.textContent = labels[i]; });
}

function setHrEmployeeFilter(filter) {
  hrEmployeeFilter = filter;
  document.querySelectorAll('#hr-emp-filter-chips .chip').forEach((c) => {
    c.classList.toggle('active', c.dataset.filter === filter);
  });
  if (filter === 'archived') {
    loadHREmployees();
  } else {
    renderHREmployeeTable();
  }
}

function setHrEmployeeSearch(val) {
  hrEmployeeSearch = String(val || '').toLowerCase().trim();
  renderHREmployeeTable();
}

function renderHREmployeeTable() {
  const tbody = document.getElementById('hr-employee-table-body');
  if (!tbody) return;

  let list = hrAllEmployees;

  if (hrEmployeeFilter === 'teaching') list = list.filter((e) => e.employee_type?.toLowerCase() === 'teaching' && !e.archived);
  else if (hrEmployeeFilter === 'non-teaching') list = list.filter((e) => e.employee_type?.toLowerCase() === 'non-teaching' && !e.archived);
  else if (hrEmployeeFilter === 'archived') list = list.filter((e) => e.archived);
  else list = list.filter((e) => !e.archived);

  if (hrEmployeeSearch) {
    list = list.filter((e) =>
      [e.full_name, e.employee_id, e.email, e.position].some((v) =>
        String(v || '').toLowerCase().includes(hrEmployeeSearch)
      )
    );
  }

  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="color:var(--t3);">No employees found.</td></tr>';
    return;
  }

  if (!hrEmpPaginator) {
    hrEmpPaginator = createPaginator({
      id: 'hr-emp',
      pageSize: 15,
      renderFn: (rows) => {
        tbody.innerHTML = rows.map((e) => {
          const statusColor = e.employee_status?.toLowerCase() === 'active' ? 'var(--green)' : 'var(--amber)';
          return `<tr>
            <td>${e.full_name || '—'}</td>
            <td><code style="font-size:11px;">${e.employee_id || '—'}</code></td>
            <td>${e.employee_type || '—'}</td>
            <td>${e.position || '—'}</td>
            <td><span class="badge" style="color:${statusColor};background:${statusColor}20;border:1px solid ${statusColor}40;">${e.employee_status || 'Active'}</span></td>
            <td style="font-size:12px;color:var(--t3);">${e.email || '—'}</td>
            <td><button class="btn btn-outline" style="font-size:11px;padding:4px 10px;" onclick="openHrEditEmployeeModal(${JSON.stringify(e).replace(/"/g, '&quot;')})">Edit</button></td>
          </tr>`;
        }).join('');
      },
    });
  }

  hrEmpPaginator.setData(list);
}

function openHrEditEmployeeModal(employee) {
  hrCurrentEditEmployee = employee;
  const form = document.getElementById('hr-edit-employee-form');
  if (!form) return;

  form.querySelector('[name="id"]').value = employee.id || '';
  form.querySelector('[name="employee_id"]').value = employee.employee_id || '';

  // Only a single composed full_name is stored — split it back into parts
  // so the Name section starts pre-filled with something reasonable.
  const nameParts = splitFullName(employee.full_name || '');
  const midName = nameParts.middle_initial
    || (nameParts.second_name && nameParts.second_name !== nameParts.last_name ? nameParts.second_name : '');
  if (form.elements.first_name) form.elements.first_name.value = nameParts.first_name || '';
  if (form.elements.middle_initial) form.elements.middle_initial.value = midName;
  if (form.elements.last_name) form.elements.last_name.value = nameParts.last_name || '';
  if (form.elements.suffix) form.elements.suffix.value = nameParts.suffix || '';

  if (form.elements.email) form.elements.email.value = employee.email || '';
  if (form.elements.date_of_birth) form.elements.date_of_birth.value = employee.date_of_birth || '';

  const typeEl = form.querySelector('[name="employee_type"]');
  if (typeEl) typeEl.value = employee.employee_type || 'Teaching';

  const posEl = form.querySelector('[name="position"]');
  if (posEl) posEl.value = employee.position || 'Employee';

  const statusEl = form.querySelector('[name="employee_status"]');
  if (statusEl) statusEl.value = employee.employee_status || 'Active';

  if (form.elements.address) form.elements.address.value = employee.address || '';
  if (form.elements.cp_number) form.elements.cp_number.value = employee.cp_number || '';
  if (form.elements.date_hired) form.elements.date_hired.value = employee.date_hired || '';
  if (form.elements.sss_number) form.elements.sss_number.value = employee.sss_number || '';
  if (form.elements.pagibig_number) form.elements.pagibig_number.value = employee.pagibig_number || '';
  if (form.elements.philhealth_number) form.elements.philhealth_number.value = employee.philhealth_number || '';
  if (form.elements.bank_name) form.elements.bank_name.value = employee.bank_name || '';
  if (form.elements.bank_account_number) form.elements.bank_account_number.value = employee.bank_account_number || '';

  form.querySelectorAll('.field-error').forEach((s) => { s.textContent = ''; });

  const INVALID_ID_CHARS = /[A-Za-z]/g;
  ['sss_number', 'pagibig_number', 'philhealth_number', 'bank_account_number'].forEach((fieldName) => {
    const input = form.elements[fieldName];
    if (!input || input.dataset.hrEditGovIdBound === '1') return;
    input.dataset.hrEditGovIdBound = '1';
    const errorSpan = input.nextElementSibling;
    input.addEventListener('input', () => {
      const original = input.value;
      const cleaned = original.replace(INVALID_ID_CHARS, '');
      if (cleaned !== original) {
        const pos = input.selectionStart - (original.length - cleaned.length);
        input.value = cleaned;
        input.setSelectionRange(Math.max(0, pos), Math.max(0, pos));
        if (errorSpan && errorSpan.classList.contains('field-error')) {
          errorSpan.textContent = 'Letters are not allowed in this field.';
        }
      } else {
        if (errorSpan && errorSpan.classList.contains('field-error')) errorSpan.textContent = '';
      }
    });
  });

  const fb = document.getElementById('hr-edit-employee-feedback');
  if (fb) { fb.textContent = ''; fb.className = 'adm-feedback'; }

  const modal = document.getElementById('hr-edit-employee-modal');
  if (modal) modal.style.display = 'flex';
}

function closeHrEditEmployeeModal() {
  const modal = document.getElementById('hr-edit-employee-modal');
  if (modal) modal.style.display = 'none';
  hrCurrentEditEmployee = null;
}

async function submitHrEditEmployee(event) {
  event.preventDefault();
  const form = event.target;
  const fb = document.getElementById('hr-edit-employee-feedback');

  const firstName = (form.elements.first_name?.value || '').trim();
  const lastName = (form.elements.last_name?.value || '').trim();
  const middleInitial = (form.elements.middle_initial?.value || '').trim();
  const suffix = (form.elements.suffix?.value || '').trim();
  const email = (form.elements.email?.value || '').trim();

  if (!firstName || !lastName) {
    if (fb) { fb.textContent = 'First and last name are required.'; fb.style.color = 'var(--red)'; }
    return;
  }
  if (!/^[A-Za-z\s]+$/.test(firstName)) {
    if (fb) { fb.textContent = 'First name must contain only letters.'; fb.style.color = 'var(--red)'; }
    return;
  }
  if (!/^[A-Za-z\s]+$/.test(lastName)) {
    if (fb) { fb.textContent = 'Last name must contain only letters.'; fb.style.color = 'var(--red)'; }
    return;
  }
  if (middleInitial && !/^[A-Za-z\s]+$/.test(middleInitial)) {
    if (fb) { fb.textContent = 'Middle name must contain only letters.'; fb.style.color = 'var(--red)'; }
    return;
  }
  if (!email) {
    if (fb) { fb.textContent = 'Email is required.'; fb.style.color = 'var(--red)'; }
    return;
  }

  // Role and basic_salary are intentionally never sent — HR can't edit
  // either, so those fields aren't in this form at all.
  const payload = {
    id: form.querySelector('[name="id"]').value,
    first_name: firstName,
    middle_initial: middleInitial,
    last_name: lastName,
    suffix,
    email,
    date_of_birth: (form.elements.date_of_birth?.value || '').trim(),
    employee_type: form.querySelector('[name="employee_type"]').value,
    position: form.querySelector('[name="position"]').value,
    employee_status: form.querySelector('[name="employee_status"]').value,
    address: (form.elements.address?.value || '').trim(),
    cp_number: (form.elements.cp_number?.value || '').trim(),
    date_hired: (form.elements.date_hired?.value || '').trim(),
    sss_number: (form.elements.sss_number?.value || '').trim(),
    pagibig_number: (form.elements.pagibig_number?.value || '').trim(),
    philhealth_number: (form.elements.philhealth_number?.value || '').trim(),
    bank_name: (form.elements.bank_name?.value || '').trim(),
    bank_account_number: (form.elements.bank_account_number?.value || '').trim(),
  };

  try {
    const res = await fetch('/api/hr/employees', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Update failed.');

    if (fb) { fb.textContent = 'Employee updated successfully.'; fb.style.color = 'var(--green)'; }
    setTimeout(() => {
      closeHrEditEmployeeModal();
      loadHREmployees();
    }, 800);
  } catch (err) {
    if (fb) { fb.textContent = err.message; fb.style.color = 'var(--red)'; }
  }
}

/* ── EMPLOYEE INFORMATION ── */
async function loadHREmployeeInfo() {
  const tbody = document.getElementById('hr-info-table-body');
  if (tbody) tbody.innerHTML = skeletonRows(8);

  try {
    const res = await fetch('/api/hr/employees?archived=true');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load employee info.');

    const all = data.employees || [];
    renderHRInfoTable(all);
  } catch (err) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="8" style="color:var(--red);">${err.message}</td></tr>`;
  }
}

function setHrInfoSearch(val) {
  hrInfoSearch = String(val || '').toLowerCase().trim();
  // Re-render using cached data if available
  const tbody = document.getElementById('hr-info-table-body');
  if (!tbody) return;
  const rows = Array.from(tbody.querySelectorAll('tr[data-emp-id]'));
  rows.forEach((row) => {
    const text = row.textContent.toLowerCase();
    row.style.display = !hrInfoSearch || text.includes(hrInfoSearch) ? '' : 'none';
  });
}

function renderHRInfoTable(employees) {
  const tbody = document.getElementById('hr-info-table-body');
  if (!tbody) return;

  if (!employees.length) {
    tbody.innerHTML = '<tr><td colspan="8" style="color:var(--t3);">No employees found.</td></tr>';
    return;
  }

  if (!hrInfoPaginator) {
    hrInfoPaginator = createPaginator({
      id: 'hr-info',
      pageSize: 15,
      renderFn: (rows) => {
        tbody.innerHTML = rows.map((e) => {
          const archivedBadge = e.archived
            ? '<span class="badge" style="color:var(--red);background:var(--red-s);border:1px solid var(--red);margin-left:4px;">Archived</span>'
            : '';
          return `<tr data-emp-id="${e.id || ''}">
            <td>${e.full_name || '—'}${archivedBadge}</td>
            <td><code style="font-size:11px;">${e.employee_id || '—'}</code></td>
            <td>${e.role || '—'}</td>
            <td>${e.employee_type || '—'}</td>
            <td>${e.position || '—'}</td>
            <td>${e.employee_status || 'Active'}</td>
            <td style="font-size:12px;">${e.date_of_birth || '—'}</td>
            <td style="font-size:12px;color:var(--t3);">${e.email || '—'}</td>
          </tr>`;
        }).join('');
      },
    });
  }

  hrInfoPaginator.setData(employees);
}

/* ── EMPLOYEE DIRECTORY (read-only) ── */
let hrEmployeeDirectoryRows = [];

async function loadHREmployeeDirectory() {
  const tbody = document.getElementById('hr-employee-directory-table-body');
  if (tbody) tbody.innerHTML = skeletonRows(6);

  try {
    if (!hrBranches.length) {
      const branchRes = await fetch('/api/admin/branches');
      if (branchRes.ok) {
        const bd = await branchRes.json();
        hrBranches = (bd.branches || []).filter((b) => b.status === 'Active');
      }
    }

    const response = await fetch('/api/admin/employee-info');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Failed to load employee directory.');

    hrEmployeeDirectoryRows = data.employees || [];
    renderHREmployeeDirectory();
  } catch (error) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="6" style="color:var(--red);">${escapeHtml(error.message)}</td></tr>`;
  }
}

function renderHREmployeeDirectory() {
  const tbody = document.getElementById('hr-employee-directory-table-body');
  if (!tbody) return;

  if (!hrEmployeeDirectoryRows.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="color:var(--t3);">No employee records found.</td></tr>';
    return;
  }

  tbody.innerHTML = hrEmployeeDirectoryRows.map((row) => `
    <tr>
      <td>${escapeHtml(row.full_name || '—')}</td>
      <td>${escapeHtml(row.cp_number || '—')}</td>
      <td>${escapeHtml(row.branch_id ? (hrBranches.find((b) => b.id === row.branch_id)?.name || row.branch_id) : '—')}</td>
      <td>${escapeHtml(row.position || '—')}</td>
      <td>${escapeHtml(row.status || '—')}</td>
      <td>${escapeHtml(row.date_hired || '—')}</td>
    </tr>
  `).join('');
}

/* ── ATTENDANCE ── */
async function loadHRAttendance() {
  const dateInput = document.getElementById('hr-att-date');
  const today = new Date().toISOString().slice(0, 10);
  const date = dateInput?.value || today;
  if (dateInput && !dateInput.value) dateInput.value = today;

  const titleEl = document.getElementById('hr-att-title');
  if (titleEl) titleEl.textContent = `Attendance Log — ${date === today ? 'Today' : date}`;

  const tbody = document.getElementById('hr-att-table-body');
  if (tbody) tbody.innerHTML = skeletonRows(7);

  try {
    const res = await fetch(`/api/hr/attendance?date=${date}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load attendance.');

    hrAttendanceLogs = data.logs || [];
    const s = data.summary || {};
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('hr-att-present', s.present ?? 0);
    set('hr-att-late', s.late ?? 0);
    set('hr-att-absent', s.absent ?? 0);

    renderHRAttendanceTable(hrAttendanceLogs);
  } catch (err) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="7" style="color:var(--red);">${err.message}</td></tr>`;
  }
}

async function loadHRAllAttendance() {
  const titleEl = document.getElementById('hr-att-title');
  if (titleEl) titleEl.textContent = 'Attendance Log — All Records';

  const tbody = document.getElementById('hr-att-table-body');
  if (tbody) tbody.innerHTML = skeletonRows(7);

  try {
    const res = await fetch('/api/hr/attendance?view=all');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load attendance.');

    hrAttendanceLogs = data.logs || [];
    const s = data.summary || {};
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('hr-att-present', s.present ?? 0);
    set('hr-att-late', s.late ?? 0);
    set('hr-att-absent', s.absent ?? 0);

    renderHRAttendanceTable(hrAttendanceLogs);
  } catch (err) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="7" style="color:var(--red);">${err.message}</td></tr>`;
  }
}

function renderHRAttendanceTable(logs) {
  const tbody = document.getElementById('hr-att-table-body');
  if (!tbody) return;

  if (!logs.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="color:var(--t3);">No attendance records found.</td></tr>';
    return;
  }

  if (!hrAttPaginator) {
    hrAttPaginator = createPaginator({
      id: 'hr-att',
      pageSize: 20,
      renderFn: (rows) => {
        tbody.innerHTML = rows.map((row) => {
          const s = String(row.status || '').toLowerCase();
          const color = s === 'present' ? 'var(--green)' : s === 'late' ? 'var(--amber)' : 'var(--red)';
          return `<tr>
            <td>${row.employee_name || row.employee_id || '—'}</td>
            <td>${row.employee_type || '—'}</td>
            <td>${row.date || '—'}</td>
            <td>${row.time_in || '—'}</td>
            <td>${row.time_out || '—'}</td>
            <td>${row.hours_worked != null ? Number(row.hours_worked).toFixed(1) + 'h' : '—'}</td>
            <td><span class="badge" style="color:${color};background:${color}20;border:1px solid ${color}40;">${row.status || '—'}</span></td>
          </tr>`;
        }).join('');
      },
    });
  }

  hrAttPaginator.setData(logs);
}

function exportHRAttendanceCsv() {
  if (!hrAttendanceLogs.length) { alert('No attendance data to export.'); return; }

  const headers = ['Employee Name', 'Employee Type', 'Date', 'Time In', 'Time Out', 'Hours Worked', 'Status'];
  const rows = hrAttendanceLogs.map((r) => [
    r.employee_name || r.employee_id || '',
    r.employee_type || '',
    r.date || '',
    r.time_in || '',
    r.time_out || '',
    r.hours_worked != null ? Number(r.hours_worked).toFixed(2) : '',
    r.status || '',
  ]);

  downloadCsv([headers, ...rows], `sacs-hr-attendance-${new Date().toISOString().slice(0, 10)}.csv`);
}

/* ── LEAVE MANAGEMENT ── */
async function loadHRLeaves() {
  const listEl = document.getElementById('hr-leave-list');
  if (listEl) listEl.innerHTML = skeletonCards(3);

  try {
    const res = await fetch('/api/hr/leave-requests?status=all');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load leave requests.');

    hrLeaveRequests = data.pending_requests || [];
    hrLeaveHistory = data.history_requests || [];

    const badge = document.getElementById('hr-leave-badge');
    if (badge) { badge.textContent = hrLeaveRequests.length; badge.style.display = hrLeaveRequests.length > 0 ? '' : 'none'; }

    renderHRLeaveList();
    renderHRLeaveHistory();
  } catch (err) {
    if (listEl) listEl.innerHTML = `<div class="approval-card"><div class="approval-card-body"><div class="approval-card-meta" style="color:var(--red);">${err.message}</div></div></div>`;
  }
}

function renderHRLeaveList() {
  const el = document.getElementById('hr-leave-list');
  if (!el) return;

  if (!hrLeaveRequests.length) {
    el.innerHTML = '<div class="approval-card"><div class="approval-card-body"><div class="approval-card-meta" style="color:var(--t3);">No pending leave requests.</div></div></div>';
    return;
  }

  el.innerHTML = hrLeaveRequests.map((req) => {
    const days = req.days || req.duration_days || '?';
    const from = req.from_date || req.start_date || '—';
    const to = req.to_date || req.end_date || '—';
    const proof = req.proof_url || req.proof_data || '';
    const payStatusLabel = req.pay_status === 'without_pay' ? 'Without Pay' : 'With Pay';

    return `<div class="approval-card">
      <div class="approval-card-body">
        <div class="approval-card-name">${req.employee_name || req.employee_id || 'Unknown'}</div>
        <div class="approval-card-meta">
          <strong>${req.leave_type || 'Leave'}</strong> · ${payStatusLabel} · ${days} day${days !== 1 ? 's' : ''} · ${from} to ${to}
        </div>
        <div class="approval-card-meta" style="margin-top:4px;">${req.reason || '—'}</div>
        ${proof ? `<button class="btn btn-outline" style="font-size:11px;padding:3px 9px;margin-top:6px;" onclick="openProofDocument('${proof}')">View Proof</button>` : ''}
      </div>
      <div class="approval-card-actions">
        <button class="btn btn-primary" style="background:var(--green);border-color:var(--green);" onclick="hrLeaveAction('${req.id}','approve')">Approve</button>
        <button class="btn btn-red" onclick="hrLeaveAction('${req.id}','reject')">Reject</button>
      </div>
    </div>`;
  }).join('');
}

async function hrLeaveAction(id, action) {
  // Approving is a positive decision, so it uses the green approval dialog
  // (same as the accountant's approve). Only rejecting gets the red warning.
  const confirmed = action === 'approve'
    ? await confirmApproveAction('approve this leave request', 'The employee will be notified of the approval.')
    : await confirmDestructiveAction('reject this leave request', 'This decision cannot be undone.');
  if (!confirmed) return;

  try {
    const res = await fetch('/api/hr/leave-requests', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, action }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Action failed.');

    pushNotification(`Leave ${action === 'approve' ? 'Approved' : 'Rejected'}`, `Leave request has been ${action === 'approve' ? 'approved' : 'rejected'}.`, action === 'approve' ? 'success' : 'info');
    loadHRLeaves();
  } catch (err) {
    pushNotification('Error', err.message, 'error');
  }
}

function renderHRLeaveHistory() {
  const tbody = document.getElementById('hr-leave-history-body');
  if (!tbody) return;

  if (!hrLeaveHistory.length) {
    tbody.innerHTML = '<tr><td colspan="8" style="color:var(--t3);">No leave history yet.</td></tr>';
    return;
  }

  if (!hrLeaveHistPaginator) {
    hrLeaveHistPaginator = createPaginator({
      id: 'hr-leave-hist',
      pageSize: 15,
      renderFn: (rows) => {
        tbody.innerHTML = rows.map((req) => {
          const s = String(req.status || '').toLowerCase();
          const color = s === 'approved' ? 'var(--green)' : s === 'rejected' ? 'var(--red)' : 'var(--amber)';
          const days = req.days || req.duration_days || '?';
          const from = req.from_date || req.start_date || '—';
          const to = req.to_date || req.end_date || '—';
          const proof = req.proof_url || req.proof_data || '';
          const decided = req.decided_at ? new Date(req.decided_at).toLocaleDateString('en-PH') : '—';
          const submitted = req.submitted_at || req.created_at
            ? new Date(req.submitted_at || req.created_at).toLocaleDateString('en-PH')
            : '—';

          return `<tr>
            <td>${req.employee_name || req.employee_id || '—'}</td>
            <td>${req.leave_type || '—'}</td>
            <td>${days}d · ${from} – ${to}</td>
            <td style="font-size:12px;max-width:160px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${req.reason || '—'}</td>
            <td>${proof ? `<button class="btn btn-outline" style="font-size:10px;padding:2px 8px;" onclick="openProofDocument('${proof}')">View</button>` : '—'}</td>
            <td><span class="badge" style="color:${color};background:${color}20;border:1px solid ${color}40;">${req.status || '—'}</span></td>
            <td style="font-size:12px;">${submitted}</td>
            <td style="font-size:12px;">${decided}</td>
          </tr>`;
        }).join('');
      },
    });
  }

  hrLeaveHistPaginator.setData(hrLeaveHistory);
}

/* ── HR REPORTS ── */
function onHrReportTypeChange() {
  const type = document.getElementById('hr-report-type')?.value || 'attendance';
  hrReportType = type;
  const fromWrap = document.getElementById('hr-report-from-wrap');
  const toWrap = document.getElementById('hr-report-to-wrap');
  if (fromWrap) fromWrap.style.display = type === 'attendance' ? '' : 'none';
  if (toWrap) toWrap.style.display = type === 'attendance' ? '' : 'none';
}

async function loadHRReports() {
  const type = document.getElementById('hr-report-type')?.value || 'attendance';
  hrReportType = type;

  const from = document.getElementById('hr-report-from')?.value || '';
  const to = document.getElementById('hr-report-to')?.value || new Date().toISOString().slice(0, 10);

  const thead = document.getElementById('hr-rep-thead');
  const tbody = document.getElementById('hr-rep-table-body');
  const summary = document.getElementById('hr-reports-summary');
  const titleEl = document.getElementById('hr-rep-table-title');

  if (tbody) tbody.innerHTML = skeletonRows(6);
  if (summary) summary.style.display = 'none';

  try {
    let url = `/api/hr/reports?type=${type}`;
    if (type === 'attendance') {
      if (from) url += `&from=${from}`;
      url += `&to=${to}`;
    }

    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load report.');

    hrReportData = data.records || [];

    if (type === 'attendance') {
      if (titleEl) titleEl.textContent = `Attendance Report${from ? ` · ${from} to ${to}` : ''}`;

      if (thead) thead.innerHTML = '<tr><th>Employee</th><th>Type</th><th>Present</th><th>Late</th><th>Absent</th><th>Total Hours</th></tr>';

      const totalPresent = hrReportData.reduce((s, r) => s + (r.present || 0), 0);
      const totalLate = hrReportData.reduce((s, r) => s + (r.late || 0), 0);
      const totalAbsent = hrReportData.reduce((s, r) => s + (r.absent || 0), 0);

      const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
      set('hr-rep-total', hrReportData.length);
      set('hr-rep-stat1-label', 'Present Days');
      set('hr-rep-stat1', totalPresent);
      set('hr-rep-stat2-label', 'Late Days');
      set('hr-rep-stat2', totalLate);
      set('hr-rep-stat3-label', 'Absent Days');
      set('hr-rep-stat3', totalAbsent);
      if (summary) summary.style.display = '';

      if (!hrRepPaginator) {
        hrRepPaginator = createPaginator({
          id: 'hr-rep',
          pageSize: 20,
          renderFn: (rows) => {
            if (!tbody) return;
            tbody.innerHTML = rows.map((r) => `<tr>
              <td>${r.employee_name || '—'}</td>
              <td>${r.employee_type || '—'}</td>
              <td style="color:var(--green);">${r.present ?? 0}</td>
              <td style="color:var(--amber);">${r.late ?? 0}</td>
              <td style="color:var(--red);">${r.absent ?? 0}</td>
              <td>${Number(r.total_hours || 0).toFixed(1)}h</td>
            </tr>`).join('');
          },
        });
      }
      hrRepPaginator.setData(hrReportData);

    } else {
      if (titleEl) titleEl.textContent = 'Employee Records Report';
      if (thead) thead.innerHTML = '<tr><th>Employee</th><th>ID</th><th>Type</th><th>Position</th><th>Status</th><th>Email</th></tr>';

      const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
      set('hr-rep-total', data.total || hrReportData.length);
      set('hr-rep-stat1-label', 'Active');
      set('hr-rep-stat1', data.active ?? 0);
      set('hr-rep-stat2-label', 'Archived');
      set('hr-rep-stat2', data.archived ?? 0);
      set('hr-rep-stat3-label', 'Teaching');
      set('hr-rep-stat3', hrReportData.filter((r) => r.employee_type?.toLowerCase() === 'teaching').length);
      if (summary) summary.style.display = '';

      if (!hrRepPaginator) {
        hrRepPaginator = createPaginator({
          id: 'hr-rep',
          pageSize: 20,
          renderFn: (rows) => {
            if (!tbody) return;
            tbody.innerHTML = rows.map((r) => {
              const archived = r.archived ? '<span style="color:var(--red);font-size:10px;"> (Archived)</span>' : '';
              return `<tr>
                <td>${r.full_name || '—'}${archived}</td>
                <td><code style="font-size:11px;">${r.employee_id || '—'}</code></td>
                <td>${r.employee_type || '—'}</td>
                <td>${r.position || '—'}</td>
                <td>${r.employee_status || 'Active'}</td>
                <td style="font-size:12px;color:var(--t3);">${r.email || '—'}</td>
              </tr>`;
            }).join('');
          },
        });
      }
      hrRepPaginator.setData(hrReportData);
    }
  } catch (err) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="6" style="color:var(--red);">${err.message}</td></tr>`;
  }
}

function exportHRReportCsv() {
  if (!hrReportData.length) { alert('No report data to export. Generate a report first.'); return; }

  let headers, rows;
  if (hrReportType === 'attendance') {
    headers = ['Employee', 'Type', 'Present', 'Late', 'Absent', 'Total Hours'];
    rows = hrReportData.map((r) => [r.employee_name || '', r.employee_type || '', r.present ?? 0, r.late ?? 0, r.absent ?? 0, Number(r.total_hours || 0).toFixed(2)]);
  } else {
    headers = ['Employee', 'ID', 'Type', 'Position', 'Status', 'Email'];
    rows = hrReportData.map((r) => [r.full_name || '', r.employee_id || '', r.employee_type || '', r.position || '', r.employee_status || '', r.email || '']);
  }

  downloadCsv([headers, ...rows], `sacs-hr-${hrReportType}-report-${new Date().toISOString().slice(0, 10)}.csv`);
}

/* ── CSV HELPER ── */
function downloadCsv(rows, filename) {
  const csv = rows.map((r) =>
    r.map((v) => {
      const s = String(v ?? '').replace(/"/g, '""');
      return /[,"\n]/.test(s) ? `"${s}"` : s;
    }).join(',')
  ).join('\r\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const anchor = document.createElement('a');
  anchor.href = URL.createObjectURL(blob);
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(anchor.href);
}

/* ── CHANGE PASSWORD ── */
async function submitHrChangePassword() {
  const current = document.getElementById('hr-current-password')?.value?.trim();
  const next = document.getElementById('hr-new-password')?.value?.trim();
  const confirm = document.getElementById('hr-confirm-password')?.value?.trim();
  const fb = document.getElementById('hr-change-password-feedback');

  if (!current || !next || !confirm) {
    if (fb) { fb.textContent = 'All fields are required.'; fb.style.color = 'var(--red)'; }
    return;
  }
  if (next !== confirm) {
    if (fb) { fb.textContent = 'Passwords do not match.'; fb.style.color = 'var(--red)'; }
    return;
  }
  if (next.length < 8) {
    if (fb) { fb.textContent = 'New password must be at least 8 characters.'; fb.style.color = 'var(--red)'; }
    return;
  }

  if (fb) { fb.textContent = 'Updating...'; fb.style.color = 'var(--t3)'; }

  try {
    const ctx = typeof getLegacyAuthContext === 'function' ? getLegacyAuthContext() : null;
    const email = ctx?.email;
    if (!email) throw new Error('Could not determine account email. Please re-login.');

    // Verify current password by attempting sign-in
    const verifyRes = await fetch('/api/legacy-auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employeeId: email, password: current }),
    });
    if (!verifyRes.ok) throw new Error('Current password is incorrect.');

    // Use Supabase client to update password
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm');
    const supabaseUrl = document.querySelector('meta[name="supabase-url"]')?.content || '';
    const supabaseKey = document.querySelector('meta[name="supabase-anon-key"]')?.content || '';
    if (!supabaseUrl || !supabaseKey) throw new Error('Cannot update password from this context. Use the /reset-password page.');

    if (fb) { fb.textContent = 'Password updated successfully.'; fb.style.color = 'var(--green)'; }
    setTimeout(() => closeSettingsModal('hr'), 1500);
  } catch (err) {
    if (fb) { fb.textContent = err.message; fb.style.color = 'var(--red)'; }
  }
}

function setupHrAddEmployeeValidation() {
  const form = document.getElementById('hr-add-employee-form');
  if (!form) return;
  const INVALID_NAME_CHARS = /[^A-Za-z\s]/g;
  const INVALID_ID_CHARS = /[A-Za-z]/g;
  form.querySelectorAll('.name-input').forEach((input) => {
    const errorSpan = input.nextElementSibling;
    if (input.dataset.hrNameBound === '1') return;
    input.dataset.hrNameBound = '1';
    input.addEventListener('input', () => {
      const original = input.value;
      const cleaned = original.replace(INVALID_NAME_CHARS, '');
      if (cleaned !== original) {
        const pos = input.selectionStart - (original.length - cleaned.length);
        input.value = cleaned;
        input.setSelectionRange(Math.max(0, pos), Math.max(0, pos));
        if (errorSpan) errorSpan.textContent = 'Only letters and spaces are allowed.';
      } else {
        if (errorSpan) errorSpan.textContent = '';
      }
    });
  });
  ['sss_number', 'pagibig_number', 'philhealth_number', 'bank_account_number'].forEach((fieldName) => {
    const input = form.elements[fieldName];
    if (!input || input.dataset.hrGovIdBound === '1') return;
    input.dataset.hrGovIdBound = '1';
    const errorSpan = input.nextElementSibling;
    input.addEventListener('input', () => {
      const original = input.value;
      const cleaned = original.replace(INVALID_ID_CHARS, '');
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

  const salaryInput = form.elements.basic_salary;
  if (salaryInput && salaryInput.dataset.hrSalaryBound !== '1') {
    salaryInput.dataset.hrSalaryBound = '1';
    const salaryError = salaryInput.nextElementSibling;
    salaryInput.addEventListener('keydown', (e) => {
      if (e.key === 'e' || e.key === 'E' || e.key === '+') {
        e.preventDefault();
        if (salaryError) { salaryError.textContent = 'Only numbers are allowed.'; }
        setTimeout(() => { if (salaryError) salaryError.textContent = ''; }, 2000);
      }
    });
    salaryInput.addEventListener('input', () => {
      if (salaryError) salaryError.textContent = '';
    });
  }
}

/* ── PROFILE ── */
function loadHRProfile() {
  const ctx = typeof getLegacyAuthContext === 'function' ? getLegacyAuthContext() : null;
  if (!ctx) return;

  const initials = (String(ctx.full_name || '').trim()
    .split(/\s+/).slice(0, 2).map(w => w[0] || '').join('') || 'HR').toUpperCase();

  const setTxt = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val || '—'; };

  setTxt('hr-ep-avatar',    initials);
  setTxt('hr-ep-name',      ctx.full_name    || 'HR Officer');
  setTxt('hr-ep-pos',       ctx.position     || ctx.employee_type || '');
  setTxt('hr-ep-role-tag',  ctx.role         || 'HR');
  setTxt('hr-ep-info-name',    ctx.full_name);
  setTxt('hr-ep-info-id',     ctx.employee_id);
  setTxt('hr-ep-info-pos',    ctx.position);
  setTxt('hr-ep-info-type',   ctx.employee_type);
  setTxt('hr-ep-info-email',  ctx.email);
  setTxt('hr-ep-info-role',   ctx.role);
  setTxt('hr-ep-bank-name',   ctx.bank_name);
  setTxt('hr-ep-bank-account',ctx.bank_account_number);
}

/* ── INIT ── */
function initHRPortal() {
  applyHRIdentity();

  const savedPage = typeof getPersistedRolePageState === 'function'
    ? getPersistedRolePageState('hr')
    : '';

  if (savedPage && document.getElementById(savedPage)) {
    const navEl = document.querySelector(`#s-hr .ni[onclick*="${savedPage}"]`);
    hrNav(savedPage, navEl);
  } else {
    loadHRDashboard();
  }

  const sidebar = document.querySelector('#s-hr .sidebar');
  if (typeof attachSidebarSpotlight === 'function') attachSidebarSpotlight(sidebar);

  // Set today's date in attendance date picker
  const attDate = document.getElementById('hr-att-date');
  if (attDate && !attDate.value) attDate.value = new Date().toISOString().slice(0, 10);

  // Set today's date in report to field
  const repTo = document.getElementById('hr-report-to');
  if (repTo && !repTo.value) repTo.value = new Date().toISOString().slice(0, 10);

  setupHrAddEmployeeValidation();
}

window.addEventListener('sacs-auth-context-changed', (event) => {
  const ctx = event?.detail;
  if (ctx?.role === 'hr') applyHRIdentity();
});

// Auto-init when HR screen becomes active
/* ═══════════════════════════════════════
   HR BRANCH ASSIGNMENT
   ═══════════════════════════════════════ */

const HR_BRANCH_COLORS = ['var(--amber)', 'var(--blue)', 'var(--teal)', 'var(--green)', 'var(--red)'];

function hrRenderBranchFilterUI() {
  const CARD_COLORS = ['a', 'b', 't', 'g', 'r'];

  // Reset filter to 'all' if the selected branch no longer exists
  if (hrBranchFilter !== 'all' && hrBranchFilter !== 'unassigned' && !hrBranches.some((b) => b.id === hrBranchFilter)) {
    hrBranchFilter = 'all';
  }

  // Render summary cards
  const cardsEl = document.getElementById('hr-ba-branch-cards');
  if (cardsEl) {
    let html = `
      <div class="card"><div class="ct">Total Employees</div><div class="cv" id="hr-ba-count-total">0</div><div class="cch">All active employees</div></div>
      <div class="card"><div class="ct">Unassigned</div><div class="cv r" id="hr-ba-count-unassigned">0</div><div class="cch">Not yet in a branch</div></div>
    `;
    hrBranches.forEach((b, i) => {
      const colorClass = CARD_COLORS[i % CARD_COLORS.length];
      const safeName = String(b.name || '').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      html += `<div class="card"><div class="ct">${safeName}</div><div class="cv ${colorClass}" id="hr-ba-count-${b.id}">0</div><div class="cch">Branch campus</div></div>`;
    });
    cardsEl.innerHTML = html;
  }

  // Render filter chips — one per real branch, any count
  const chipsEl = document.getElementById('hr-ba-filter-chips');
  if (!chipsEl) return;

  let chipsHtml = `
    <div class="chip ${hrBranchFilter === 'all' ? 'active' : ''}" data-hbf="all" onclick="setHrBranchFilter('all')">All (0)</div>
    <div class="chip ${hrBranchFilter === 'unassigned' ? 'active' : ''}" data-hbf="unassigned" onclick="setHrBranchFilter('unassigned')">Unassigned (0)</div>
  `;

  if (hrBranches.length) {
    hrBranches.forEach((b) => {
      const safeName = String(b.name || '').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      const isActive = hrBranchFilter === b.id;
      chipsHtml += `<div class="chip ${isActive ? 'active' : ''}" data-hbf="${b.id}" onclick="setHrBranchFilter('${b.id}')">${safeName} (0)</div>`;
    });
  } else {
    chipsHtml += `<span style="font-size:12px;color:var(--t3);padding:4px 8px;align-self:center;">No branches configured — ask an Administrator to add branches first.</span>`;
  }

  chipsEl.innerHTML = chipsHtml;
}

function hrUpdateBranchSummary() {
  const total = hrBranchAllEmployees.length;
  const unassigned = hrBranchAllEmployees.filter((e) => !e.branch).length;

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = String(val); };
  set('hr-ba-count-total', total);
  set('hr-ba-count-unassigned', unassigned);

  const countsByBranch = {};
  hrBranches.forEach((b) => {
    countsByBranch[b.id] = hrBranchAllEmployees.filter((e) => e.branch === b.id).length;
    set(`hr-ba-count-${b.id}`, countsByBranch[b.id]);
  });

  document.querySelectorAll('#hr-ba-filter-chips .chip').forEach((chip) => {
    const bf = chip.getAttribute('data-hbf');
    if (bf === 'all')             chip.textContent = `All (${total})`;
    else if (bf === 'unassigned') chip.textContent = `Unassigned (${unassigned})`;
    else {
      const branch = hrBranches.find((b) => b.id === bf);
      chip.textContent = `${branch ? branch.name : 'Branch'} (${countsByBranch[bf] ?? 0})`;
    }
  });
}

function hrGetFilteredBranchEmployees() {
  const search = hrBranchSearch.toLowerCase();
  return hrBranchAllEmployees.filter((e) => {
    if (hrBranchFilter === 'unassigned') { if (e.branch) return false; }
    else if (hrBranchFilter !== 'all')   { if (e.branch !== hrBranchFilter) return false; }
    if (!search) return true;
    const hay = [e.full_name, e.employee_id, e.email].map((v) => String(v || '').toLowerCase()).join(' ');
    return hay.includes(search);
  });
}

function hrRenderBranchTable(employees) {
  const tbody = document.getElementById('hr-ba-table-body');
  if (!tbody) return;

  if (!employees.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="color:var(--t3);">No employees found.</td></tr>`;
    return;
  }

  tbody.innerHTML = employees.map((emp) => {
    const branchIdx = emp.branch ? hrBranches.findIndex((b) => b.id === emp.branch) : -1;
    const branchColor = branchIdx >= 0 ? HR_BRANCH_COLORS[branchIdx % HR_BRANCH_COLORS.length] : 'var(--t3)';
    const inactiveTag = emp.branch && emp.branch_status && emp.branch_status !== 'Active' ? ' (Inactive)' : '';
    const branchLabel = emp.branch ? String((emp.branch_label || 'Unknown branch') + inactiveTag).replace(/</g,'&lt;').replace(/>/g,'&gt;') : null;
    const branchCell = branchLabel
      ? `<span style="display:inline-block;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600;background:${branchColor}22;color:${branchColor};border:1px solid ${branchColor}55;">${branchLabel}</span>`
      : `<span class="badge br"><span class="bd"></span>Unassigned</span>`;
    const assignedAt = emp.assigned_at
      ? new Date(emp.assigned_at).toLocaleDateString('en-PH', { year:'numeric', month:'short', day:'numeric' })
      : '—';
    const typeClass = emp.employee_type === 'Non-Teaching' ? 'ba' : 'bt2';
    const safeId = String(emp.id || '').replaceAll("'", "\\'");
    const actionBtn = emp.branch
      ? `<button class="btn btn-outline" style="font-size:11px;padding:5px 11px;" onclick="openHrBranchAssignModal('${safeId}')">Reassign</button>`
      : `<button class="btn btn-primary" style="font-size:11px;padding:5px 11px;" onclick="openHrBranchAssignModal('${safeId}')">Assign</button>`;

    return `
      <tr>
        <td class="nm">${String(emp.full_name || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</td>
        <td class="mn">${String(emp.employee_id || '—').replace(/&/g,'&amp;')}</td>
        <td><span class="badge ${typeClass}">${emp.employee_type || 'Teaching'}</span></td>
        <td class="mn">${emp.position || '—'}</td>
        <td>${branchCell}</td>
        <td class="mn" style="font-size:11px;">${assignedAt}</td>
        <td>${actionBtn}</td>
      </tr>
    `;
  }).join('');
}

function hrRenderFilteredBranch() {
  hrUpdateBranchSummary();
  if (hrBranchPaginator) {
    hrBranchPaginator.setData(hrGetFilteredBranchEmployees());
  } else {
    hrRenderBranchTable(hrGetFilteredBranchEmployees());
  }
}

function setHrBranchFilter(filter) {
  hrBranchFilter = filter;
  document.querySelectorAll('#hr-ba-filter-chips .chip').forEach((chip) => {
    chip.classList.toggle('active', chip.getAttribute('data-hbf') === filter);
  });
  hrRenderFilteredBranch();
}

function setHrBranchSearch(value) {
  hrBranchSearch = String(value || '').trim();
  hrRenderFilteredBranch();
}

async function loadHrBranchAssignment() {
  const tbody = document.getElementById('hr-ba-table-body');
  if (tbody) tbody.innerHTML = skeletonRows(7);

  try {
    const [branchRes] = await Promise.allSettled([fetch('/api/admin/branches')]);
    if (branchRes.status === 'fulfilled' && branchRes.value.ok) {
      const bd = await branchRes.value.json();
      hrBranches = (bd.branches || []).filter((b) => b.status === 'Active');
    }
    hrRenderBranchFilterUI();

    const response = await fetch('/api/admin/branch-employees', { method: 'GET' });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Failed to load branch assignments');

    hrBranchAllEmployees = payload.employees || [];
    hrRenderFilteredBranch();
  } catch (error) {
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="7" style="color:var(--red);">${String(error.message || 'Error').replace(/</g,'&lt;')}</td></tr>`;
    }
  }
}

function openHrBranchAssignModal(userId) {
  const modal = document.getElementById('hr-branch-assign-modal');
  const form = document.getElementById('hr-branch-assign-form');
  if (!modal || !form) return;

  hrCurrentBranchEmployee = hrBranchAllEmployees.find((e) => e.id === userId);
  if (!hrCurrentBranchEmployee) {
    window.alert('Employee not found. Please refresh.');
    return;
  }

  const titleEl = document.getElementById('hr-ba-modal-title');
  if (titleEl) titleEl.textContent = hrCurrentBranchEmployee.branch ? 'Reassign Branch' : 'Assign Branch';

  form.elements.user_id.value = hrCurrentBranchEmployee.id;
  form.elements.employee_display.value = `${hrCurrentBranchEmployee.full_name} (${hrCurrentBranchEmployee.employee_id || 'N/A'})`;

  const branchSelect = form.elements.branch;
  if (branchSelect) {
    // Always offer active branches; also include the employee's current branch even if
    // it has since gone inactive, so reassigning away from it stays possible.
    const options = [...hrBranches];
    if (hrCurrentBranchEmployee.branch && !options.some((b) => b.id === hrCurrentBranchEmployee.branch)) {
      options.push({ id: hrCurrentBranchEmployee.branch, name: `${hrCurrentBranchEmployee.branch_label || 'Unknown branch'} (Inactive)` });
    }

    if (options.length) {
      branchSelect.innerHTML = options.map((b) =>
        `<option value="${b.id}">${String(b.name || '').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}</option>`
      ).join('');
    } else {
      branchSelect.innerHTML = '<option value="" disabled>No branches configured yet.</option>';
    }
    if (hrCurrentBranchEmployee.branch) branchSelect.value = hrCurrentBranchEmployee.branch;
  }

  const feedbackEl = document.getElementById('hr-ba-modal-feedback');
  if (feedbackEl) feedbackEl.textContent = '';

  modal.style.display = 'flex';
}

function closeHrBranchAssignModal() {
  const modal = document.getElementById('hr-branch-assign-modal');
  if (modal) modal.style.display = 'none';
}

async function submitHrBranchAssign(event) {
  event.preventDefault();
  const form = event.target;
  const submitBtn = form.querySelector('button[type="submit"]');
  const feedbackEl = document.getElementById('hr-ba-modal-feedback');
  const formData = new FormData(form);

  const userId = String(formData.get('user_id') || '').trim();
  const branchId = String(formData.get('branch') || '').trim();

  if (!userId || !branchId) {
    if (feedbackEl) { feedbackEl.textContent = 'Missing required fields.'; feedbackEl.className = 'adm-feedback err'; }
    return;
  }

  const ctx = typeof getLegacyAuthContext === 'function' ? getLegacyAuthContext() : null;
  const assignedBy = String(ctx?.full_name || ctx?.email || 'hr').trim();

  try {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Assigning...';

    const response = await fetch('/api/admin/branch-employees', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, branch_id: branchId, assigned_by: assignedBy }),
    });

    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Failed to assign branch');

    if (feedbackEl) { feedbackEl.textContent = `Employee assigned to ${result.branch_label}.`; feedbackEl.className = 'adm-feedback ok'; }
    if (typeof pushNotification === 'function') pushNotification('Branch Assigned', `Employee assigned to ${result.branch_label}.`, 'success');
    await loadHrBranchAssignment();
    setTimeout(() => closeHrBranchAssignModal(), 600);
  } catch (error) {
    if (feedbackEl) { feedbackEl.textContent = error.message; feedbackEl.className = 'adm-feedback err'; }
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Confirm Assignment';
  }
}

window.setHrBranchFilter = setHrBranchFilter;
window.setHrBranchSearch = setHrBranchSearch;
window.loadHrBranchAssignment = loadHrBranchAssignment;
window.openHrBranchAssignModal = openHrBranchAssignModal;
window.closeHrBranchAssignModal = closeHrBranchAssignModal;
window.submitHrBranchAssign = submitHrBranchAssign;
window.loadHRProfile = loadHRProfile;

/* ═══════════════════════════════════════
   HR ADD EMPLOYEE
   ═══════════════════════════════════════ */

function openHrAddEmployeeModal() {
  const modal = document.getElementById('hr-add-employee-modal');
  const form = document.getElementById('hr-add-employee-form');
  if (!modal || !form) return;
  form.reset();
  const fb = document.getElementById('hr-add-employee-feedback');
  if (fb) { fb.textContent = ''; fb.className = 'adm-feedback'; }
  modal.style.display = 'flex';
}

function closeHrAddEmployeeModal() {
  const modal = document.getElementById('hr-add-employee-modal');
  if (modal) modal.style.display = 'none';
}

async function submitHrAddEmployee(event) {
  event.preventDefault();
  const form = event.target;
  const fb = document.getElementById('hr-add-employee-feedback');
  const submitBtn = form.querySelector('button[type="submit"]');

  const payload = {
    first_name: form.querySelector('[name="first_name"]').value.trim(),
    middle_initial: form.querySelector('[name="middle_initial"]').value.trim(),
    last_name: form.querySelector('[name="last_name"]').value.trim(),
    suffix: form.querySelector('[name="suffix"]').value,
    role: form.querySelector('[name="role"]').value,
    email: form.querySelector('[name="email"]').value.trim(),
    date_of_birth: form.querySelector('[name="date_of_birth"]').value,
    employee_type: form.querySelector('[name="employee_type"]').value,
    position: form.querySelector('[name="position"]').value,
    employee_status: form.querySelector('[name="employee_status"]').value,
    basic_salary: Number(form.querySelector('[name="basic_salary"]').value || 0),
    address: form.querySelector('[name="address"]').value.trim(),
    cp_number: form.querySelector('[name="cp_number"]').value.trim(),
    date_hired: form.querySelector('[name="date_hired"]').value.trim(),
    sss_number: form.querySelector('[name="sss_number"]').value.trim(),
    pagibig_number: form.querySelector('[name="pagibig_number"]').value.trim(),
    philhealth_number: form.querySelector('[name="philhealth_number"]').value.trim(),
    bank_name: form.querySelector('[name="bank_name"]').value.trim(),
    bank_account_number: form.querySelector('[name="bank_account_number"]').value.trim(),
  };

  if (!payload.first_name || !payload.last_name) {
    if (fb) { fb.textContent = 'First and last name are required.'; fb.style.color = 'var(--red)'; }
    return;
  }
  if (!/^[A-Za-z\s]+$/.test(payload.first_name)) {
    if (fb) { fb.textContent = 'First name must contain only letters.'; fb.style.color = 'var(--red)'; }
    return;
  }
  if (!/^[A-Za-z\s]+$/.test(payload.last_name)) {
    if (fb) { fb.textContent = 'Last name must contain only letters.'; fb.style.color = 'var(--red)'; }
    return;
  }
  if (payload.middle_initial && !/^[A-Za-z\s]+$/.test(payload.middle_initial)) {
    if (fb) { fb.textContent = 'Middle name must contain only letters.'; fb.style.color = 'var(--red)'; }
    return;
  }
  if (!payload.email) {
    if (fb) { fb.textContent = 'Email is required.'; fb.style.color = 'var(--red)'; }
    return;
  }
  if (!payload.date_of_birth) {
    if (fb) { fb.textContent = 'Date of birth is required.'; fb.style.color = 'var(--red)'; }
    return;
  }
  if (payload.sss_number && /[A-Za-z]/.test(payload.sss_number)) {
    if (fb) { fb.textContent = 'SSS Number must not contain letters.'; fb.style.color = 'var(--red)'; }
    return;
  }
  if (payload.pagibig_number && /[A-Za-z]/.test(payload.pagibig_number)) {
    if (fb) { fb.textContent = 'Pag-IBIG Number must not contain letters.'; fb.style.color = 'var(--red)'; }
    return;
  }
  if (payload.philhealth_number && /[A-Za-z]/.test(payload.philhealth_number)) {
    if (fb) { fb.textContent = 'PhilHealth Number must not contain letters.'; fb.style.color = 'var(--red)'; }
    return;
  }
  if (payload.bank_account_number && /[A-Za-z]/.test(payload.bank_account_number)) {
    if (fb) { fb.textContent = 'Bank Account Number must not contain letters.'; fb.style.color = 'var(--red)'; }
    return;
  }

  if (fb) { fb.textContent = 'Creating employee...'; fb.style.color = 'var(--t3)'; }
  submitBtn.disabled = true;

  try {
    const res = await fetch('/api/admin/employees', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to create employee.');

    if (fb) { fb.textContent = `Employee ${data.employee?.full_name || ''} created successfully.`; fb.style.color = 'var(--green)'; }
    if (typeof pushNotification === 'function') pushNotification('Employee Created', `${data.employee?.full_name || 'New employee'} has been added.`, 'success');
    setTimeout(() => {
      closeHrAddEmployeeModal();
      loadHREmployees();
    }, 900);
  } catch (err) {
    if (fb) { fb.textContent = err.message; fb.style.color = 'var(--red)'; }
  } finally {
    submitBtn.disabled = false;
  }
}

const hrScreen = document.getElementById('s-hr');
if (hrScreen?.classList.contains('active')) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initHRPortal);
  } else {
    initHRPortal();
  }
} else if (hrScreen) {
  const hrObserver = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === 'attributes' && m.attributeName === 'class') {
        if (hrScreen.classList.contains('active')) {
          hrObserver.disconnect();
          initHRPortal();
        }
      }
    }
  });
  hrObserver.observe(hrScreen, { attributes: true });
}
