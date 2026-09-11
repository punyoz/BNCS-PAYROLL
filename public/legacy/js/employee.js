/* ═══════════════════════════════════════
   employee.js — Employee portal logic
   Handles: payslip switching, print
   Edit this file for employee features
   ═══════════════════════════════════════ */

'use strict';

const payslipState = { list: [] };

const leaveState = {
  requests: [],
};

function normalizePortalPosition(positionValue, roleValue) {
  const role = String(roleValue || '').trim().toLowerCase();
  const position = String(positionValue || '').trim().toLowerCase();

  if (role === 'accountant' || position === 'accountant' || position.includes('account')) {
    return 'Accountant';
  }

  return 'Employee';
}

function getInitials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'EM';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

function applyEmployeeIdentity() {
  const context = window.getLegacyAuthContext ? window.getLegacyAuthContext() : null;

  const fullName = String(context?.full_name || '').trim();
  const rolePosition = context ? normalizePortalPosition(context.position, context.role) : 'Employee';
  const employeeType = String(context?.employee_type || '').trim();
  const positionLabel = String(context?.position || '').trim();
  const employeeId = String(context?.employee_id || '').trim();
  const displayName = fullName || rolePosition || 'Employee';

  const staffLabel = employeeType ? `${employeeType} Staff` : positionLabel;

  const topName = document.getElementById('emp-top-name');
  if (topName) topName.textContent = `Welcome, ${displayName}`;

  const topRole = document.getElementById('emp-top-role');
  if (topRole) topRole.textContent = rolePosition || 'Employee';

  const avatar = document.getElementById('emp-avatar');
  if (avatar) avatar.textContent = getInitials(displayName);

  const helloTitle = document.getElementById('emp-hello-title');
  if (helloTitle) helloTitle.textContent = `${displayName} 👋`;

  const helloMeta = document.getElementById('emp-hello-meta');
  if (helloMeta) {
    const pieces = [rolePosition];
    if (staffLabel) pieces.push(staffLabel);
    pieces.push(employeeId || 'N/A');
    helloMeta.textContent = pieces.join(' · ');
  }
}

function formatPhTime(isoString) {
  if (!isoString) return null;
  try {
    return new Intl.DateTimeFormat('en-PH', {
      timeZone: 'Asia/Manila',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    }).format(new Date(isoString)).toUpperCase();
  } catch {
    return null;
  }
}

function renderAttendanceCalendar(records, monthLabel, todayKey) {
  const titleEl = document.getElementById('emp-att-month-title');
  if (titleEl) titleEl.textContent = `My Attendance — ${monthLabel}`;

  const grid = document.getElementById('emp-att-grid');
  if (!grid) return;

  const statusMap = {};
  for (const rec of records) {
    statusMap[rec.date] = rec.status;
  }

  const [year, month] = todayKey.split('-').map(Number);
  const todayDay = Number(todayKey.split('-')[2]);
  const daysInMonth = new Date(year, month, 0).getDate();
  const firstDayOfWeek = new Date(year, month - 1, 1).getDay();

  let html = '<div class="adh">Su</div><div class="adh">Mo</div><div class="adh">Tu</div>' +
             '<div class="adh">We</div><div class="adh">Th</div><div class="adh">Fr</div><div class="adh">Sa</div>';

  // Spacer cells — truly empty, `em` keeps them invisible
  for (let i = 0; i < firstDayOfWeek; i++) {
    html += '<div class="ad em"></div>';
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const dateKey = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const isToday = dateKey === todayKey;
    const isFuture = day > todayDay;
    const status = statusMap[dateKey];

    let cls = 'ad';
    if (status === 'Present') cls += ' pr';
    else if (status === 'Late') cls += ' lt';
    else if (status === 'Absent') cls += ' ab';
    else if (isFuture) cls += ' future';  // upcoming — faded number
    else cls += ' no-rec';               // past with no record — muted number

    if (isToday) cls += ' td';

    html += `<div class="${cls}">${day}</div>`;
  }

  grid.innerHTML = html;
}

function updateTodayLog(today) {
  const timeInEl = document.getElementById('emp-today-timein');
  const timeOutEl = document.getElementById('emp-today-timeout');
  const statusWrap = document.getElementById('emp-today-status-wrap');

  if (!today || !today.time_in) {
    if (timeInEl) { timeInEl.textContent = '— : —'; timeInEl.style.color = 'var(--t3)'; }
    if (timeOutEl) { timeOutEl.textContent = '— : —'; timeOutEl.style.color = 'var(--t3)'; }
    if (statusWrap) statusWrap.innerHTML = '<span class="badge ba"><span class="bd"></span>No data</span>';
    return;
  }

  const timeIn = formatPhTime(today.time_in);
  const timeOut = today.time_out ? formatPhTime(today.time_out) : null;
  const statusLower = String(today.status || '').toLowerCase();

  if (timeInEl) {
    timeInEl.textContent = timeIn || '— : —';
    timeInEl.style.color = timeIn ? 'var(--green)' : 'var(--t3)';
  }
  if (timeOutEl) {
    timeOutEl.textContent = timeOut || '— : —';
    timeOutEl.style.color = timeOut ? 'var(--teal)' : 'var(--t3)';
  }
  if (statusWrap) {
    const badgeCls = statusLower === 'present' ? 'bg' : statusLower === 'late' ? 'ba' : 'br';
    statusWrap.innerHTML = `<span class="badge ${badgeCls}"><span class="bd"></span>${today.status || 'Absent'}</span>`;
  }
}

async function loadEmployeeStats() {
  const context = window.getLegacyAuthContext ? window.getLegacyAuthContext() : null;
  const email = String(context?.email || '').trim();
  if (!email) return;

  try {
    const resp = await fetch(`/api/employee/stats?email=${encodeURIComponent(email)}`);
    if (!resp.ok) return;
    const data = await resp.json();

    const presentEl = document.getElementById('emp-stat-present');
    if (presentEl) presentEl.textContent = data.present ?? '—';

    const lateEl = document.getElementById('emp-stat-late');
    if (lateEl) lateEl.textContent = data.late ?? '—';

    const absentEl = document.getElementById('emp-stat-absent');
    if (absentEl) absentEl.textContent = data.absent ?? '—';

    const netpayEl = document.getElementById('emp-stat-netpay');
    if (netpayEl) netpayEl.textContent = data.basic_salary || '—';

    if (data.today_key && data.month_label) {
      renderAttendanceCalendar(data.records || [], data.month_label, data.today_key);
    }
    updateTodayLog(data.today || null);
  } catch {
    // Stats are supplementary — fail silently
  }
}

function handleLegacyAuthContextChange() {
  applyEmployeeIdentity();
  loadMyLeaveRequests();
  loadEmployeeStats();
  loadPayslips();
}

function fmtPeso(amount) {
  const n = Number(amount || 0);
  return '₱ ' + n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtPesoShort(amount) {
  const n = Number(amount || 0);
  return '₱ ' + n.toLocaleString('en-PH', { maximumFractionDigits: 0 });
}

function renderPayslipCard(payslip) {
  const periodLabel = document.getElementById('ps-period-label');
  const psRows = document.getElementById('ps-rows');
  const psNet = document.getElementById('ps-net');
  const psNetLabel = document.getElementById('ps-net-label');
  const psNetAmount = document.getElementById('ps-net-amount');

  if (!psRows) return;

  if (!payslip) {
    if (periodLabel) periodLabel.textContent = 'No payslip available';
    psRows.innerHTML = '<div class="ps-row" style="color:var(--t3);font-style:italic;justify-content:center;padding:16px;">No payslip data available.</div>';
    if (psNet) psNet.style.display = 'none';
    return;
  }

  const issuedDate = payslip.processed_at
    ? new Intl.DateTimeFormat('en-PH', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila' }).format(new Date(payslip.processed_at))
    : '';
  if (periodLabel) periodLabel.textContent = issuedDate ? `${payslip.period_label} · Issued ${issuedDate}` : payslip.period_label;

  let rows = '';
  if (payslip.has_breakdown) {
    rows += `<div class="ps-row"><span>Basic Salary</span><span class="mn">${fmtPeso(payslip.basic_salary)}</span></div>`;
    if (payslip.transportation) rows += `<div class="ps-row"><span>Transportation</span><span class="mn">${fmtPeso(payslip.transportation)}</span></div>`;
    if (payslip.rice) rows += `<div class="ps-row"><span>Rice Allowance</span><span class="mn">${fmtPeso(payslip.rice)}</span></div>`;
    if (payslip.overtime) rows += `<div class="ps-row"><span>Overtime</span><span class="mn">${fmtPeso(payslip.overtime)}</span></div>`;
    if (payslip.bonus) rows += `<div class="ps-row"><span>Bonus</span><span class="mn">${fmtPeso(payslip.bonus)}</span></div>`;
    rows += `<div class="ps-row tot"><span>Gross Pay</span><span class="mn" style="color:var(--teal);">${fmtPeso(payslip.gross_pay)}</span></div>`;
    if (payslip.sss) rows += `<div class="ps-row" style="color:var(--red);"><span>SSS</span><span class="mn">- ${fmtPeso(payslip.sss)}</span></div>`;
    if (payslip.philhealth) rows += `<div class="ps-row" style="color:var(--red);"><span>PhilHealth</span><span class="mn">- ${fmtPeso(payslip.philhealth)}</span></div>`;
    if (payslip.pagibig) rows += `<div class="ps-row" style="color:var(--red);"><span>Pag-IBIG</span><span class="mn">- ${fmtPeso(payslip.pagibig)}</span></div>`;
    if (payslip.withholding_tax) rows += `<div class="ps-row" style="color:var(--red);"><span>Withholding Tax</span><span class="mn">- ${fmtPeso(payslip.withholding_tax)}</span></div>`;
    if (payslip.absence_deduction) rows += `<div class="ps-row" style="color:var(--red);"><span>Absences (${payslip.absences_days}d)</span><span class="mn">- ${fmtPeso(payslip.absence_deduction)}</span></div>`;
    if (payslip.leave_with_pay_days) rows += `<div class="ps-row"><span>Leave With Pay (${payslip.leave_with_pay_days}d)</span><span class="mn">—</span></div>`;
    if (payslip.leave_without_pay_deduction) rows += `<div class="ps-row" style="color:var(--red);"><span>Leave Without Pay (${payslip.leave_without_pay_days}d)</span><span class="mn">- ${fmtPeso(payslip.leave_without_pay_deduction)}</span></div>`;
  } else {
    rows += `<div class="ps-row tot"><span>Gross Pay</span><span class="mn" style="color:var(--teal);">${fmtPeso(payslip.gross_pay)}</span></div>`;
    rows += `<div class="ps-row" style="color:var(--red);"><span>Total Deductions</span><span class="mn">- ${fmtPeso(payslip.total_deductions)}</span></div>`;
  }

  psRows.innerHTML = rows;
  if (psNet) psNet.style.display = '';
  if (psNetLabel) psNetLabel.textContent = `Net Pay — ${payslip.period_label}`;
  if (psNetAmount) psNetAmount.textContent = fmtPeso(payslip.net_pay);
}

function renderPrevPayslips(payslips, startIdx) {
  const container = document.getElementById('emp-prev-payslips');
  if (!container) return;

  if (!payslips.length) {
    container.innerHTML = '<div style="font-size:12px;color:var(--t3);">No previous payslips.</div>';
    return;
  }

  container.innerHTML = payslips.map((ps, i) => {
    const globalIdx = startIdx + i;
    const issuedDate = ps.processed_at
      ? new Intl.DateTimeFormat('en-PH', { month: 'short', day: '2-digit', year: 'numeric', timeZone: 'Asia/Manila' }).format(new Date(ps.processed_at))
      : '';
    return `
      <div class="past-ps-item">
        <div>
          <div class="ppi-name">${ps.period_label}</div>
          ${issuedDate ? `<div class="ppi-date">Issued ${issuedDate}</div>` : ''}
        </div>
        <div class="ppi-right">
          <span class="ppi-amt">${fmtPesoShort(ps.net_pay)}</span>
          <button class="btn btn-outline" style="font-size:11px;padding:4px 10px;" onclick="viewPayslip(${globalIdx})">View</button>
        </div>
      </div>
    `;
  }).join('');
}

function viewPayslip(idx) {
  const payslip = payslipState.list[idx];
  if (payslip) renderPayslipCard(payslip);
}

async function loadPayslips() {
  const context = window.getLegacyAuthContext ? window.getLegacyAuthContext() : null;
  const email = String(context?.email || '').trim();
  if (!email) return;

  try {
    const resp = await fetch(`/api/employee/payslips?email=${encodeURIComponent(email)}`);
    if (!resp.ok) return;
    const data = await resp.json();
    const list = Array.isArray(data.payslips) ? data.payslips : [];
    payslipState.list = list;

    renderPayslipCard(list[0] || null);
    renderPrevPayslips(list.slice(1), 1);
  } catch {
    // fail silently
  }
}

function showLeaveFeedback(message, isError = false) {
  const el = document.getElementById('emp-leave-feedback');
  if (!el) return;

  el.textContent = message;
  el.classList.toggle('err', isError);
  el.classList.toggle('ok', !isError && Boolean(message));
}

function renderLeaveRequests() {
  const container = document.getElementById('emp-leave-list');
  if (!container) return;

  if (!leaveState.requests.length) {
    container.innerHTML = '<div style="font-size:12px;color:var(--t3);">No leave requests submitted yet.</div>';
    return;
  }

  container.innerHTML = leaveState.requests.map((request) => {
    const status = String(request.status || 'pending').toLowerCase();
    const badgeClass = status === 'approved' ? 'bg' : status === 'rejected' ? 'br' : 'ba';
    const payStatusLabel = request.pay_status === 'without_pay' ? 'Without Pay' : 'With Pay';
    const submittedAt = request.submitted_at ? new Date(request.submitted_at).toLocaleString('en-PH', {
      month: 'short', day: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    }) : 'Unknown date';

    return `
      <div style="border:1px solid var(--border);border-radius:10px;padding:10px 11px;background:var(--bg3);">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;">
          <div style="font-size:12px;font-weight:600;color:var(--t1);">${request.leave_type} · ${payStatusLabel}</div>
          <span class="badge ${badgeClass}"><span class="bd"></span>${status}</span>
        </div>
        <div style="margin-top:4px;font-size:11px;color:var(--t2);">${request.start_date} to ${request.end_date}</div>
        <div style="margin-top:6px;font-size:11px;color:var(--t3);line-height:1.45;">${request.reason}</div>
        <div style="margin-top:7px;font-size:10px;color:var(--t3);">Submitted: ${submittedAt}</div>
      </div>
    `;
  }).join('');
}

function renderLeaveBalance(balance) {
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  const bal = balance || { with_pay_allotment: 0, with_pay_used: 0, with_pay_remaining: 0, without_pay_used: 0 };

  set('emp-leave-bal-with-used', `${bal.with_pay_used} of ${bal.with_pay_allotment} days`);
  set('emp-leave-bal-with-remaining', `${bal.with_pay_remaining} days`);
  set('emp-leave-bal-without-used', `${bal.without_pay_used} days`);
}

async function loadMyLeaveRequests() {
  const context = window.getLegacyAuthContext ? window.getLegacyAuthContext() : null;
  const employeeId = String(context?.employee_id || '').trim();
  const fullName = String(context?.full_name || '').trim();

  if (!employeeId && !fullName) {
    leaveState.requests = [];
    renderLeaveRequests();
    return;
  }

  const container = document.getElementById('emp-leave-list');
  if (container && window.skeletonCards) container.innerHTML = window.skeletonCards(3);

  try {
    const params = new URLSearchParams();
    if (employeeId) params.set('employee_id', employeeId);
    if (fullName) params.set('employee_name', fullName);

    const response = await fetch(`/api/employee/leave-requests?${params.toString()}`, { method: 'GET' });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || 'Failed to load leave requests.');
    }

    leaveState.requests = Array.isArray(payload.requests) ? payload.requests : [];
    renderLeaveRequests();
    renderLeaveBalance(payload.balance);
  } catch (error) {
    showLeaveFeedback(error.message, true);
  }
}

async function submitLeaveRequest() {
  const context = window.getLegacyAuthContext ? window.getLegacyAuthContext() : null;
  const employeeId = String(context?.employee_id || '').trim();
  const employeeName = String(context?.full_name || '').trim();
  const position = String(context?.position || '').trim();

  const leaveType = String(document.getElementById('emp-leave-type')?.value || '').trim();
  const payStatus = String(document.getElementById('emp-leave-pay-status')?.value || 'with_pay').trim();
  const startDate = String(document.getElementById('emp-leave-start')?.value || '').trim();
  const endDate = String(document.getElementById('emp-leave-end')?.value || '').trim();
  const reason = String(document.getElementById('emp-leave-reason')?.value || '').trim();
  const proofFile = document.getElementById('emp-leave-proof')?.files?.[0];

  if (!leaveType || !startDate || !endDate || !reason) {
    showLeaveFeedback('Leave type, date range, and reason are required.', true);
    return;
  }

  if (startDate > endDate) {
    showLeaveFeedback('Start date must not be after end date.', true);
    return;
  }

  if (!employeeName) {
    showLeaveFeedback('Unable to resolve employee profile. Please sign in again.', true);
    return;
  }

  try {
    showLeaveFeedback('Submitting leave request...', false);

    let proofUrl = '';
    if (proofFile) {
      if (proofFile.size > 2 * 1024 * 1024) throw new Error('Proof file must be less than 2MB.');
      proofUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Failed to read file.'));
        reader.readAsDataURL(proofFile);
      });
    }

    const response = await fetch('/api/employee/leave-requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        employee_id: employeeId,
        employee_name: employeeName,
        position,
        leave_type: leaveType,
        pay_status: payStatus,
        start_date: startDate,
        end_date: endDate,
        reason,
        proof_url: proofUrl,
      }),
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || 'Failed to submit leave request.');
    }

    document.getElementById('emp-leave-type').value = '';
    if (document.getElementById('emp-leave-pay-status')) {
      document.getElementById('emp-leave-pay-status').value = 'with_pay';
    }
    document.getElementById('emp-leave-start').value = '';
    document.getElementById('emp-leave-end').value = '';
    document.getElementById('emp-leave-reason').value = '';
    if (document.getElementById('emp-leave-proof')) {
      document.getElementById('emp-leave-proof').value = '';
    }

    showLeaveFeedback('Leave request submitted successfully.', false);
    window.pushNotification?.(
      'Leave Request Submitted',
      `${leaveType} · ${startDate} to ${endDate} · Awaiting admin approval.`,
      'success'
    );
    await loadMyLeaveRequests();
  } catch (error) {
    showLeaveFeedback(error.message, true);
  }
}

/* ── CHANGE PASSWORD ── */
function showChangePasswordFeedback(message, isError = false) {
  const el = document.getElementById('emp-change-password-feedback');
  if (!el) return;
  el.textContent = message;
  el.classList.toggle('err', isError);
  el.classList.toggle('ok', !isError && Boolean(message));
}

async function submitChangePassword() {
  const context = window.getLegacyAuthContext ? window.getLegacyAuthContext() : null;
  const email = String(context?.email || '').trim();

  const currentPassword = String(document.getElementById('emp-cur-password')?.value || '').trim();
  const newPassword = String(document.getElementById('emp-new-password')?.value || '').trim();
  const confirmPassword = String(document.getElementById('emp-confirm-password')?.value || '').trim();

  if (!email) {
    showChangePasswordFeedback('Unable to identify account. Please sign in again.', true);
    return;
  }

  if (!currentPassword || !newPassword || !confirmPassword) {
    showChangePasswordFeedback('All password fields are required.', true);
    return;
  }

  if (newPassword !== confirmPassword) {
    showChangePasswordFeedback('New passwords do not match.', true);
    return;
  }

  if (newPassword.length < 8) {
    showChangePasswordFeedback('New password must be at least 8 characters.', true);
    return;
  }

  try {
    showChangePasswordFeedback('Updating password...', false);

    const response = await fetch('/api/legacy-auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, current_password: currentPassword, new_password: newPassword }),
    });

    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(result.error || 'Failed to update password.');
    }

    document.getElementById('emp-cur-password').value = '';
    document.getElementById('emp-new-password').value = '';
    document.getElementById('emp-confirm-password').value = '';

    showChangePasswordFeedback('Password updated successfully.', false);
    window.pushNotification?.('Password Changed', 'Your account password has been updated successfully.', 'success');
    setTimeout(() => window.closeSettingsModal?.('emp'), 1200);
  } catch (error) {
    showChangePasswordFeedback(error.message, true);
  }
}

/* ── INIT ── */
let _empStatsPollStarted = false;
function initEmployeePortal() {
  const currentRole = new URLSearchParams(window.location.search).get('role');
  if (String(currentRole || '').toLowerCase() !== 'employee') {
    return;
  }

  applyEmployeeIdentity();
  loadMyLeaveRequests();
  loadEmployeeStats();
  loadPayslips();

  // An RFID tap is recorded by an admin elsewhere (System Maintenance scan
  // input), so poll here — it's the only way this dashboard's Present/Time
  // In status reflects that tap without the employee manually reloading.
  if (!_empStatsPollStarted) {
    _empStatsPollStarted = true;
    setInterval(() => {
      if (document.visibilityState === 'visible') loadEmployeeStats();
    }, 30000);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initEmployeePortal);
} else {
  initEmployeePortal();
}

window.addEventListener('sacs-auth-context-changed', handleLegacyAuthContextChange);

window.submitLeaveRequest = submitLeaveRequest;
window.submitChangePassword = submitChangePassword;
window.viewPayslip = viewPayslip;

/* ════════════════════════════════════════════
   EMPLOYEE TAB NAVIGATION
════════════════════════════════════════════ */
const EMP_PAGES = {
  'emp-dash':        'Dashboard',
  'emp-attendance':  'Attendance',
  'emp-timesheet':   'Timesheet',
  'emp-payslips':    'Payslips',
  'emp-leave':       'Leave',
};

function empNav(pageId, tabEl) {
  Object.keys(EMP_PAGES).forEach(id => {
    document.getElementById(id)?.classList.remove('active');
  });
  document.getElementById(pageId)?.classList.add('active');

  document.querySelectorAll('#emp-tabnav .emp-tab').forEach(t => t.classList.remove('active'));
  if (tabEl) {
    tabEl.classList.add('active');
  } else {
    const matchTab = document.querySelector(`#emp-tabnav .emp-tab[data-emp-page="${pageId}"]`);
    if (matchTab) matchTab.classList.add('active');
  }

  window.persistRolePageState?.('employee', pageId);

  if (pageId === 'emp-attendance') loadAttendanceRecords();
  if (pageId === 'emp-timesheet')  _initTimesheetTab();
  if (pageId === 'emp-profile')    loadProfilePage?.();
}

function _initTimesheetTab() {
  const monthEl = document.getElementById('ts-month-picker');
  if (monthEl && !monthEl.value) {
    try {
      const phDate = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Manila',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());
      monthEl.value = phDate.slice(0, 7);
    } catch { /* best-effort */ }
  }
  loadTimesheet();
}

/* Restore last-active tab once auth context is ready (runs once per session) */
let _empTabsRestored = false;
function _restoreEmpTabs() {
  if (_empTabsRestored) return;
  const currentRole = new URLSearchParams(window.location.search).get('role');
  if (String(currentRole || '').toLowerCase() !== 'employee') return;
  _empTabsRestored = true;
  const savedPage = window.getPersistedRolePageState?.('employee');
  if (savedPage && EMP_PAGES[savedPage] && savedPage !== 'emp-dash') {
    empNav(savedPage, null);
  }
}
window.addEventListener('sacs-auth-context-changed', _restoreEmpTabs);

/* ════════════════════════════════════════════
   ATTENDANCE RECORDS LIST (Attendance tab)
════════════════════════════════════════════ */
async function loadAttendanceRecords() {
  const context = window.getLegacyAuthContext ? window.getLegacyAuthContext() : null;
  const email = String(context?.email || '').trim();
  const container = document.getElementById('emp-att-records');
  const labelEl = document.getElementById('emp-att-records-label');
  if (!container) return;

  container.innerHTML = `<div style="overflow-x:auto;"><table><thead><tr><th>Date</th><th>Day</th><th>Time In</th><th>Time Out</th><th>Status</th></tr></thead><tbody>${skeletonRows(5, 5)}</tbody></table></div>`;

  if (!email) {
    container.innerHTML = '<div style="font-size:12px;color:var(--t3);">Unable to load records.</div>';
    return;
  }

  try {
    const resp = await fetch(`/api/employee/stats?email=${encodeURIComponent(email)}`);
    if (!resp.ok) throw new Error('Failed to load attendance data.');
    const data = await resp.json();
    const records = Array.isArray(data.records) ? data.records : [];

    if (labelEl && data.month_label) labelEl.textContent = data.month_label;

    if (!records.length) {
      container.innerHTML = '<div style="font-size:12px;color:var(--t3);padding:12px 0;">No records found for this month.</div>';
      return;
    }

    const rows = records.map(r => {
      const statusLower = String(r.status || '').toLowerCase();
      const badgeCls = statusLower === 'present' ? 'bg' : statusLower === 'late' ? 'ba' : 'br';
      const timeIn  = formatPhTime(r.time_in)  || '—';
      const timeOut = formatPhTime(r.time_out) || '—';
      let dayName = '';
      try {
        dayName = new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', weekday: 'short' })
          .format(new Date(`${r.date}T00:00:00+08:00`));
      } catch { /* best-effort */ }

      return `<tr>
        <td class="nm">${r.date}</td>
        <td style="color:var(--t3);">${dayName}</td>
        <td class="mn">${timeIn}</td>
        <td class="mn">${timeOut}</td>
        <td><span class="badge ${badgeCls}"><span class="bd"></span>${r.status}</span></td>
      </tr>`;
    }).join('');

    container.innerHTML = `<div style="overflow-x:auto;"><table>
      <thead><tr>
        <th>Date</th><th>Day</th><th>Time In</th><th>Time Out</th><th>Status</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
  } catch (err) {
    container.innerHTML = `<div style="font-size:12px;color:var(--red);padding:8px 0;">${err.message}</div>`;
  }
}

/* ════════════════════════════════════════════
   TIMESHEET MODULE — date-range DTR
════════════════════════════════════════════ */
const timesheetState = {
  allRecords: [],
  filtered:   [],
  page:       1,
  perPage:    10,
};

function _tsGetPerPage() {
  const val = document.getElementById('ts-perpage')?.value || '10';
  return val === 'all' ? Infinity : parseInt(val, 10);
}

function tsOnPerPage() {
  timesheetState.page    = 1;
  timesheetState.perPage = _tsGetPerPage();
  renderTsPage();
}

function tsOnSearch() {
  const q = String(document.getElementById('ts-search')?.value || '').toLowerCase().trim();
  timesheetState.filtered = q
    ? timesheetState.allRecords.filter(r =>
        [r.date, r.day, r.shift_type, r.time_in, r.time_out, r.status]
          .some(v => v && String(v).toLowerCase().includes(q))
      )
    : [...timesheetState.allRecords];
  timesheetState.page = 1;
  renderTsPage();
}

function renderTsPage() {
  const tbody = document.getElementById('ts-tbody');
  if (!tbody) return;

  const { filtered, page } = timesheetState;
  const perPage = _tsGetPerPage();
  const total   = filtered.length;
  const start   = perPage === Infinity ? 0 : (page - 1) * perPage;
  const end     = perPage === Infinity ? total : Math.min(start + perPage, total);
  const slice   = filtered.slice(start, end);

  if (!slice.length) {
    tbody.innerHTML = '<tr><td colspan="12" style="text-align:center;padding:28px;color:var(--t3);font-size:12px;">No records found.</td></tr>';
  } else {
    tbody.innerHTML = slice.map(r => {
      const rowCls =
        r.row_type === 'rest'    ? 'ts-row-rest' :
        r.row_type === 'holiday' ? 'ts-row-holiday' :
        r.row_type === 'special' ? 'ts-row-special' : '';
      return `<tr class="${rowCls}">
        <td style="padding:8px 10px;"><span class="ts-expand-btn">+</span></td>
        <td class="nm">${r.date}</td>
        <td>${r.day}</td>
        <td>${r.shift_type}</td>
        <td class="mn">${r.shift_in  || ''}</td>
        <td class="mn">${r.shift_out || ''}</td>
        <td class="mn">${r.time_in   || ''}</td>
        <td class="mn">${r.time_out  || ''}</td>
        <td style="text-align:center;">${r.required_hours}</td>
        <td style="text-align:center;">${r.tardiness}</td>
        <td style="text-align:center;">${r.undertime}</td>
        <td style="text-align:center;">${r.leave_with_pay}</td>
      </tr>`;
    }).join('');
  }

  const showingEl = document.getElementById('ts-showing');
  if (showingEl) {
    const from = total === 0 ? 0 : start + 1;
    const to   = total === 0 ? 0 : end;
    showingEl.textContent = `Showing ${from} to ${to} of ${total} entries`;
  }

  _renderTsPagination(total, perPage, page);
}

function _renderTsPagination(total, perPage, currentPage) {
  const prevBtn  = document.getElementById('ts-prev');
  const nextBtn  = document.getElementById('ts-next');
  const numsCont = document.getElementById('ts-page-nums');

  if (perPage === Infinity || total === 0) {
    if (prevBtn)  prevBtn.style.display  = 'none';
    if (nextBtn)  nextBtn.style.display  = 'none';
    if (numsCont) numsCont.innerHTML     = '';
    return;
  }

  if (prevBtn)  prevBtn.style.display = '';
  if (nextBtn)  nextBtn.style.display = '';

  const totalPages = Math.ceil(total / perPage);
  if (prevBtn) prevBtn.disabled = currentPage <= 1;
  if (nextBtn) nextBtn.disabled = currentPage >= totalPages;

  if (numsCont) {
    numsCont.innerHTML = Array.from({ length: totalPages }, (_, i) => i + 1)
      .map(n => `<span class="ts-pg-num${n === currentPage ? ' active' : ''}" onclick="tsGoPage(${n})">${n}</span>`)
      .join('');
  }
}

function tsGoPage(n) {
  timesheetState.page = n;
  renderTsPage();
}

function tsPrevPage() {
  if (timesheetState.page > 1) { timesheetState.page--; renderTsPage(); }
}

function tsNextPage() {
  const perPage     = _tsGetPerPage();
  const totalPages  = perPage === Infinity ? 1 : Math.ceil(timesheetState.filtered.length / perPage);
  if (timesheetState.page < totalPages) { timesheetState.page++; renderTsPage(); }
}

async function generateTimesheet() {
  const context   = window.getLegacyAuthContext ? window.getLegacyAuthContext() : null;
  const email     = String(context?.email || '').trim();
  const startDate = String(document.getElementById('ts-start-date')?.value || '').trim();
  const endDate   = String(document.getElementById('ts-end-date')?.value   || '').trim();
  const tbody     = document.getElementById('ts-tbody');

  if (!startDate || !endDate) {
    if (tbody) tbody.innerHTML = '<tr><td colspan="12" style="text-align:center;padding:16px;color:var(--red);font-size:12px;">Please select both start and end dates.</td></tr>';
    return;
  }
  if (startDate > endDate) {
    if (tbody) tbody.innerHTML = '<tr><td colspan="12" style="text-align:center;padding:16px;color:var(--red);font-size:12px;">Start date must not be after end date.</td></tr>';
    return;
  }
  if (tbody) tbody.innerHTML = skeletonRows(12, 5);

  try {
    const params = new URLSearchParams({ email, start_date: startDate, end_date: endDate });
    const resp   = await fetch(`/api/employee/timesheet?${params.toString()}`);
    if (!resp.ok) throw new Error('Failed to load timesheet data.');
    const data   = await resp.json();
    if (data.error) throw new Error(data.error);

    timesheetState.allRecords = Array.isArray(data.records) ? data.records : [];
    timesheetState.filtered   = [...timesheetState.allRecords];
    timesheetState.page       = 1;
    timesheetState.perPage    = _tsGetPerPage();

    const searchEl = document.getElementById('ts-search');
    if (searchEl) searchEl.value = '';

    renderTsPage();
  } catch (err) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="12" style="text-align:center;padding:16px;color:var(--red);font-size:12px;">${err.message}</td></tr>`;
  }
}

function tsCopyTable() {
  const records = timesheetState.filtered;
  if (!records.length) return;
  const headers = ['Date','Day','Shift Type','Shift In','Shift Out','Time In','Time Out','Required Hours','Tardiness','Undertime','Leave w/ Pay'];
  const rows    = records.map(r => [
    r.date, r.day, r.shift_type,
    r.shift_in || '', r.shift_out || '',
    r.time_in  || '', r.time_out  || '',
    r.required_hours, r.tardiness, r.undertime, r.leave_with_pay,
  ].join('\t'));
  const text = [headers.join('\t'), ...rows].join('\n');
  navigator.clipboard?.writeText(text).then(() => {
    window.pushNotification?.('Copied', 'Timesheet copied to clipboard.', 'success');
  }).catch(() => {
    const el = document.createElement('textarea');
    el.value = text;
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
  });
}

function tsExportExcel() {
  const records = timesheetState.filtered;
  if (!records.length) return;
  const context   = window.getLegacyAuthContext ? window.getLegacyAuthContext() : null;
  const name      = String(context?.full_name || 'employee').trim().replace(/\s+/g, '_');
  const startDate = document.getElementById('ts-start-date')?.value || '';
  const endDate   = document.getElementById('ts-end-date')?.value   || '';
  const headers   = ['Date','Day','Shift Type','Shift In','Shift Out','Time In','Time Out','Required Hours','Tardiness','Undertime','Leave w/ Pay'];
  const rows      = records.map(r => [
    r.date, r.day, r.shift_type,
    r.shift_in || '', r.shift_out || '',
    r.time_in  || '', r.time_out  || '',
    r.required_hours, r.tardiness, r.undertime, r.leave_with_pay,
  ]);
  const csv  = [headers, ...rows].map(row =>
    row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')
  ).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `timesheet_${name}_${startDate}_${endDate}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function printTimesheet() {
  document.body.classList.add('ts-printing');
  window.print();
  document.body.classList.remove('ts-printing');
}

function loadTimesheet() {
  /* Pre-fill date inputs with current month range when tab first opens */
  const startEl = document.getElementById('ts-start-date');
  const endEl   = document.getElementById('ts-end-date');
  if (startEl && endEl && !startEl.value && !endEl.value) {
    try {
      const today = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Manila',
        year: 'numeric', month: '2-digit', day: '2-digit',
      }).format(new Date());
      startEl.value = today.slice(0, 7) + '-01';
      endEl.value   = today;
    } catch { /* best-effort */ }
  }
}

/* ── expose new globals ── */
window.empNav             = empNav;
window.loadTimesheet      = loadTimesheet;
window.generateTimesheet  = generateTimesheet;
window.tsOnPerPage        = tsOnPerPage;
window.tsOnSearch         = tsOnSearch;
window.renderTsPage       = renderTsPage;
window.tsGoPage           = tsGoPage;
window.tsPrevPage         = tsPrevPage;
window.tsNextPage         = tsNextPage;
window.tsCopyTable        = tsCopyTable;
window.tsExportExcel      = tsExportExcel;
window.printTimesheet     = printTimesheet;
window.loadAttendanceRecords = loadAttendanceRecords;

/* ══════════════════════════════════════════════════
   PROFILE PAGE MODULE
   ══════════════════════════════════════════════════ */
EMP_PAGES['emp-profile'] = 'Profile';

function loadProfilePage() {
  const ctx = window.getLegacyAuthContext ? window.getLegacyAuthContext() : null;
  if (!ctx) return;

  const initials = (String(ctx.full_name || '').trim()
    .split(/\s+/).slice(0, 2).map(w => w[0] || '').join('') || 'EM').toUpperCase();

  const setTxt = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val || '—'; };

  setTxt('ep-avatar-circle', initials);
  setTxt('ep-banner-name',   ctx.full_name   || 'Employee Name');
  setTxt('ep-banner-pos',    ctx.position    || ctx.employee_type || '');
  setTxt('ep-role-tag',      ctx.role        || 'Employee');
  setTxt('ep-info-name',     ctx.full_name);
  setTxt('ep-info-id',       ctx.employee_id);
  setTxt('ep-info-cpnumber', ctx.cp_number ? formatDigitGroups(digitsOnly(ctx.cp_number), DIGIT_FIELD_SPECS.cp_number.groups, DIGIT_FIELD_SPECS.cp_number.separator) : '');
  setTxt('ep-info-pos',      ctx.position);
  setTxt('ep-info-type',     ctx.employee_type);
  setTxt('ep-info-email',    ctx.email);
  setTxt('ep-info-address',  ctx.address);
  setTxt('ep-info-role',     ctx.role);
  setTxt('ep-sss-number',         ctx.sss_number);
  setTxt('ep-pagibig-number',     ctx.pagibig_number);
  setTxt('ep-philhealth-number',  ctx.philhealth_number);
  setTxt('ep-bank-name',     ctx.bank_name);
  setTxt('ep-bank-account',  ctx.bank_account_number);
}

document.addEventListener('sacs-auth-context-changed', function _onAuthForProfile() {
  if (document.getElementById('emp-profile')?.classList.contains('active')) {
    loadProfilePage();
  }
});

window.loadProfilePage = loadProfilePage;
