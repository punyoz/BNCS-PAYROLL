/* ═══════════════════════════════════════
   super-admin.js — Super Administrator role logic
   Handles: dashboard, branch management, roles,
   system config, audit monitoring, backup
   ═══════════════════════════════════════ */

'use strict';

/* ── PAGE MAP ── */
const SA_PAGES = {
  'sa-dashboard':    'SA Dashboard',
  'sa-attendance':   'Attendance',
  'sa-branches':     'Branch Management',
  'sa-roles':        'Roles & Permissions',
  'sa-transfer-requests':'Transfer Requests',
  'sa-maintenance':  'System Maintenance',
  'sa-config':       'System Configuration',
  'sa-audit':        'Audit & Monitoring',
  'sa-backup':       'Backup & Recovery',
  'sa-profile':      'Profile',
};

let saAllUsers = [];
let saRoleFilter = 'all';
let saRolesSearch = '';
let saCurrentAdminUser = null;
let saAuditLogs = [];
let saAuditSearch = '';
let saAuditModule = 'all';
let saAuditAction = 'all';
let saBranches = [];
let saAssignBranches = [];
let saTransferPending = [];
let saTransferHistory = [];
let saReportData = [];
let saAttendanceData = null;
let saAttPaginator = null;

let saUsersPaginator = null;
let saAuditPaginator = null;
let saBranchAllEmployees = [];
let saBranchFilter = 'all';
let saBranchSearch = '';
let saBranchPaginator = null;

let saAllRfidDevices = [];
let saRfidDeviceSearch = '';
let saRfidPaginator = null;
let saCurrentEditingRfid = null;

/* ── NAVIGATE ── */
function saNav(pageId, navEl) {
  Object.keys(SA_PAGES).forEach((id) => {
    document.getElementById(id)?.classList.remove('active');
  });
  document.querySelectorAll('#s-super-admin .ni').forEach((el) => el.classList.remove('active'));

  const page = document.getElementById(pageId);
  if (page) page.classList.add('active');
  if (navEl) navEl.classList.add('active');

  const titleEl = document.getElementById('sa-tb-title');
  if (titleEl) titleEl.textContent = SA_PAGES[pageId] || 'Super Admin';

  if (typeof persistRolePageState === 'function') persistRolePageState('super_admin', pageId);

  if (pageId === 'sa-dashboard')       loadSADashboard();
  else if (pageId === 'sa-attendance') loadSAAttendanceData();
  else if (pageId === 'sa-branches')   loadSABranches();
  else if (pageId === 'sa-roles')      loadSAUsers();
  else if (pageId === 'sa-transfer-requests') { loadSABranchAssignment(); loadSATransferRequests(); }
  else if (pageId === 'sa-maintenance') {
    loadSASystemData();
    // Auto-focus the scan field so a HID RFID reader's keystrokes land there
    // immediately without an extra click.
    setTimeout(() => document.getElementById('sa-rfid-input')?.focus(), 0);
  }
  else if (pageId === 'sa-config')     loadSAConfig();
  else if (pageId === 'sa-audit')      loadSAAuditLogs();
  else if (pageId === 'sa-backup')     loadSABackupStatus();
  else if (pageId === 'sa-profile')    loadSAProfile();
}

/* ── IDENTITY ── */
function applySAIdentity() {
  if (typeof getLegacyAuthContext !== 'function') return;
  const ctx = getLegacyAuthContext();
  if (!ctx) return;

  const nameEl = document.getElementById('sa-user-name');
  if (nameEl && ctx.full_name) nameEl.textContent = ctx.full_name;

  const avatar = document.getElementById('sa-avatar');
  if (avatar && ctx.full_name) {
    const parts = ctx.full_name.trim().split(/\s+/);
    avatar.textContent = parts.length >= 2
      ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
      : ctx.full_name.slice(0, 2).toUpperCase();
  }
}

/* ── PROFILE ── */
// Super Admin's own account has no employee record (no position, bank info,
// etc.) — this shows what actually exists (name/email/role) instead of the
// full employee-profile layout Admin/HR/Accountant use, which would just be
// a page full of "—" placeholders for fields a Super Admin account never has.
function loadSAProfile() {
  const ctx = window.getLegacyAuthContext ? window.getLegacyAuthContext() : null;
  if (!ctx) return;

  const initials = (String(ctx.full_name || '').trim()
    .split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('') || 'SA').toUpperCase();

  const setTxt = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val || '—'; };

  setTxt('sa-ep-avatar',    initials);
  setTxt('sa-ep-name',      ctx.full_name || 'Super Administrator');
  setTxt('sa-ep-pos',       'Super Administrator');
  setTxt('sa-ep-role-tag',  'Super Admin');
  setTxt('sa-ep-info-name', ctx.full_name);
  setTxt('sa-ep-info-role', ctx.role);
  setTxt('sa-ep-info-email', ctx.email);
}

/* ── DASHBOARD ── */
async function loadSADashboard() {
  try {
    const [dashRes, sysRes] = await Promise.allSettled([
      fetch('/api/admin/dashboard'),
      fetch('/api/admin/system'),
    ]);

    if (dashRes.status === 'fulfilled' && dashRes.value.ok) {
      const d = await dashRes.value.json();
      const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v ?? '—'; };
      set('sa-dash-employees', d.total_employees ?? d.totalEmployees);
      set('sa-dash-present', d.present_today ?? d.presentToday);
      set('sa-dash-late', d.late_today ?? d.lateToday);
      set('sa-dash-absent', d.absent_today ?? d.absentToday);

      renderSARecentActivity(d.recent_activity || d.recentActivity || []);
    } else {
      renderSARecentActivity([]);
    }

    if (sysRes.status === 'fulfilled' && sysRes.value.ok) {
      const s = await sysRes.value.json();
      const dbStatus = s.database_status || {};
      const stats = s.system_stats || {};
      const totalUsers = stats.total_users || 0;
      const dbOk = dbStatus.connection === 'ok';

      const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
      set('sa-dash-users', totalUsers || '—');

      updateSAHealthRow('sa-health-db', 'sa-health-db-pill', dbOk ? 'Connected' : 'Connection error', dbOk ? 'Online' : 'Error', dbOk ? 'sa-pill-online' : 'sa-pill-offline');
      updateSAHealthRow('sa-health-users-meta', 'sa-health-users-pill', `${totalUsers} registered`, 'OK', 'sa-pill-online');
      updateSAHealthRow('sa-health-att-meta', 'sa-health-att-pill', dbStatus.attendance_logs === 'ok' ? 'Table available' : 'Table missing', dbStatus.attendance_logs === 'ok' ? 'Active' : 'Missing', dbStatus.attendance_logs === 'ok' ? 'sa-pill-online' : 'sa-pill-warning');
      updateSAHealthRow('sa-health-pay-meta', 'sa-health-pay-pill', dbStatus.payroll_records === 'ok' ? 'Table available' : 'Table missing', dbStatus.payroll_records === 'ok' ? 'Active' : 'Missing', dbStatus.payroll_records === 'ok' ? 'sa-pill-online' : 'sa-pill-warning');
    } else {
      updateSAHealthRow('sa-health-db', 'sa-health-db-pill', 'Checking via admin endpoint', 'Pending', 'sa-pill-warning');
      updateSAHealthRow('sa-health-users-meta', 'sa-health-users-pill', 'Could not load', 'Unknown', 'sa-pill-warning');
      updateSAHealthRow('sa-health-att-meta', 'sa-health-att-pill', 'Could not load', 'Unknown', 'sa-pill-warning');
      updateSAHealthRow('sa-health-pay-meta', 'sa-health-pay-pill', 'Could not load', 'Unknown', 'sa-pill-warning');
    }

    const pendingEl = document.getElementById('sa-dash-pending');
    if (pendingEl) pendingEl.textContent = '0';
    const statusEl = document.getElementById('sa-dash-status');
    if (statusEl) statusEl.textContent = 'Online';
  } catch (err) {
    console.error('SA dashboard error:', err);
  }
}

function updateSAHealthRow(metaId, pillId, metaText, pillLabel, pillClass) {
  const meta = document.getElementById(metaId);
  const pill = document.getElementById(pillId);
  if (meta) meta.textContent = metaText;
  if (pill) {
    pill.textContent = pillLabel;
    pill.className = `sa-pill ${pillClass}`;
  }
}

function renderSARecentActivity(activity) {
  const el = document.getElementById('sa-recent-activity');
  if (!el) return;
  if (!Array.isArray(activity) || !activity.length) {
    el.innerHTML = '<div class="ai-item"><div class="ai2"><div class="s" style="color:var(--t3);">No recent system activity.</div></div></div>';
    return;
  }
  el.innerHTML = activity.slice(0, 8).map((row) => {
    const s = String(row.status || row.action || '').toLowerCase();
    const color = s === 'success' || s === 'approve' || s === 'approved'
      ? 'var(--green)'
      : s === 'failed' || s === 'error' || s === 'reject'
        ? 'var(--red)'
        : 'var(--amber)';
    const label = row.status || row.action || '—';
    const desc = row.description || row.employee_name || row.entity_id || '';
    const time = row.timestamp || row.created_at || '';
    const timeStr = time ? new Date(time).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
    return `<div class="ai-item">
      <div class="ai2">
        <div class="s">${row.module ? `[${row.module}] ` : ''}${desc || label}</div>
        ${timeStr ? `<div class="ss">${timeStr}</div>` : ''}
      </div>
      <span class="badge" style="background:${color}20;color:${color};border:1px solid ${color}50;">${label}</span>
    </div>`;
  }).join('');
}

/* ── BRANCH MANAGEMENT ── */
async function loadSABranches() {
  const grid = document.getElementById('sa-branch-grid');
  if (!grid) return;

  try {
    const [branchRes, staffRes] = await Promise.allSettled([
      fetch('/api/admin/branches'),
      fetch('/api/admin/dashboard'),
    ]);

    if (branchRes.status === 'fulfilled' && branchRes.value.ok) {
      const d = await branchRes.value.json();
      saBranches = d.branches || [];
    } else {
      saBranches = [];
    }

    const staffCountEl = document.getElementById('sa-branch-staff');
    if (staffRes.status === 'fulfilled' && staffRes.value.ok) {
      const d = await staffRes.value.json();
      if (staffCountEl) staffCountEl.textContent = d.total_employees ?? d.totalEmployees ?? '—';
    }
  } catch {}

  renderSABranchGrid();
}

function renderSABranchGrid() {
  const grid = document.getElementById('sa-branch-grid');
  if (!grid) return;

  const totalEl = document.getElementById('sa-branch-total');
  const activeEl = document.getElementById('sa-branch-active');
  if (totalEl) totalEl.textContent = saBranches.length;
  if (activeEl) activeEl.textContent = saBranches.filter((b) => b.status === 'Active').length;

  if (!saBranches.length) {
    grid.innerHTML = '<p style="color:var(--t3);grid-column:1/-1;">No branches configured yet.</p>';
    return;
  }

  grid.innerHTML = saBranches.map((b) => {
    const statusColor = b.status === 'Active' ? 'var(--green)' : 'var(--red)';
    return `<div class="branch-card">
      <div class="branch-name">${b.name}</div>
      <div class="branch-meta">${b.location}</div>
      <div class="branch-meta">Code: <code style="font-size:11px;">${b.code || '—'}</code></div>
      <div style="margin-top:4px;"><span class="badge" style="color:${statusColor};background:${statusColor}20;border:1px solid ${statusColor}40;">${b.status}</span></div>
      <div class="branch-actions" style="margin-top:8px;">
        <button class="btn btn-outline" style="font-size:11px;padding:4px 10px;" onclick="openSABranchModal(${JSON.stringify(b).replace(/"/g,'&quot;')})">Edit</button>
      </div>
    </div>`;
  }).join('');
}

function openSABranchModal(branch) {
  const modal = document.getElementById('sa-branch-modal');
  const form = document.getElementById('sa-branch-form');
  const title = document.getElementById('sa-branch-modal-title');
  const fb = document.getElementById('sa-branch-feedback');
  if (!modal || !form) return;

  if (fb) { fb.textContent = ''; fb.className = 'adm-feedback'; }

  if (branch && typeof branch === 'object') {
    if (title) title.textContent = 'Edit Branch';
    form.querySelector('[name="id"]').value = branch.id || '';
    form.querySelector('[name="name"]').value = branch.name || '';
    form.querySelector('[name="code"]').value = branch.code || '';
    const statusEl = form.querySelector('[name="status"]');
    if (statusEl) statusEl.value = branch.status || 'Active';
    populateSABranchLocationSelects(branch.location || '');
  } else {
    if (title) title.textContent = 'Add Branch';
    form.reset();
    form.querySelector('[name="id"]').value = '';
    form.querySelector('[name="code"]').value = 'BR-' + String(saBranches.length + 1).padStart(3, '0');
    const regionEl = document.getElementById('sa-branch-region');
    const provinceEl = document.getElementById('sa-branch-province');
    const cityEl = document.getElementById('sa-branch-city');
    const barangayEl = document.getElementById('sa-branch-barangay');
    if (regionEl) regionEl.value = '';
    if (provinceEl) provinceEl.innerHTML = '<option value="">Select Province / District</option>';
    if (cityEl) cityEl.innerHTML = '<option value="">Select City / Municipality</option>';
    if (barangayEl) barangayEl.innerHTML = '<option value="">Select Barangay</option>';
  }

  modal.style.display = 'flex';
}

function closeSABranchModal() {
  const modal = document.getElementById('sa-branch-modal');
  if (modal) modal.style.display = 'none';
}

function onSABranchRegionChange() {
  const regionEl = document.getElementById('sa-branch-region');
  const provinceEl = document.getElementById('sa-branch-province');
  const cityEl = document.getElementById('sa-branch-city');
  const barangayEl = document.getElementById('sa-branch-barangay');
  if (!regionEl || !provinceEl) return;
  const provinces = SA_PH_PROVINCES[regionEl.value] || [];
  provinceEl.innerHTML = '<option value="">Select Province / District</option>' +
    provinces.map((p) => `<option value="${p}">${p}</option>`).join('');
  if (cityEl) cityEl.innerHTML = '<option value="">Select City / Municipality</option>';
  if (barangayEl) barangayEl.innerHTML = '<option value="">Select Barangay</option>';
}

function onSABranchProvinceChange() {
  const provinceEl = document.getElementById('sa-branch-province');
  const cityEl = document.getElementById('sa-branch-city');
  const barangayEl = document.getElementById('sa-branch-barangay');
  if (!provinceEl || !cityEl) return;
  const cities = SA_PH_CITIES[provinceEl.value] || [];
  cityEl.innerHTML = '<option value="">Select City / Municipality</option>' +
    cities.map((c) => `<option value="${c}">${c}</option>`).join('');
  if (barangayEl) barangayEl.innerHTML = '<option value="">Select Barangay</option>';
}

function onSABranchCityChange() {
  const cityEl = document.getElementById('sa-branch-city');
  const barangayEl = document.getElementById('sa-branch-barangay');
  if (!cityEl || !barangayEl) return;
  const barangays = SA_PH_BARANGAYS[cityEl.value] || [];
  barangayEl.innerHTML = '<option value="">Select Barangay</option>' +
    barangays.map((b) => `<option value="${b}">${b}</option>`).join('');
}

function populateSABranchLocationSelects(locationStr) {
  const regionEl = document.getElementById('sa-branch-region');
  const provinceEl = document.getElementById('sa-branch-province');
  const cityEl = document.getElementById('sa-branch-city');
  const barangayEl = document.getElementById('sa-branch-barangay');
  if (!regionEl) return;

  const parts = locationStr.split(',').map((s) => s.trim()).filter(Boolean);
  const region = SA_PH_REGIONS.find((r) => parts.includes(r)) ||
    SA_PH_REGIONS.find((r) => locationStr.includes(r)) || '';
  regionEl.value = region;
  onSABranchRegionChange();

  if (region && provinceEl) {
    const province = (SA_PH_PROVINCES[region] || []).find((p) => parts.includes(p)) ||
      (SA_PH_PROVINCES[region] || []).find((p) => locationStr.includes(p)) || '';
    provinceEl.value = province;
    onSABranchProvinceChange();

    if (province && cityEl) {
      const city = (SA_PH_CITIES[province] || []).find((c) => parts.includes(c)) ||
        (SA_PH_CITIES[province] || []).find((c) => locationStr.includes(c)) || '';
      cityEl.value = city;
      onSABranchCityChange();

      if (city && barangayEl) {
        const barangays = SA_PH_BARANGAYS[city] || [];
        const barangay = barangays.find((b) => parts.includes(b)) ||
          barangays.find((b) => locationStr.startsWith(b + ',')) || '';
        if (barangay) barangayEl.value = barangay;
      }
    }
  }
}

async function submitSABranch(event) {
  event.preventDefault();
  const form = event.target;
  const fb = document.getElementById('sa-branch-feedback');

  const id = form.querySelector('[name="id"]').value;
  const region = (document.getElementById('sa-branch-region')?.value || '').trim();
  const province = (document.getElementById('sa-branch-province')?.value || '').trim();
  const city = (document.getElementById('sa-branch-city')?.value || '').trim();
  const barangay = (document.getElementById('sa-branch-barangay')?.value || '').trim();
  const location = [barangay, city, province, region].filter(Boolean).join(', ');
  const payload = {
    name: form.querySelector('[name="name"]').value.trim(),
    location,
    code: form.querySelector('[name="code"]').value.trim(),
    status: form.querySelector('[name="status"]').value,
  };

  if (!payload.name || !city) {
    if (fb) { fb.textContent = 'Branch name and city / municipality are required.'; fb.style.color = 'var(--red)'; }
    return;
  }

  if (fb) { fb.textContent = 'Saving...'; fb.style.color = 'var(--t3)'; }

  try {
    const res = await fetch('/api/admin/branches', {
      method: id ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(id ? { id, ...payload } : payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to save branch.');

    if (id) {
      const idx = saBranches.findIndex((b) => b.id === id);
      if (idx !== -1) saBranches[idx] = data.branch || { id, ...payload };
    } else {
      saBranches.push(data.branch || { id: `branch-${Date.now()}`, ...payload });
    }

    if (fb) { fb.textContent = 'Branch saved.'; fb.style.color = 'var(--green)'; }
    setTimeout(() => {
      closeSABranchModal();
      renderSABranchGrid();
    }, 600);
  } catch (err) {
    if (fb) { fb.textContent = err.message; fb.style.color = 'var(--red)'; }
  }
}

/* ── ROLES & PERMISSIONS ── */
async function loadSAUsers() {
  const tbody = document.getElementById('sa-users-table-body');
  if (tbody) tbody.innerHTML = skeletonRows(11);

  try {
    const [usersRes, branches] = await Promise.allSettled([
      fetch('/api/admin/users'),
      fetchBranchesCached({ activeOnly: false }),
    ]);

    if (usersRes.status !== 'fulfilled' || !usersRes.value.ok) {
      const errData = usersRes.status === 'fulfilled' ? await usersRes.value.json().catch(() => ({})) : {};
      throw new Error(errData.error || 'Failed to load users.');
    }
    const data = await usersRes.value.json();
    saAllUsers = data.users || [];

    if (branches.status === 'fulfilled') {
      saBranches = branches.value;
    }

    updateSARoleChips();
    renderSAUsersTable();
  } catch (err) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="11" style="color:var(--red);">${err.message}</td></tr>`;
  }
}

function updateSARoleChips() {
  const chips = document.querySelectorAll('#sa-role-filter-chips .chip');
  const roles = ['all', 'super_admin', 'admin', 'hr', 'accountant', 'employee', 'archived'];
  const counts = {
    all: saAllUsers.length,
    super_admin: saAllUsers.filter((u) => u.role === 'super_admin' && !u.archived).length,
    admin: saAllUsers.filter((u) => u.role === 'admin' && !u.archived).length,
    hr: saAllUsers.filter((u) => u.role === 'hr' && !u.archived).length,
    accountant: saAllUsers.filter((u) => u.role === 'accountant' && !u.archived).length,
    employee: saAllUsers.filter((u) => u.role === 'employee' && !u.archived).length,
    archived: saAllUsers.filter((u) => u.archived).length,
  };

  const active = saAllUsers.filter((u) => !u.archived).length;
  const archived = saAllUsers.filter((u) => u.archived).length;

  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('sa-role-total', saAllUsers.length);
  set('sa-role-active', active);
  set('sa-role-archived', archived);

  const labels = ['All', 'Super Admin', 'Admin', 'HR', 'Accountant', 'Employee', 'Archived'];
  chips.forEach((chip, i) => {
    const key = roles[i];
    if (key !== undefined) chip.textContent = `${labels[i]} (${counts[key] ?? 0})`;
  });
}

function setSARoleFilter(filter) {
  saRoleFilter = filter;
  document.querySelectorAll('#sa-role-filter-chips .chip').forEach((c) => {
    c.classList.toggle('active', c.dataset.rf === filter);
  });
  renderSAUsersTable();
}

function setSARolesSearch(val) {
  saRolesSearch = String(val || '').toLowerCase().trim();
  renderSAUsersTable();
}

function renderSAUsersTable() {
  const tbody = document.getElementById('sa-users-table-body');
  if (!tbody) return;

  let list = saAllUsers;

  if (saRoleFilter === 'archived') {
    list = list.filter((u) => u.archived);
  } else if (saRoleFilter !== 'all') {
    list = list.filter((u) => u.role === saRoleFilter && !u.archived);
  } else {
    list = list.filter((u) => !u.archived);
  }

  if (saRolesSearch) {
    list = list.filter((u) =>
      [u.full_name, u.email, u.role, u.employee_id].some((v) =>
        String(v || '').toLowerCase().includes(saRolesSearch)
      )
    );
  }

  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="11" style="color:var(--t3);">No users found.</td></tr>';
    return;
  }

  const roleColors = {
    super_admin: 'var(--blue)',
    admin: 'var(--amber)',
    hr: 'var(--teal)',
    accountant: 'var(--green)',
    employee: 'var(--t2)',
  };

  if (!saUsersPaginator) {
    saUsersPaginator = createPaginator({
      id: 'sa-users',
      pageSize: 15,
      renderFn: (rows) => {
        tbody.innerHTML = rows.map((u) => {
          const roleColor = roleColors[u.role] || 'var(--t2)';
          const roleLabel = u.role === 'super_admin' ? 'Super Admin' : (u.role || '—');
          const statusColor = u.archived ? 'var(--red)' : u.employee_status?.toLowerCase() === 'active' ? 'var(--green)' : 'var(--amber)';
          const statusLabel = u.archived ? 'Archived' : (u.employee_status || 'Active');
          const lastLogin = u.last_sign_in_at
            ? new Date(u.last_sign_in_at).toLocaleDateString('en-PH')
            : '—';
          const branch = saBranches.find((b) => String(b.id) === String(u.branch_id));
          const branchLabel = u.branch_id ? (branch?.name || 'Unknown') : '—';
          const cpNumberLabel = u.cp_number || '—';
          const dateHiredLabel = u.date_hired || '—';
          const actionsCell = `
            <button class="btn btn-outline" style="font-size:11px;padding:4px 10px;" onclick="openSAViewEmployeeModal(${JSON.stringify(u).replace(/"/g, '&quot;')})">View</button>
            <button class="btn btn-outline" style="font-size:11px;padding:4px 10px;" onclick="openSAAdminUserModal(${JSON.stringify(u).replace(/"/g, '&quot;')})">Edit</button>
          `;
          return `<tr>
            <td>${u.full_name || '—'}</td>
            <td style="font-size:12px;color:var(--t3);">${u.email || '—'}</td>
            <td><span class="badge" style="color:${roleColor};background:${roleColor}20;border:1px solid ${roleColor}40;">${roleLabel}</span></td>
            <td style="font-size:12px;">${branchLabel}</td>
            <td><code style="font-size:11px;">${u.employee_id || '—'}</code></td>
            <td>${u.employee_type || '—'}</td>
            <td style="font-size:12px;">${cpNumberLabel}</td>
            <td style="font-size:12px;">${dateHiredLabel}</td>
            <td><span class="badge" style="color:${statusColor};background:${statusColor}20;border:1px solid ${statusColor}40;">${statusLabel}</span></td>
            <td style="font-size:12px;">${lastLogin}</td>
            <td>${actionsCell}</td>
          </tr>`;
        }).join('');
      },
    });
  }

  saUsersPaginator.setData(list);
}

/* ── ADMIN USER MANAGEMENT ── */
// Read-only: Super Admin's own account editor (below) only ever covered
// account fields (name/email/role/branch/password) — it was never extended
// to the full HR record, so this is the one place Super Admin can actually
// see what Admin/HR entered (contact, government IDs, bank details).
function openSAViewEmployeeModal(user) {
  const modal = document.getElementById('sa-view-employee-modal');
  if (!modal) return;

  const set = (id, value, groups) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = value ? (groups ? formatDigitGroups(digitsOnly(value), groups) : value) : '—';
  };

  const titleEl = document.getElementById('sa-view-employee-title');
  if (titleEl) titleEl.textContent = `${user.full_name || 'Employee'} — Details`;

  set('sa-view-cp-number', user.cp_number);
  set('sa-view-date-hired', user.date_hired);
  set('sa-view-address', user.address);
  set('sa-view-sss', user.sss_number, DIGIT_FIELD_SPECS.sss_number.groups);
  set('sa-view-pagibig', user.pagibig_number, DIGIT_FIELD_SPECS.pagibig_number.groups);
  set('sa-view-philhealth', user.philhealth_number, DIGIT_FIELD_SPECS.philhealth_number.groups);
  set('sa-view-bank-name', user.bank_name);
  set('sa-view-bank-account', user.bank_account_number);

  modal.style.display = 'flex';
}

function closeSAViewEmployeeModal() {
  const modal = document.getElementById('sa-view-employee-modal');
  if (modal) modal.style.display = 'none';
}

async function openSAAdminUserModal(user) {
  const modal = document.getElementById('sa-admin-user-modal');
  const form = document.getElementById('sa-admin-user-form');
  const title = document.getElementById('sa-admin-user-modal-title');
  const archiveBtn = document.getElementById('sa-admin-user-archive-btn');
  const pwField = document.getElementById('sa-admin-user-password-field');
  const fb = document.getElementById('sa-admin-user-feedback');
  if (!modal || !form) return;

  saCurrentAdminUser = user && typeof user === 'object' ? user : null;
  if (fb) { fb.textContent = ''; fb.className = 'adm-feedback'; }
  form.reset();

  try {
    const res = await fetch('/api/admin/branches');
    if (res.ok) {
      const data = await res.json();
      saBranches = data.branches || saBranches;
    }
  } catch {}

  const branchSelect = document.getElementById('sa-admin-user-branch');
  if (branchSelect) {
    branchSelect.innerHTML = '<option value="">No Branch</option>' +
      saBranches.map((b) => `<option value="${escapeHtml(b.id)}">${escapeHtml(b.name)}</option>`).join('');
  }

  // Add is scoped to minting new Admin / Super Admin accounts (the
  // Employee/HR/Accountant path needs the fuller employee-profile form on
  // /api/admin/employees). Editing an existing account of any role, though,
  // has to offer that account's own role or the <select> can't represent it.
  const roleSelect = document.getElementById('sa-admin-user-role');
  const roleOptions = saCurrentAdminUser
    ? [
        ['employee', 'Employee'],
        ['accountant', 'Accountant'],
        ['hr', 'HR'],
        ['admin', 'Admin'],
        ['super_admin', 'Super Admin'],
      ]
    : [
        ['admin', 'Admin'],
        ['super_admin', 'Super Admin'],
      ];
  if (roleSelect) {
    roleSelect.innerHTML = roleOptions.map(([value, label]) => `<option value="${value}">${label}</option>`).join('');
  }

  if (saCurrentAdminUser) {
    if (title) title.textContent = 'Edit User';
    form.querySelector('[name="id"]').value = saCurrentAdminUser.id;
    form.querySelector('[name="full_name"]').value = saCurrentAdminUser.full_name || '';
    form.querySelector('[name="email"]').value = saCurrentAdminUser.email || '';
    form.querySelector('[name="role"]').value = saCurrentAdminUser.role || 'employee';
    if (branchSelect) branchSelect.value = saCurrentAdminUser.branch_id || '';
    if (pwField) {
      const label = pwField.querySelector('label');
      if (label) label.textContent = 'New Password (Optional)';
      const input = pwField.querySelector('input');
      if (input) input.placeholder = 'Leave blank to keep current';
    }
    if (archiveBtn) {
      archiveBtn.style.display = '';
      archiveBtn.className = saCurrentAdminUser.archived ? 'btn btn-green' : 'btn btn-red';
      archiveBtn.textContent = saCurrentAdminUser.archived ? 'Restore User' : 'Archive User';
    }
  } else {
    if (title) title.textContent = 'Add Admin User';
    form.querySelector('[name="id"]').value = '';
    form.querySelector('[name="role"]').value = 'admin';
    if (branchSelect) branchSelect.value = '';
    if (pwField) {
      const label = pwField.querySelector('label');
      if (label) label.textContent = 'Password';
      const input = pwField.querySelector('input');
      if (input) input.placeholder = 'Minimum 6 characters';
    }
    if (archiveBtn) archiveBtn.style.display = 'none';
  }

  modal.style.display = 'flex';
}

function closeSAAdminUserModal() {
  const modal = document.getElementById('sa-admin-user-modal');
  if (modal) modal.style.display = 'none';
  saCurrentAdminUser = null;
}

async function submitSAAdminUser(event) {
  event.preventDefault();
  const form = event.target;
  const submitBtn = form.querySelector('button[type="submit"]');
  const fb = document.getElementById('sa-admin-user-feedback');
  const formData = new FormData(form);

  const id = String(formData.get('id') || '').trim();
  const fullName = String(formData.get('full_name') || '').trim();
  const email = String(formData.get('email') || '').trim();
  const role = String(formData.get('role') || 'admin').trim();
  const branchId = String(formData.get('branch_id') || '').trim();
  const password = String(formData.get('password') || '').trim();

  if (!fullName || !email) {
    if (fb) { fb.textContent = 'Full name and email are required.'; fb.className = 'adm-feedback err'; }
    return;
  }
  if (!id && (!password || password.length < 6)) {
    if (fb) { fb.textContent = 'Password must be at least 6 characters.'; fb.className = 'adm-feedback err'; }
    return;
  }
  if (id && password && password.length < 6) {
    if (fb) { fb.textContent = 'Password must be at least 6 characters.'; fb.className = 'adm-feedback err'; }
    return;
  }

  try {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Saving...';

    let response;
    if (id) {
      const payload = { id, action: 'update', full_name: fullName, email, role };
      if (password) payload.password = password;
      response = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } else {
      response = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ full_name: fullName, email, role, password, branch_id: branchId || null }),
      });
    }

    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Failed to save user.');

    const userId = id || result.user?.id;
    const priorBranchId = String(saCurrentAdminUser?.branch_id || '');

    // Creation already pins the branch via branch_id on POST /api/admin/users.
    // Editing has to move it through branch-employees separately, since PATCH
    // .../users only updates name/email/role/password — and that's also what
    // keeps profiles.branch_id (what RLS and sessions read) in sync.
    if (id && branchId !== priorBranchId) {
      const ctx = typeof getLegacyAuthContext === 'function' ? getLegacyAuthContext() : null;
      const assignedBy = String(ctx?.full_name || ctx?.email || 'super_admin').trim();
      if (branchId) {
        await fetch('/api/admin/branch-employees', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user_id: userId, branch_id: branchId, assigned_by: assignedBy }),
        });
      } else {
        await fetch('/api/admin/branch-employees', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user_id: userId }),
        });
      }
    }

    if (fb) { fb.textContent = id ? 'User updated.' : 'Admin user created.'; fb.className = 'adm-feedback ok'; }
    window.pushNotification?.(
      id ? 'User Updated' : 'Admin Created',
      id ? `${fullName}'s account was updated.` : `New admin account created for ${fullName}.`,
      'success',
    );
    await loadSAUsers();
    setTimeout(() => closeSAAdminUserModal(), 500);
  } catch (error) {
    if (fb) { fb.textContent = error.message; fb.className = 'adm-feedback err'; }
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Save';
  }
}

async function toggleArchiveSAAdminUser() {
  if (!saCurrentAdminUser) return;
  const archiveBtn = document.getElementById('sa-admin-user-archive-btn');
  const fb = document.getElementById('sa-admin-user-feedback');
  if (!archiveBtn) return;

  const action = saCurrentAdminUser.archived ? 'restore' : 'archive';
  const prompt = action === 'archive' ? 'archive this user account' : 'restore this user account';
  const detail = action === 'archive'
    ? 'Archived users cannot log in and will be hidden from active lists.'
    : 'This user account will be restored to active status.';

  const confirmFn = action === 'restore'
    ? (window.confirmApproveAction
        && ((p, d) => window.confirmApproveAction(p, d, { title: 'Confirm Restore', confirmLabel: 'Restore' })))
    : window.confirmDestructiveAction;

  if (confirmFn && !(await confirmFn(prompt, detail))) return;

  try {
    archiveBtn.disabled = true;
    archiveBtn.textContent = action === 'archive' ? 'Archiving...' : 'Restoring...';

    const response = await fetch('/api/admin/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: saCurrentAdminUser.id, action }),
    });

    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Failed to update user.');

    if (fb) { fb.textContent = action === 'archive' ? 'User archived.' : 'User restored.'; fb.className = 'adm-feedback ok'; }
    window.pushNotification?.(
      action === 'archive' ? 'User Archived' : 'User Restored',
      action === 'archive' ? 'The account has been archived.' : 'The account has been restored.',
      'info',
    );
    await loadSAUsers();
    closeSAAdminUserModal();
  } catch (error) {
    if (fb) { fb.textContent = error.message; fb.className = 'adm-feedback err'; }
  } finally {
    archiveBtn.disabled = false;
    archiveBtn.textContent = saCurrentAdminUser?.archived ? 'Restore User' : 'Archive User';
  }
}

/* ── SYSTEM CONFIGURATION ── */
async function loadSAConfig() {
  try {
    const res = await fetch('/api/admin/config');
    if (!res.ok) return;
    const d = await res.json();
    const cfg = d.config || {};

    const set = (id, v) => { const el = document.getElementById(id); if (el && v !== undefined && v !== null) el.value = v; };

    const g = cfg.general || {};
    set('cfg-org-name', g.org_name);
    set('cfg-timezone', g.timezone);
    set('cfg-date-format', g.date_format);
    set('cfg-currency', g.currency);

    const a = cfg.attendance || {};
    set('cfg-work-start', a.work_start);
    set('cfg-work-end', a.work_end);
    set('cfg-grace', a.grace);
    set('cfg-work-hours', a.work_hours);

    const p = cfg.payroll || {};
    set('cfg-pay-freq', p.pay_freq);
    set('cfg-sss', p.sss);
    set('cfg-philhealth', p.philhealth);
    set('cfg-pagibig', p.pagibig);

    const s = cfg.security || {};
    set('cfg-session', s.session);
    set('cfg-login-attempts', s.login_attempts);
    set('cfg-pw-min', s.pw_min);
    set('cfg-pw-expiry', s.pw_expiry);
  } catch {}
}

async function saveSAConfig(section) {
  const fb = document.getElementById('sa-config-feedback');

  const fieldMap = {
    general:    { org_name: 'cfg-org-name', timezone: 'cfg-timezone', date_format: 'cfg-date-format', currency: 'cfg-currency' },
    attendance: { work_start: 'cfg-work-start', work_end: 'cfg-work-end', grace: 'cfg-grace', work_hours: 'cfg-work-hours' },
    payroll:    { pay_freq: 'cfg-pay-freq', sss: 'cfg-sss', philhealth: 'cfg-philhealth', pagibig: 'cfg-pagibig' },
    security:   { session: 'cfg-session', login_attempts: 'cfg-login-attempts', pw_min: 'cfg-pw-min', pw_expiry: 'cfg-pw-expiry' },
  };

  const fields = fieldMap[section] || {};
  const values = {};
  Object.entries(fields).forEach(([key, id]) => {
    const el = document.getElementById(id);
    if (el) values[key] = el.value;
  });

  if (fb) { fb.textContent = 'Saving...'; fb.style.color = 'var(--t3)'; }

  try {
    const res = await fetch('/api/admin/config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ section, fields: values }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to save configuration.');

    if (fb) {
      fb.textContent = `${section.charAt(0).toUpperCase() + section.slice(1)} settings saved.`;
      fb.style.color = 'var(--green)';
      setTimeout(() => { if (fb) fb.textContent = ''; }, 3500);
    }
    if (typeof pushNotification === 'function') pushNotification('Configuration Saved', `${section} settings updated.`, 'success');
  } catch (err) {
    if (fb) { fb.textContent = err.message; fb.style.color = 'var(--red)'; }
  }
}

/* ── ATTENDANCE MONITORING ── */
function renderSAAttendancePanels(payload = {}) {
  const panels = payload?.panels || {};
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = String(v || 0); };

  set('sa-att-present', panels.present_today);
  set('sa-att-late', panels.late_today);
  set('sa-att-absent', panels.absent_today);

  const titleEl = document.getElementById('sa-attendance-title');
  if (titleEl) titleEl.textContent = `Attendance Log — ${payload?.date_label || 'Today'}`;
}

function renderSAAttendanceTable(rows = []) {
  const tbody = document.getElementById('sa-attendance-table-body');
  if (!tbody) return;

  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="color:var(--t3);">No attendance records found for today.</td></tr>';
    return;
  }

  tbody.innerHTML = rows.map((row) => {
    const type = String(row.employee_type || 'Teaching');
    const typeBadgeClass = type === 'Non-Teaching' ? 'ba' : 'bt2';

    const status = String(row.status || 'Absent');
    const normalized = status.toLowerCase();
    const statusClass = normalized === 'late' ? 'ba' : (normalized === 'present' ? 'bg' : 'br');

    return `
      <tr>
        <td class="nm">${escapeHtml(row.employee_name || 'Unknown Employee')}</td>
        <td><span class="badge ${typeBadgeClass}">${escapeHtml(type)}</span></td>
        <td class="mn">${formatTimeOnly(row.time_in)}</td>
        <td class="mn">${formatTimeOnly(row.time_out)}</td>
        <td class="mn">${formatHours(row.total_hours)}</td>
        <td><span class="badge ${statusClass}"><span class="bd"></span>${escapeHtml(status)}</span></td>
      </tr>
    `;
  }).join('');
}

async function loadSAAttendanceData() {
  const tbody = document.getElementById('sa-attendance-table-body');
  if (tbody) tbody.innerHTML = skeletonRows(6);

  try {
    const res = await fetch('/api/admin/attendance');
    const payload = await res.json();
    if (!res.ok) throw new Error(payload.error || 'Failed to load attendance data.');

    saAttendanceData = payload;
    renderSAAttendancePanels(payload);

    if (!saAttPaginator) {
      saAttPaginator = createPaginator({ id: 'sa-att', pageSize: 15, renderFn: renderSAAttendanceTable });
    }
    saAttPaginator.setData(payload.attendance_logs || []);
  } catch (err) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="6" style="color:var(--red);">${escapeHtml(err.message)}</td></tr>`;
  }
}

function exportSAAttendanceCsv() {
  const rows = saAttendanceData?.attendance_logs || [];
  if (!rows.length) { alert('No attendance data available to export.'); return; }

  const headers = ['Employee', 'Type', 'Time In', 'Time Out', 'Hours', 'Status'];
  const body = rows.map((row) => [
    row.employee_name || '',
    row.employee_type || '',
    formatTimeOnly(row.time_in),
    formatTimeOnly(row.time_out),
    formatHours(row.total_hours),
    row.status || '',
  ]);

  const dateKey = String(saAttendanceData?.date_key || 'today').replaceAll('/', '-');
  saDownloadCsv([headers, ...body], `sacs-attendance-${dateKey}.csv`);
}

/* ── AUDIT & MONITORING ── */
async function loadSAAuditLogs() {
  const tbody = document.getElementById('sa-audit-table-body');
  if (tbody) tbody.innerHTML = skeletonRows(7);

  try {
    let url = '/api/admin/audit-logs?limit=200';
    if (saAuditModule !== 'all') url += `&module=${saAuditModule}`;
    if (saAuditAction !== 'all') url += `&action=${saAuditAction}`;
    if (saAuditSearch) url += `&search=${encodeURIComponent(saAuditSearch)}`;

    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load audit logs.');

    saAuditLogs = data.logs || [];
    const summary = data.summary || {};

    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('sa-audit-total', summary.total ?? saAuditLogs.length);
    set('sa-audit-success', summary.success ?? saAuditLogs.filter((l) => l.status === 'success').length);
    set('sa-audit-failed', summary.failed ?? saAuditLogs.filter((l) => l.status === 'failed').length);

    renderSAAuditTable(saAuditLogs);
  } catch (err) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="7" style="color:var(--red);">${err.message}</td></tr>`;
  }
}

function setSAAuditSearch(val) {
  saAuditSearch = val;
  loadSAAuditLogs();
}

function setSAAuditModuleFilter(val) {
  saAuditModule = val;
  loadSAAuditLogs();
}

function setSAAuditActionFilter(val) {
  saAuditAction = val;
  loadSAAuditLogs();
}

function renderSAAuditTable(logs) {
  const tbody = document.getElementById('sa-audit-table-body');
  if (!tbody) return;

  if (!logs.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="color:var(--t3);">No audit logs found.</td></tr>';
    return;
  }

  if (!saAuditPaginator) {
    saAuditPaginator = createPaginator({
      id: 'sa-audit',
      pageSize: 20,
      renderFn: (rows) => {
        tbody.innerHTML = rows.map((log) => {
          const s = String(log.status || '').toLowerCase();
          const color = s === 'success' ? 'var(--green)' : s === 'failed' ? 'var(--red)' : 'var(--amber)';
          const ts = log.timestamp || log.created_at
            ? new Date(log.timestamp || log.created_at).toLocaleString('en-PH')
            : '—';
          return `<tr>
            <td style="font-size:11px;color:var(--t3);">${ts}</td>
            <td>${log.module || '—'}</td>
            <td>${log.action || '—'}</td>
            <td style="font-size:12px;">${log.entity_type ? `${log.entity_type}${log.entity_id ? ': ' + log.entity_id : ''}` : '—'}</td>
            <td style="font-size:12px;max-width:200px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${log.description || '—'}</td>
            <td><span class="badge" style="color:${color};background:${color}20;border:1px solid ${color}40;">${log.status || '—'}</span></td>
            <td style="font-size:11px;color:var(--t3);">${log.source || '—'}</td>
          </tr>`;
        }).join('');
      },
    });
  }

  saAuditPaginator.setData(logs);
}

function exportSAAuditCsv() {
  if (!saAuditLogs.length) { alert('No audit data to export. Load logs first.'); return; }
  const headers = ['Timestamp', 'Module', 'Action', 'Entity Type', 'Entity ID', 'Description', 'Status', 'Source'];
  const rows = saAuditLogs.map((l) => [
    l.timestamp || l.created_at || '',
    l.module || '',
    l.action || '',
    l.entity_type || '',
    l.entity_id || '',
    l.description || '',
    l.status || '',
    l.source || '',
  ]);
  saDownloadCsv([headers, ...rows], `sacs-sa-audit-${new Date().toISOString().slice(0, 10)}.csv`);
}

/* ── BACKUP & RECOVERY ── */
async function loadSABackupStatus() {
  const now = new Date().toLocaleString('en-PH');
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };

  try {
    const res = await fetch('/api/admin/system');
    if (res.ok) {
      const d = await res.json();
      const dbStatus = d.database_status || {};
      const stats = d.system_stats || {};
      const dbOk = dbStatus.connection === 'ok';

      set('sa-backup-last', now);
      set('sa-backup-db-status', dbOk ? 'Connected' : 'Error');
      set('sa-backup-integrity', dbOk ? 'Healthy' : 'Unknown');

      updateSABackupPill('sa-bk-db-meta', 'sa-bk-db-pill', dbOk ? 'Connection verified' : 'Connection error', dbOk ? 'Online' : 'Error', dbOk ? 'sa-pill-online' : 'sa-pill-offline');
      updateSABackupPill('sa-bk-att-meta', 'sa-bk-att-pill', dbStatus.attendance_logs === 'ok' ? 'Table available' : 'Table missing', dbStatus.attendance_logs === 'ok' ? 'Active' : 'Missing', dbStatus.attendance_logs === 'ok' ? 'sa-pill-online' : 'sa-pill-warning');
      updateSABackupPill('sa-bk-pay-meta', 'sa-bk-pay-pill', dbStatus.payroll_records === 'ok' ? 'Table available' : 'Table missing', dbStatus.payroll_records === 'ok' ? 'Active' : 'Missing', dbStatus.payroll_records === 'ok' ? 'sa-pill-online' : 'sa-pill-warning');
      updateSABackupPill('sa-bk-prof-meta', 'sa-bk-prof-pill', `${stats.total_users ?? '—'} accounts`, 'Active', 'sa-pill-online');
      updateSABackupPill('sa-bk-leave-meta', 'sa-bk-leave-pill', dbStatus.system_config === 'ok' ? 'Table available' : 'Table missing', dbStatus.system_config === 'ok' ? 'Active' : 'Missing', dbStatus.system_config === 'ok' ? 'sa-pill-online' : 'sa-pill-warning');
    } else {
      set('sa-backup-db-status', 'Error');
      set('sa-backup-integrity', 'Unknown');
      updateSABackupPill('sa-bk-db-meta', 'sa-bk-db-pill', 'Could not reach system endpoint', 'Error', 'sa-pill-offline');
    }
  } catch (err) {
    set('sa-backup-db-status', 'Offline');
    updateSABackupPill('sa-bk-db-meta', 'sa-bk-db-pill', err.message, 'Error', 'sa-pill-offline');
  }
}

function updateSABackupPill(metaId, pillId, metaText, pillLabel, pillClass) {
  const meta = document.getElementById(metaId);
  const pill = document.getElementById(pillId);
  if (meta) meta.textContent = metaText;
  if (pill) { pill.textContent = pillLabel; pill.className = `sa-pill ${pillClass}`; }
}

async function exportSAData(type) {
  const fb = document.getElementById('sa-backup-feedback');
  if (fb) { fb.textContent = `Preparing ${type} export...`; fb.style.color = 'var(--t3)'; }

  try {
    let url = '';
    let filename = '';
    let headers = [];

    if (type === 'employees') {
      url = '/api/hr/employees?archived=true';
      filename = `sacs-employees-${new Date().toISOString().slice(0, 10)}.csv`;
    } else if (type === 'attendance') {
      url = '/api/hr/attendance?view=all';
      filename = `sacs-attendance-${new Date().toISOString().slice(0, 10)}.csv`;
    } else if (type === 'payroll') {
      if (fb) { fb.textContent = 'Payroll export requires accountant portal access.'; fb.style.color = 'var(--amber)'; }
      return;
    } else if (type === 'audit') {
      url = '/api/admin/audit-logs?limit=1000';
      filename = `sacs-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    }

    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Export failed.');

    let rows = [];
    if (type === 'employees') {
      const emps = data.employees || [];
      headers = ['Full Name', 'Employee ID', 'Role', 'Type', 'Position', 'Status', 'Email', 'Date of Birth'];
      rows = emps.map((e) => [e.full_name || '', e.employee_id || '', e.role || '', e.employee_type || '', e.position || '', e.employee_status || '', e.email || '', e.date_of_birth || '']);
    } else if (type === 'attendance') {
      const logs = data.logs || [];
      headers = ['Employee', 'Type', 'Date', 'Time In', 'Time Out', 'Hours', 'Status'];
      rows = logs.map((l) => [l.employee_name || '', l.employee_type || '', l.date || '', l.time_in || '', l.time_out || '', l.hours_worked || '', l.status || '']);
    } else if (type === 'audit') {
      const logs = data.logs || [];
      headers = ['Timestamp', 'Module', 'Action', 'Entity Type', 'Entity ID', 'Description', 'Status', 'Source'];
      rows = logs.map((l) => [l.timestamp || l.created_at || '', l.module || '', l.action || '', l.entity_type || '', l.entity_id || '', l.description || '', l.status || '', l.source || '']);
    }

    saDownloadCsv([headers, ...rows], filename);
    if (fb) { fb.textContent = `${type} export downloaded successfully.`; fb.style.color = 'var(--green)'; }
    setTimeout(() => { if (fb) fb.textContent = ''; }, 3000);
  } catch (err) {
    if (fb) { fb.textContent = err.message; fb.style.color = 'var(--red)'; }
  }
}

/* ── CSV HELPER ── */
function saDownloadCsv(rows, filename) {
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
async function submitSAChangePassword() {
  const current = document.getElementById('sa-current-password')?.value?.trim();
  const next = document.getElementById('sa-new-password')?.value?.trim();
  const confirm = document.getElementById('sa-confirm-password')?.value?.trim();
  const fb = document.getElementById('sa-change-password-feedback');

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

    const verifyRes = await fetch('/api/legacy-auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employeeId: email, password: current }),
    });
    if (!verifyRes.ok) throw new Error('Current password is incorrect.');

    if (fb) { fb.textContent = 'Password updated successfully.'; fb.style.color = 'var(--green)'; }
    setTimeout(() => closeSettingsModal('sa'), 1500);
  } catch (err) {
    if (fb) { fb.textContent = err.message; fb.style.color = 'var(--red)'; }
  }
}

/* ── INIT ── */
function initSAPortal() {
  applySAIdentity();

  const savedPage = typeof getPersistedRolePageState === 'function'
    ? getPersistedRolePageState('super_admin')
    : '';

  if (savedPage && document.getElementById(savedPage)) {
    const navEl = document.querySelector(`#s-super-admin .ni[onclick*="${savedPage}"]`);
    saNav(savedPage, navEl);
  } else {
    loadSADashboard();
  }

  const sidebar = document.querySelector('#s-super-admin .sidebar');
  if (typeof attachSidebarSpotlight === 'function') attachSidebarSpotlight(sidebar);

  attachSARfidScannerInput();
}

window.addEventListener('sacs-auth-context-changed', (event) => {
  const ctx = event?.detail;
  if (ctx?.role === 'super_admin') applySAIdentity();
});

/* ═══════════════════════════════════════
   TRANSFER REQUESTS (Super Admin: review + decide)
   ═══════════════════════════════════════ */

async function loadSATransferRequests() {
  const listEl = document.getElementById('sa-transfer-pending');
  if (listEl) listEl.innerHTML = skeletonCards(3);

  try {
    saBranches = await fetchBranchesCached({ activeOnly: false }).catch(() => saBranches);

    const response = await fetch('/api/admin/transfer-requests');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Failed to load transfer requests.');

    saTransferPending = data.pending_requests || [];
    saTransferHistory = data.history_requests || [];

    renderSATransferPending();
    renderSATransferHistory();
  } catch (error) {
    if (listEl) listEl.innerHTML = `<div class="approval-card"><div class="approval-card-body"><div class="approval-card-meta" style="color:var(--red);">${escapeHtml(error.message)}</div></div></div>`;
  }
}

function saBranchName(branchId) {
  return saBranches.find((b) => b.id === branchId)?.name || branchId || '—';
}

function renderSATransferPending() {
  const el = document.getElementById('sa-transfer-pending');
  if (!el) return;

  if (!saTransferPending.length) {
    el.innerHTML = '<div class="approval-card"><div class="approval-card-body"><div class="approval-card-meta" style="color:var(--t3);">No pending transfer requests.</div></div></div>';
    return;
  }

  el.innerHTML = saTransferPending.map((req) => `
    <div class="approval-card">
      <div class="approval-card-body">
        <div class="approval-card-name">${escapeHtml(req.employee_name || req.employee_id || 'Unknown')}</div>
        <div class="approval-card-meta">
          <strong>${escapeHtml(saBranchName(req.from_branch_id))}</strong> &rarr; <strong>${escapeHtml(saBranchName(req.to_branch_id))}</strong>
        </div>
        ${req.remarks ? `<div class="approval-card-meta" style="margin-top:4px;">${escapeHtml(req.remarks)}</div>` : ''}
      </div>
      <div class="approval-card-actions">
        <button class="btn btn-primary" style="background:var(--green);border-color:var(--green);" onclick="saTransferAction('${req.id}','approve')">Approve</button>
        <button class="btn btn-red" onclick="saTransferAction('${req.id}','reject')">Reject</button>
      </div>
    </div>
  `).join('');
}

async function saTransferAction(id, action) {
  const confirmed = action === 'approve'
    ? await confirmApproveAction('approve this transfer request', 'The employee will be moved to the destination branch immediately.')
    : await confirmDestructiveAction('reject this transfer request', 'This decision cannot be undone.');
  if (!confirmed) return;

  try {
    const res = await fetch('/api/admin/transfer-requests', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, action }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Action failed.');

    pushNotification(
      `Transfer ${action === 'approve' ? 'Approved' : 'Rejected'}`,
      `Transfer request has been ${action === 'approve' ? 'approved' : 'rejected'}.`,
      action === 'approve' ? 'success' : 'info',
    );
    loadSATransferRequests();
  } catch (err) {
    pushNotification('Error', err.message, 'error');
  }
}

function renderSATransferHistory() {
  const tbody = document.getElementById('sa-transfer-history-body');
  if (!tbody) return;

  if (!saTransferHistory.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="color:var(--t3);">No transfer history yet.</td></tr>';
    return;
  }

  tbody.innerHTML = saTransferHistory.map((req) => `
    <tr>
      <td>${escapeHtml(req.employee_name || req.employee_id || 'Unknown')}</td>
      <td>${escapeHtml(saBranchName(req.from_branch_id))}</td>
      <td>${escapeHtml(saBranchName(req.to_branch_id))}</td>
      <td>${req.status === 'approved' ? '<span class="badge bg"><span class="bd"></span>Approved</span>' : '<span class="badge br"><span class="bd"></span>Rejected</span>'}</td>
      <td>${escapeHtml(req.remarks || '—')}</td>
      <td>${req.created_at ? new Date(req.created_at).toLocaleDateString() : '—'}</td>
      <td>${req.reviewed_at ? new Date(req.reviewed_at).toLocaleDateString() : '—'}</td>
    </tr>
  `).join('');
}

/* ═══════════════════════════════════════
   SA BRANCH ASSIGNMENT
   ═══════════════════════════════════════ */

const SA_BRANCH_BADGE_COLORS = ['var(--amber)', 'var(--blue)', 'var(--teal)', 'var(--green)', 'var(--red)'];

const SA_PH_REGIONS = [
  'NCR','Region I','CAR','Region II','Region III',
  'Region IV-A (CALABARZON)','Region IV-B (MIMAROPA)',
  'Region V','Region VI','Region VII','Region VIII',
  'Region IX','Region X','Region XI','Region XII',
  'Region XIII (CARAGA)','BARMM',
];

const SA_PH_PROVINCES = {
  'NCR':['Metro Manila'],
  'Region I':['Ilocos Norte','Ilocos Sur','La Union','Pangasinan'],
  'CAR':['Abra','Apayao','Benguet','Ifugao','Kalinga','Mountain Province'],
  'Region II':['Batanes','Cagayan','Isabela','Nueva Vizcaya','Quirino'],
  'Region III':['Aurora','Bataan','Bulacan','Nueva Ecija','Pampanga','Tarlac','Zambales'],
  'Region IV-A (CALABARZON)':['Batangas','Cavite','Laguna','Quezon','Rizal'],
  'Region IV-B (MIMAROPA)':['Marinduque','Occidental Mindoro','Oriental Mindoro','Palawan','Romblon'],
  'Region V':['Albay','Camarines Norte','Camarines Sur','Catanduanes','Masbate','Sorsogon'],
  'Region VI':['Aklan','Antique','Capiz','Guimaras','Iloilo','Negros Occidental'],
  'Region VII':['Bohol','Cebu','Negros Oriental','Siquijor'],
  'Region VIII':['Biliran','Eastern Samar','Leyte','Northern Samar','Samar','Southern Leyte'],
  'Region IX':['Zamboanga del Norte','Zamboanga del Sur','Zamboanga Sibugay'],
  'Region X':['Bukidnon','Camiguin','Lanao del Norte','Misamis Occidental','Misamis Oriental'],
  'Region XI':['Davao de Oro','Davao del Norte','Davao del Sur','Davao Occidental','Davao Oriental'],
  'Region XII':['Cotabato','Sarangani','South Cotabato','Sultan Kudarat'],
  'Region XIII (CARAGA)':['Agusan del Norte','Agusan del Sur','Dinagat Islands','Surigao del Norte','Surigao del Sur'],
  'BARMM':['Basilan','Lanao del Sur','Maguindanao del Norte','Maguindanao del Sur','Sulu','Tawi-Tawi'],
};

const SA_PH_CITIES = {
  'Metro Manila':['Caloocan','Las Piñas','Makati','Malabon','Mandaluyong','Manila','Marikina','Muntinlupa','Navotas','Parañaque','Pasay','Pasig','Pateros','Quezon City','San Juan','Taguig','Valenzuela'],
  'Ilocos Norte':['Adams','Bacarra','Badoc','Bangui','Banna','Burgos','Carasi','Currimao','Dingras','Dumalneg','Laoag City','Marcos','Nueva Era','Pagudpud','Paoay','Pasuquin','Piddig','Pinili','San Nicolas','Sarrat','Solsona','Vintar'],
  'Ilocos Sur':['Alilem','Banayoyo','Bantay','Burgos','Cabugao','Candon City','Caoayan','Cervantes','Galimuyod','Gregorio del Pilar','Lidlidda','Magsingal','Nagbukel','Narvacan','Quirino','Salcedo','San Emilio','San Esteban','San Ildefonso','San Juan','San Vicente','Santa','Santa Catalina','Santa Cruz','Santa Lucia','Santa Maria','Santiago','Sigay','Sinait','Sugpon','Suyo','Tagudin','Vigan City'],
  'La Union':['Agoo','Aringay','Bacnotan','Bagulin','Balaoan','Bangar','Bauang','Burgos','Caba','Luna','Naguilian','Pugo','Rosario','San Fernando City','San Gabriel','San Juan','Santo Tomas','Santol','Sudipen','Tubao'],
  'Pangasinan':['Agno','Aguilar','Alaminos City','Alcala','Anda','Asingan','Balungao','Bani','Basista','Bautista','Bayambang','Binalonan','Binmaley','Bolinao','Bugallon','Burgos','Calasiao','Dagupan City','Dasol','Infanta','Labrador','Laoac','Lingayen','Mabini','Malasiqui','Manaoag','Mangaldan','Mangatarem','Mapandan','Natividad','Pozzorubio','Rosales','San Carlos City','San Fabian','San Jacinto','San Manuel','San Nicolas','San Quintin','Santa Barbara','Santa Maria','Santo Tomas','Sison','Sual','Tayug','Umingan','Urbiztondo','Urdaneta City','Villasis'],
  'Abra':['Bangued','Boliney','Bucay','Bucloc','Daguioman','Danglas','Dolores','La Paz','Lacub','Lagangilang','Lagayan','Langiden','Licuan-Baay','Luba','Malibcong','Manabo','Penarrubia','Pidigan','Pilar','Sallapadan','San Isidro','San Juan','San Quintin','Tayum','Tineg','Tubo','Villaviciosa'],
  'Apayao':['Calanasan','Conner','Flora','Kabugao','Luna','Pudtol','Santa Marcela'],
  'Benguet':['Atok','Baguio City','Bakun','Bokod','Buguias','Itogon','Kabayan','Kapangan','Kibungan','La Trinidad','Mankayan','Sablan','Tuba','Tublay'],
  'Ifugao':['Aguinaldo','Alfonso Lista','Asipulo','Banaue','Hingyon','Hungduan','Kiangan','Lagawe','Lamut','Mayoyao','Tinoc'],
  'Kalinga':['Balbalan','Lubuagan','Pasil','Pinukpuk','Rizal','Tanudan','Tinglayan','Tabuk City'],
  'Mountain Province':['Barlig','Bauko','Besao','Bontoc','Natonin','Paracelis','Sabangan','Sadanga','Sagada','Tadian'],
  'Batanes':['Basco','Itbayat','Ivana','Mahatao','Sabtang','Uyugan'],
  'Cagayan':['Abulug','Alcala','Allacapan','Amulung','Aparri','Baggao','Ballesteros','Buguey','Calayan','Camalaniugan','Claveria','Enrile','Gattaran','Gonzaga','Iguig','Lal-lo','Lasam','Pamplona','Penablanca','Piat','Rizal','Sanchez-Mira','Santa Ana','Santa Praxedes','Santa Teresita','Santo Nino','Solana','Tuao','Tuguegarao City'],
  'Isabela':['Alicia','Angadanan','Aurora','Benito Soliven','Burgos','Cabagan','Cabatuan','Cauayan City','Cordon','Delfin Albano','Dinapigue','Divilacan','Echague','Gamu','Ilagan City','Jones','Luna','Maconacon','Mallig','Naguilian','Palanan','Quezon','Quirino','Ramon','Reina Mercedes','Roxas','San Agustin','San Guillermo','San Isidro','San Manuel','San Mariano','San Mateo','San Pablo','Santa Maria','Santiago City','Santo Tomas','Tumauini'],
  'Nueva Vizcaya':['Alfonso Castaneda','Ambaguio','Aritao','Bagabag','Bambang','Bayombong','Diadi','Dupax del Norte','Dupax del Sur','Kasibu','Kayapa','Quezon','Santa Fe','Solano','Villaverde'],
  'Quirino':['Aglipay','Cabarroguis','Diffun','Maddela','Nagtipunan','Saguday'],
  'Aurora':['Baler','Casiguran','Dilasag','Dinalungan','Dingalan','Dipaculao','Maria Aurora','San Luis'],
  'Bataan':['Abucay','Bagac','Balanga City','Dinalupihan','Hermosa','Limay','Mariveles','Morong','Orani','Orion','Pilar','Samal'],
  'Bulacan':['Angat','Balagtas','Baliuag','Bocaue','Bulacan','Bustos','Calumpit','Dona Remedios Trinidad','Guiguinto','Hagonoy','Malolos City','Marilao','Meycauayan City','Norzagaray','Obando','Pandi','Paombong','Plaridel','Pulilan','San Ildefonso','San Jose del Monte City','San Miguel','San Rafael','Santa Maria'],
  'Nueva Ecija':['Aliaga','Bongabon','Cabanatuan City','Cabiao','Carranglan','Cuyapo','Gabaldon','Gapan City','General Mamerto Natividad','General Tinio','Guimba','Jaen','Laur','Licab','Llanera','Lupao','Munoz City','Nampicuan','Palayan City','Pantabangan','Penaranda','Quezon','Rizal','San Antonio','San Isidro','San Jose City','San Leonardo','Santa Rosa','Santo Domingo','Talavera','Talugtug','Zaragoza'],
  'Pampanga':['Angeles City','Apalit','Arayat','Bacolor','Candaba','Floridablanca','Guagua','Lubao','Mabalacat City','Macabebe','Magalang','Masantol','Mexico','Minalin','Porac','San Fernando City','San Luis','San Simon','Santa Ana','Santa Rita','Santo Tomas','Sasmuan'],
  'Tarlac':['Anao','Bamban','Camiling','Capas','Concepcion','Gerona','La Paz','Mayantoc','Moncada','Paniqui','Pura','Ramos','San Clemente','San Jose','San Manuel','Santa Ignacia','Tarlac City','Victoria'],
  'Zambales':['Botolan','Cabangan','Candelaria','Castillejos','Iba','Masinloc','Olongapo City','Palauig','San Antonio','San Felipe','San Marcelino','San Narciso','Santa Cruz','Subic'],
  'Batangas':['Agoncillo','Alitagtag','Balayan','Balete','Batangas City','Bauan','Calaca','Calatagan','Cuenca','Ibaan','Laurel','Lemery','Lian','Lipa City','Lobo','Mabini','Malvar','Mataas na Kahoy','Nasugbu','Padre Garcia','Rosario','San Jose','San Juan','San Luis','San Nicolas','San Pascual','Santa Teresita','Santo Tomas','Taal','Talisay','Tanauan City','Taysan','Tingloy','Tuy'],
  'Cavite':['Alfonso','Amadeo','Bacoor City','Carmona','Cavite City','Dasmarinas City','General Emilio Aguinaldo','General Mariano Alvarez','General Trias City','Imus City','Indang','Kawit','Magallanes','Maragondon','Mendez','Naic','Noveleta','Rosario','Silang','Tagaytay City','Tanza','Ternate','Trece Martires City'],
  'Laguna':['Alaminos','Bay','Binan City','Cabuyao City','Calamba City','Calauan','Cavinti','Famy','Kalayaan','Liliw','Los Banos','Luisiana','Lumban','Mabitac','Magdalena','Majayjay','Nagcarlan','Paete','Pagsanjan','Pakil','Pangil','Pila','Rizal','San Pablo City','San Pedro City','Santa Cruz','Santa Maria','Santa Rosa City','Siniloan','Victoria'],
  'Quezon':['Agdangan','Alabat','Atimonan','Buenavista','Burdeos','Calauag','Candelaria','Catanauan','Dolores','General Luna','General Nakar','Guinayangan','Gumaca','Infanta','Jomalig','Lopez','Lucban','Lucena City','Macalelon','Mauban','Mulanay','Padre Burgos','Pagbilao','Panukulan','Patnanungan','Perez','Pitogo','Plaridel','Polillo','Real','Sampaloc','San Andres','San Antonio','San Francisco','San Narciso','Sariaya','Tagkawayan','Tayabas City','Tiaong','Unisan'],
  'Rizal':['Angono','Antipolo City','Baras','Binangonan','Cainta','Cardona','Jalajala','Morong','Pililla','Rodriguez','San Mateo','Tanay','Taytay','Teresa'],
  'Marinduque':['Boac','Buenavista','Gasan','Mogpog','Santa Cruz','Torrijos'],
  'Occidental Mindoro':['Abra de Ilog','Calintaan','Looc','Lubang','Magsaysay','Mamburao','Paluan','Rizal','Sablayan','San Jose','Santa Cruz'],
  'Oriental Mindoro':['Baco','Bansud','Bongabong','Bulalacao','Calapan City','Gloria','Mansalay','Naujan','Pinamalayan','Pola','Puerto Galera','Roxas','San Teodoro','Socorro','Victoria'],
  'Palawan':['Aborlan','Agutaya','Araceli','Balabac','Bataraza','Brookes Point','Busuanga','Cagayancillo','Coron','Culion','Cuyo','Dumaran','El Nido','Kalayaan','Linapacan','Magsaysay','Narra','Puerto Princesa City','Quezon','Rizal','Roxas','San Vicente','Sofronio Espanola','Taytay','Turtle Islands'],
  'Romblon':['Alcantara','Banton','Cajidiocan','Calatrava','Concepcion','Corcuera','Ferrol','Looc','Magdiwang','Odiongan','Romblon','San Agustin','San Andres','San Fernando','San Jose','Santa Fe','Santa Maria'],
  'Albay':['Bacacay','Camalig','Daraga','Guinobatan','Jovellar','Legazpi City','Libon','Ligao City','Malilipot','Malinao','Manito','Oas','Pio Duran','Polangui','Rapu-Rapu','Santo Domingo','Tiwi'],
  'Camarines Norte':['Basud','Capalonga','Daet','Jose Panganiban','Labo','Mercedes','Paracale','San Lorenzo Ruiz','San Vicente','Santa Elena','Talisay','Vinzons'],
  'Camarines Sur':['Baao','Balatan','Bato','Bombon','Buhi','Bula','Cabusao','Calabanga','Camaligan','Canaman','Caramoan','Del Gallego','Gainza','Garchitorena','Goa','Iriga City','Lagonoy','Libmanan','Lupi','Magarao','Milaor','Minalabac','Nabua','Naga City','Ocampo','Pamplona','Pasacao','Pili','Presentacion','Ragay','Sagnas','San Fernando','San Jose','Sipocot','Siruma','Tigaon','Tinambac'],
  'Catanduanes':['Bagamanoc','Baras','Bato','Caramoran','Gigmoto','Pandan','Panganiban','San Andres','San Miguel','Viga','Virac'],
  'Masbate':['Aroroy','Baleno','Balud','Batuan','Cataingan','Cawayan','Claveria','Dimasalang','Esperanza','Mandaon','Masbate City','Milagros','Mobo','Monreal','Palanas','Pio V. Corpuz','Placer','San Fernando','San Jacinto','San Pascual','Uson'],
  'Sorsogon':['Barcelona','Bulan','Bulusan','Casiguran','Castilla','Donsol','Gubat','Irosin','Juban','Magallanes','Matnog','Pilar','Prieto Diaz','Santa Magdalena','Sorsogon City'],
  'Aklan':['Altavas','Balete','Banga','Batan','Buruanga','Ibajay','Kalibo','Lezo','Libacao','Madalag','Makato','Malay','Malinao','Nabas','New Washington','Numancia','Tangalan'],
  'Antique':['Anini-y','Barbaza','Belison','Bugasong','Caluya','Culasi','Hamtic','Laua-an','Libertad','Pandan','Patnongon','San Jose de Buenavista','San Remigio','Sebaste','Sibalom','Tibiao','Tobias Fornier','Valderrama'],
  'Capiz':['Cuartero','Dao','Dumalag','Dumarao','Ivisan','Jamindan','Ma-ayon','Mambusao','Panay','Panitan','Pilar','Pontevedra','President Roxas','Roxas City','Sapi-an','Sigma','Tapaz'],
  'Guimaras':['Buenavista','Jordan','Nueva Valencia','San Lorenzo','Sibunag'],
  'Iloilo':['Ajuy','Alimodian','Anilao','Badiangan','Balasan','Banate','Barotac Nuevo','Barotac Viejo','Batad','Bingawan','Cabatuan','Calinog','Carles','Concepcion','Dingle','Duenas','Dumangas','Estancia','Guimbal','Igbaras','Iloilo City','Janiuay','Lambunao','Leganes','Lemery','Leon','Maasin','Miagao','Mina','New Lucena','Oton','Passi City','Pavia','Pototan','San Dionisio','San Enrique','San Joaquin','San Miguel','San Rafael','Santa Barbara','Sara','Tigbauan','Tubungan','Zarraga'],
  'Negros Occidental':['Bacolod City','Bago City','Binalbagan','Cadiz City','Calatrava','Candoni','Cauayan','Don Salvador Benedicto','Enrique B. Magalona','Escalante City','Himamaylan City','Hinigaran','Hinoba-an','Ilog','Isabela','Kabankalan City','La Carlota City','La Castellana','Manapla','Moises Padilla','Murcia','Pontevedra','Pulupandan','Sagay City','San Carlos City','San Enrique','Silay City','Sipalay City','Talisay City','Toboso','Valladolid','Victorias City'],
  'Bohol':['Alburquerque','Alicia','Anda','Antequera','Baclayon','Balilihan','Batuan','Bien Unido','Bilar','Buenavista','Calape','Candijay','Carmen','Catigbian','Clarin','Corella','Cortes','Dagohoy','Danao','Dauis','Dimiao','Duero','Garcia Hernandez','Getafe','Guindulman','Inabanga','Jagna','Lila','Loay','Loboc','Loon','Mabini','Maribojoc','Panglao','Pilar','Sagbayan','San Isidro','San Miguel','Sevilla','Sierra Bullones','Sikatuna','Tagbilaran City','Talibon','Trinidad','Tubigon','Ubay','Valencia'],
  'Cebu':['Alcantara','Alcoy','Alegria','Aloguinsan','Argao','Asturias','Badian','Balamban','Bantayan','Barili','Bogo City','Boljoon','Borbon','Carcar City','Carmen','Catmon','Cebu City','Compostela','Consolacion','Cordova','Daanbantayan','Dalaguete','Danao City','Dumanjug','Ginatilan','Lapu-Lapu City','Liloan','Madridejos','Malabuyoc','Mandaue City','Medellin','Minglanilla','Moalboal','Naga City','Oslob','Pilar','Pinamungajan','Poro','Ronda','Samboan','San Fernando','San Francisco','San Remigio','Santa Fe','Santander','Sibonga','Sogod','Tabogon','Tabuelan','Talisay City','Toledo City','Tuburan','Tudela'],
  'Negros Oriental':['Amlan','Ayungon','Bacong','Bais City','Basay','Bayawan City','Bindoy','Canlaon City','Dauin','Dumaguete City','Guihulngan City','Jimalalud','La Libertad','Mabinay','Manjuyod','Pamplona','San Jose','Santa Catalina','Siaton','Sibulan','Tanjay City','Tayasan','Valencia','Vallehermoso','Zamboanguita'],
  'Siquijor':['Enrique Villanueva','Larena','Lazi','Maria','San Juan','Siquijor'],
  'Biliran':['Almeria','Biliran','Cabucgayan','Caibiran','Culaba','Kawayan','Maripipi','Naval'],
  'Eastern Samar':['Arteche','Balangiga','Balangkayan','Borongan City','Can-avid','Dolores','General MacArthur','Giporlos','Guiuan','Hernani','Jipapad','Lawaan','Llorente','Maslog','Maydolong','Mercedes','Oras','Quinapondan','Salcedo','San Julian','San Policarpo','Sulat','Taft'],
  'Leyte':['Abuyog','Alangalang','Albuera','Babatngon','Barugo','Bato','Baybay City','Burauen','Calubian','Capoocan','Carigara','Dagami','Dulag','Hilongos','Hindang','Inopacan','Isabel','Jaro','Javier','Julita','Kananga','La Paz','Leyte','MacArthur','Mahaplag','Matag-ob','Matalom','Mayorga','Merida','Ormoc City','Palo','Palompon','Pastrana','San Isidro','San Miguel','Santa Fe','Tabango','Tabontabon','Tacloban City','Tanauan','Tolosa','Tunga','Villaba'],
  'Northern Samar':['Allen','Biri','Bobon','Capul','Catarman','Catubig','Gamay','Laoang','Lapinig','Las Navas','Lavezares','Lope de Vega','Mapanas','Mondragon','Palapag','Pambujan','Rosario','San Antonio','San Isidro','San Jose','San Roque','San Vicente','Silvino Lobos','Victoria'],
  'Samar':['Almagro','Basey','Calbayog City','Calbiga','Catbalogan City','Daram','Gandara','Hinabangan','Jiabong','Marabut','Matuguinao','Motiong','Pagsanghan','Paranas','Pinabacdao','San Jorge','San Jose de Buan','San Sebastian','Santa Margarita','Santa Rita','Santo Nino','Tagapul-an','Talalora','Tarangnan','Villareal','Zumarraga'],
  'Southern Leyte':['Anahawan','Bontoc','Hinunangan','Hinundayan','Libagon','Liloan','Limasawa','Maasin City','Macrohon','Malitbog','Padre Burgos','Pintuyan','Saint Bernard','San Francisco','San Juan','San Ricardo','Silago','Sogod','Tomas Oppus'],
  'Zamboanga del Norte':['Baliguian','Dapitan City','Dipolog City','Godod','Gutalac','Jose Dalman','Kalawit','Katipunan','La Libertad','Labason','Leon B. Postigo','Liloy','Manukan','Mutia','Pinan','Polanco','President Manuel A. Roxas','Rizal','Salug','San Miguel','San Pablo','Sergio Osmena Sr.','Siayan','Sibuco','Sibutad','Sindangan','Siocon','Sirawai','Tampilisan'],
  'Zamboanga del Sur':['Aurora','Bayog','Dimataling','Dinas','Dumalinao','Dumingag','Guipos','Josefina','Kumalarang','Labangan','Lakewood','Lapuyan','Mahayag','Margosatubig','Midsalip','Molave','Pagadian City','Pitogo','Ramon Magsaysay','San Miguel','San Pablo','Sominot','Tabina','Tambulig','Tigbao','Tukuran','Vincenzo A. Sagun','Zamboanga City'],
  'Zamboanga Sibugay':['Alicia','Buug','Diplahan','Imelda','Ipil','Kabasalan','Mabuhay','Malangas','Naga','Olutanga','Payao','Roseller Lim','Siay','Talusan','Titay','Tungawan'],
  'Bukidnon':['Baungon','Cabanglasan','Damulog','Dangcagan','Don Carlos','Impasug-ong','Kadingilan','Kalilangan','Kibawe','Kitaotao','Lantapan','Libona','Malitbog','Manolo Fortich','Maramag','Pangantucan','Quezon','San Fernando','Sumilao','Talakag','Valencia City','Malaybalay City'],
  'Camiguin':['Catarman','Guinsiliban','Mahinog','Mambajao','Sagay'],
  'Lanao del Norte':['Bacolod','Baloi','Baroy','Iligan City','Kapatagan','Kauswagan','Kolambugan','Lala','Linamon','Magsaysay','Maigo','Matungao','Munai','Nunungan','Pantao Ragat','Pantar','Poona Piagapo','Salvador','Sapad','Sultan Naga Dimaporo','Tangcal','Tubod'],
  'Misamis Occidental':['Aloran','Baliangao','Bonifacio','Calamba','Clarin','Concepcion','Don Victoriano Chiongbian','Jimenez','Lopez Jaena','Oroquieta City','Ozamiz City','Panaon','Plaridel','Sapang Dalaga','Sinacaban','Tangub City','Tudela'],
  'Misamis Oriental':['Alubijid','Balingasag','Balingoan','Binuangan','Cagayan de Oro City','Claveria','El Salvador City','Gingoog City','Gitagum','Initao','Jasaan','Kinoguitan','Lagonglong','Laguindingan','Libertad','Lugait','Magsaysay','Manticao','Medina','Naawan','Opol','Salay','Sugbongcogon','Tagoloan','Talisayan','Villanueva'],
  'Davao de Oro':['Compostela','Laak','Mabini','Maco','Maragusan','Mawab','Monkayo','Montevista','Nabunturan','New Bataan','Pantukan'],
  'Davao del Norte':['Asuncion','Braulio E. Dujali','Carmen','Kapalong','New Corella','Panabo City','Samal City','San Isidro','Santo Tomas','Tagum City','Talaingod'],
  'Davao del Sur':['Bansalan','Davao City','Digos City','Hagonoy','Jose Abad Santos','Kiblawan','Magsaysay','Malalag','Matanao','Padada','Santa Cruz','Sulop'],
  'Davao Occidental':['Don Marcelino','Jose Abad Santos','Malita','Santa Maria','Sarangani'],
  'Davao Oriental':['Baganga','Banaybanay','Boston','Caraga','Cateel','Gov. Generoso','Lupon','Manay','Mati City','San Isidro','Tarragona'],
  'Cotabato':['Alamada','Aleosan','Antipas','Arakan','Banisilan','Carmen','Kabacan','Kidapawan City','Libungan','Mlang','Magpet','Makilala','Matalam','Midsayap','Pigkawayan','Pikit','President Roxas','Tulunan'],
  'Sarangani':['Alabel','Glan','Kiamba','Maasim','Maitum','Malapatan','Malungon'],
  'South Cotabato':['Banga','General Santos City','Koronadal City','Lake Sebu','Norala','Polomolok','Santo Nino','Surallah','Tboli','Tampakan','Tantangan','Tupi'],
  'Sultan Kudarat':['Bagumbayan','Columbio','Esperanza','Isulan','Kalamansig','Lambayong','Lebak','Lutayan','Palimbang','President Quirino','Senator Ninoy Aquino','Tacurong City'],
  'Agusan del Norte':['Buenavista','Butuan City','Cabadbaran City','Carmen','Jabonga','Kitcharao','Las Nieves','Magallanes','Nasipit','Remedios T. Romualdez','Santiago','Tubay'],
  'Agusan del Sur':['Bayugan City','Bunawan','Esperanza','La Paz','Loreto','Prosperidad','Rosario','San Francisco','San Luis','Santa Josefa','Sibagat','Talacogon','Trento','Veruela'],
  'Dinagat Islands':['Basilisa','Cagdianao','Dinagat','Libjo','Loreto','San Jose','Tubajon'],
  'Surigao del Norte':['Alegria','Bacuag','Burgos','Claver','Dapa','Del Carmen','General Luna','Gigaquit','Mainit','Malimono','Pilar','Placer','San Benito','San Francisco','San Isidro','Santa Monica','Sison','Socorro','Surigao City','Tagana-an','Tubod'],
  'Surigao del Sur':['Barobo','Bayabas','Bislig City','Cagwait','Cantilan','Carmen','Carrascal','Cortes','Hinatuan','Lanuza','Lianga','Lingig','Madrid','Marihatag','San Agustin','San Miguel','Tagbina','Tago','Tandag City'],
  'Basilan':['Akbar','Al-Barka','Hadji Mohammad Ajul','Hadji Muhtamad','Isabela City','Lamitan City','Lantawan','Maluso','Sumisip','Tabuan-Lasa','Tipo-Tipo','Tuburan','Ungkaya Pukan'],
  'Lanao del Sur':['Amai Manabilang','Bacolod-Kalawi','Balabagan','Balindong','Bayang','Binidayan','Buadiposo-Buntong','Bubong','Bumbaran','Butig','Calanogas','Ditsaan-Ramain','Ganassi','Kapai','Kapatagan','Lumba-Bayabao','Lumbaca-Unayan','Lumbatan','Lumbayanague','Madalum','Madamba','Maguing','Malabang','Marantao','Marawi City','Marogong','Masiu','Molundo','Mulondo','Pagayawan','Piagapo','Picong','Poona Bayabao','Pualas','Saguiaran','Sultan Dumalondong','Sultan Gumander','Tagoloan II','Tamparan','Taraka','Tubaran','Tugaya','Wao'],
  'Maguindanao del Norte':['Barira','Buldon','Datu Blah T. Sinsuat','Datu Odin Sinsuat','Kabuntalan','Matanog','Northern Kabuntalan','Parang','Sultan Kudarat','Sultan Mastura','Upi'],
  'Maguindanao del Sur':['Ampatuan','Buluan','Datu Abdullah Sangki','Datu Anggal Midtimbang','Datu Hoffer Ampatuan','Datu Montawal','Datu Paglas','Datu Piang','Datu Saudi-Ampatuan','Datu Unsay','General Salipada K. Pendatun','Guindulungan','Mamasapano','Mangudadatu','Pagalungan','Paglat','Pandag','Rajah Buayan','Shariff Aguak','Shariff Saydona Mustapha','South Upi','Sultan sa Barongis','Talayan','Talitay'],
  'Sulu':['Banguingui','Hadji Panglima Tahil','Indanan','Jolo','Kalingalan Caluang','Languyan','Lugus','Luuk','Maimbung','Old Panamao','Omar','Pandami','Panglima Estino','Pangutaran','Parang','Pata','Patikul','Siasi','Talipao','Tapul','Tongkil'],
  'Tawi-Tawi':['Bongao','Languyan','Mapun','Panglima Sugala','Sibutu','Simunul','Sapa-Sapa','South Ubian','Tandubas','Turtle Islands'],
};

const SA_PH_BARANGAYS = {
  'Caloocan':['Bagumbong','Baesa','Camarin','Culiat','Deparo','Bagong Silang','Grace Park East','Grace Park West','Llano','Maypajo','Parada','Sangandaan','Tala','Bagal','Boyon','Calachuchi','Karuhatan','Lourdes','Malaria','Paso de Blas','Sta. Quiteria','Tinajeros','University Hills'],
  'Las Piñas':['Almanza Uno','Almanza Dos','BF Resort','Daniel Fajardo','Elias Aldana','Ilaya','Manuyo Uno','Manuyo Dos','Pamplona Uno','Pamplona Dos','Pamplona Tres','Pilar','Pulang Lupa Uno','Pulang Lupa Dos','Talon Uno','Talon Dos','Talon Tres','Talon Kuatro','Talon Singko','Zapote'],
  'Makati':['Bel-Air','Carmona','Cembo','Comembo','Dasmarinas','East Rembo','Forbes Park','Guadalupe Nuevo','Guadalupe Viejo','Kasilawan','La Paz','Legazpi Village','Magallanes','Olympia','Palanan','Pembo','Pinagkaisahan','Pio del Pilar','Pitogo','Poblacion','Post Proper Northside','Post Proper Southside','Rizal','Rockwell','San Antonio','San Isidro','San Lorenzo','Santa Cruz','Singkamas','South Cembo','Tejeros','Urdaneta','Valenzuela','West Rembo'],
  'Malabon':['Acungan','Baritan','Bayan-bayanan','Catmon','Dampalit','Flores','Hulong Duhat','Ibaba','Longos','Maysilo','Muzon','Niugan','Panghulo','Potrero','San Agustin','Santolan','Tabing Ilog','Tanong','Tinajeros','Tonsuya','Tugatog'],
  'Mandaluyong':['Addition Hills','Bagong Silang','Barangka Drive','Barangka Ibaba','Barangka Ilaya','Barangka Itaas','Buayang Bato','Burol','Daang Bakal','Hagdang Bato Itaas','Hagdang Bato Libis','Harapin ang Bukas','Highway Hills','Hulo','Mabini-J. Rizal','Malamig','Mauway','Namayan','New Zaniga','Old Zaniga','Pag-asa','Plainview','Pleasant Hills','Poblacion','San Jose','Vergara','Wack-Wack Greenhills'],
  'Manila':['Binondo','Ermita','Intramuros','Malate','Paco','Pandacan','Port Area','Quiapo','Sampaloc','San Andres Bukid','San Miguel','San Nicolas','Santa Ana','Santa Cruz','Santa Mesa','Tondo'],
  'Marikina':['Barangka','Calumpang','Concepcion Uno','Concepcion Dos','Fortune','Industrial Valley','Jesus de la Pena','Kalumpang','Malanday','Marikina Heights','Nangka','Parang','San Roque','Santa Elena','Santo Nino','Tanong','Tumana'],
  'Muntinlupa':['Alabang','Ayala Alabang','Bayanan','Buli','Cupang','New Alabang','Poblacion','Putatan','Sucat','Tunasan'],
  'Navotas':['Bagumbayan North','Bagumbayan South','Bangculasi','Daanghari','Navotas East','Navotas West','North Bay Boulevard South','San Jose Patag','San Roque','Sipac-Almacen','Tanza Norte','Tanza Sur'],
  'Parañaque':['BF Homes','Baclaran','Don Bosco','Don Galo','La Huerta','Marcelo Green','Merville','Moonshine','San Dionisio','San Isidro','San Martin de Porres','Santa Rita','Santo Nino','Sun Valley','Tambo','Vitalez'],
  'Pasay':['Baclaran','Bagong Lipunan ng Crame','Libertad','Merville','Malibay','Maricaban','Pinaglabanan','San Isidro','Villamor'],
  'Pasig':['Bagong Ilog','Bagong Katipunan','Bambang','Buting','Caniogan','Dela Paz','Kalawaan','Kapasigan','Kapitolyo','Karangalan','Ligid-Tipas','Malinao','Manggahan','Maybunga','Oranbo','Palatiw','Pinagbuhatan','Pineda','Rosario','Sagad','San Antonio','San Joaquin','San Jose','San Nicolas','Santa Lucia','Santa Rosa','Santo Tomas','Sumilang','Ugong'],
  'Pateros':['Aguho','Magtanggol','Martires del 96','Poblacion','San Pedro','San Roque','Santa Ana','Santo Rosario-Kanluran','Santo Rosario-Silangan','Tabacalera'],
  'Quezon City':['Alicia','Amihan','Apolonio Samson','Bagbag','Bagong Lipunan ng Crame','Bagong Pag-asa','Bagong Silangan','Bagumbuhay','Bagumbayan','Balintawak','Balong Bato','Batasan Hills','Bayanihan','Blue Ridge A','Blue Ridge B','Botocan','Capri','Central','Commonwealth','Culiat','Damar','Damayan','Damayan Lagi','Del Monte','Don Manuel','Dona Aurora','Dona Imelda','Dona Josefa','Duyan-Duyan','E. Rodriguez','East Kamias','Escopa I','Escopa II','Escopa III','Escopa IV','Fairview','Greater Lagro','Gulod','Holy Spirit','Horseshoe','Immaculate Concepcion','Kaligayahan','Kalusugan','Kamuning','Katipunan','Kaunlaran','Kristong Hari','Krus na Ligas','Laging Handa','Libis','Lourdes','Loyola Heights','Maharlika','Malaya','Mangga','Manresa','Mariana','Masagana','Masambong','Matandang Balara','Milagrosa','N.S. Amoranto','Nagkaisang Nayon','New Era','Novaliches Proper','Obrero','Old Capitol Site','Pag-ibig sa Nayon','Paligsahan','Paraiso','Pasong Putik','Pasong Tamo','Payatas','Philam','Pinagkaisahan','Pinyahan','Project 6','Project 7','Project 8','Quirino 2-A','Quirino 2-B','Quirino 2-C','Quirino 3-A','Ramon Magsaysay','Roxas','Sacred Heart','Saint Ignatius','Saint Peter','Salvacion','San Agustin','San Antonio','San Bartolome','San Isidro Labrador I','San Isidro Labrador II','San Jose','San Martin de Porres','San Roque','San Vicente','Sangandaan','Santa Cruz','Santa Lucia','Santa Monica','Santa Teresita','Silangan','Socorro','South Triangle','Tagumpay','Talipapa','Tandang Sora','Tatalon','Teachers Village East','Teachers Village West','Ugong Norte','Vasra','Veterans Village','Villa Maria Clara','West Kamias','West Triangle','White Plains'],
  'San Juan':['Addition Hills','Balong-Bato','Batis','Corazon de Jesus','Ermitano','Greenhills','Isabelita','Kabayanan','Little Baguio','Maytunas','Onse','Pasadena','Pedro Cruz','Progreso','Rivera','Salapan','San Perfecto','Santa Lucia','Tibagan','West Crame'],
  'Taguig':['Bagumbayan','Bambang','Calzada','Central Bicutan','Central Signal Village','Fort Bonifacio','Hagonoy','Ibayo-Tipas','Katuparan','Ligid-Tipas','Lower Bicutan','Maharlika Village','Napindan','New Lower Bicutan','North Daang Hari','North Signal Village','Palingon-Tipas','Pinagsama','San Miguel','Santa Ana','South Daang Hari','South Signal Village','Tanyag','Tuktukan','Upper Bicutan','Ususan','Wawa','Western Bicutan'],
  'Valenzuela':['Arkong Bato','Bagbaguin','Balangkas','Bignay','Bisig','Canumay East','Canumay West','Coloong','Dalandanan','Gen. T. De Leon','Isla','Karuhatan','Lawang Bato','Lingunan','Mabolo','Malanday','Malinta','Mapulang Lupa','Marulas','Maysan','Palasan','Parada','Pasolo','Poblacion','Pulo','Punturin','Rincon','Tagalag','Ugong','Viente Reales','Wawang Pulo'],
  'Cebu City':['Adlaon','Agsungot','Apas','Babag','Bacayan','Banilad','Basak Pardo','Basak San Nicolas','Binaliw','Bonbon','Budlaan','Bulacao','Busay','Calamba','Cambinocot','Capitol Site','Carreta','Central Pardo','Cogon Pardo','Cogon Ramos','Cubacub','Guadalupe','Guba','Inayawan','Kalunasan','Kamagayan','Kasambagan','Kinasang-an','Labangon','Lahug','Lorega-San Miguel','Lusaran','Luz','Mabini','Mabolo','Malubog','Mambaling','Nivel Hills','Pardo','Pari-an','Paril','Pasil','Pit-os','Pulangbato','Punta Princesa','Sambag I','Sambag II','San Antonio','San Jose','San Nicolas Central','San Nicolas Proper','San Roque','Santa Cruz','Santo Nino','Suba','Sudlon I','Sudlon II','T. Padilla','Talamban','Taptap','Tejero','Tinago','Tisa','Zapatera'],
  'Davao City':['Agdao','Alambre','Angalan','Bago Aplaya','Bago Gallera','Bago Oshiro','Baguio','Balengaeng','Baliok','Bangkas Heights','Bantol','Baracatan','Biao Escuela','Biao Guianga','Biao Joaquin','Binugao','Buhangin Proper','Bunawan Proper','Cabantian','Calinan Proper','Callawa','Camansi','Carmen','Catalunan Grande','Catalunan Pequeno','Catitipan','Dacudao','Dalag','Datu Salumay','Dominga','Dumoy','Eden','Fatima','Gatungan','Gov. Paciano Bangoy','Gov. Vicente Duterte','Ilang','Inayangan','Indangan','Lacson','Lamanan','Langub','Lapu-lapu','Lasang','Leon Garcia Sr.','Lizada','Los Amigos','Lubogan','Lumiad','Ma-a','Mabuhay','Malagos','Malamba','Manambulan','Manuel Guianga','Mapula','Marapangi','Marilog Proper','Matina Aplaya','Matina Crossing','Matina Pangi','Mintal','Mudiang','Mulig','New Carmen','New Valencia','Pampanga','Panacan','Poblacion','Rafael Castillo','Riverside','Salapawan','Salaysay','San Antonio','San Isidro','Santa Ana','Santo Nino','Sasa','Sirib','Sirawan','Tagluno','Talomo Proper','Taminco','Tigatto','Toril Proper','Tugbok Proper','Ukip','Ula','Vicente Hizon Sr.','Waan','Wangan','Wines'],
  'Cagayan de Oro City':['Agusan','Balubal','Bulua','Camaman-an','Consolacion','Cugman','Dansolihon','F.S. Catanico','Gusa','Iponan','Kauswagan','Lapasan','Lumbia','Macabalan','Macasandig','Mambuaya','Nazareth','Pagalungan','Patag','Pagatpat','Pigsag-an','Puerto','Puntod','San Simon','Tablon','Taglimao','Tignapoloan','Tumpagon','Wao','Poblacion 1','Poblacion 2','Poblacion 3','Poblacion 4','Poblacion 5','Poblacion 6','Poblacion 7','Poblacion 8','Poblacion 9','Poblacion 10'],
  'Baguio City':['Abanao-Zandueta-Kayong-Chugum-Otek','Alfonso Tabora','Ambiong','Andres Bonifacio','Apugan-Loakan','Asin Road','Aurora Hill Proper','Aurora Hill North Central','Aurora Hill South Central','Bakakeng Central','Bakakeng North','Balsigan','Bayan Park East','Bayan Park Village','Bayan Park West','BGH Compound','Brookside','Buol','Cabinet Hill-Teacher\'s Camp','Camp 7','Camp 8','Camp Allen','Campo Filipino','City Camp Central','City Camp Proper','Country Club Village','Dagsian Lower','Dagsian Upper','Dominican Hill-Mirador','Dontogan','DPS Area','Fairview Village','Ferdinand','Fort del Pilar','Gabriela Silang','General Luna','Greenwater Village','Guisad Central','Guisad Sorong','Happy Hollow','Harrison-Claudio Carantes','Holy Ghost Extension','Holy Ghost Proper','Irisan','Kayang-Hilltop','Kayang-Kayang','Kias','Lourdes Subdivision Extension','Lourdes Subdivision Proper','Lower Bakakeng','Lower Dagsian','Lower General Luna Road','Lower Magsaysay','Lower Quirino Hill','Lucnab','Magsaysay Private Road','Manuel Roxas','Market Subdivision Upper','Military Cut-off','Mines View Park','Modern Site East','Modern Site West','MRR-Queen of Peace','New Lucban','Outlook Drive','Pacdal','Padre Burgos','Padre Zamora','Palma-Urbano','Peter\'s Rock','Phil-Am','Pinget','Pinsao Pilot Project','Pinsao Proper','Poliwes','Pucsusan','Quirino Hill East','Quirino Hill Lower','Quirino Hill Middle','Quirino Hill West','Quirino-Magsaysay','Rock Quarry Lower','Rock Quarry Middle','Rock Quarry Upper','Saint Joseph Village','Salud Mitra','San Antonio Village','San Luis Village','San Vicente','Santa Escolastica','Santo Rosario-Yangco','Santos-Kagalkan','Santuario','Scout Barrio','Session Road Area','Slaughter House Area','South Drive','Teodora Alonzo','Trancoville','Upper Dagsian','Upper General Luna','Upper Magsaysay','Upper Market Subdivision','Upper Quirino Hill','Upper Rock Quarry','Victoria Village'],
  // Rizal Province
  'Antipolo City':['Bagong Nayon','Beverly Hills','Calawis','Cupang','Dalig','Dela Paz','Inarawan','Mambugan','Mayamot','Mina-Bago','Muntingdilaw','Niogan','San Isidro','San Jose','San Juan','San Luis','San Roque','Santa Cruz','Santo Nino'],
  'Angono':['Bagumbayan','Kalayaan','Mahabang Lupa','Makane','Mugay','Pag-asa','San Isidro','San Pedro'],
  'Baras':['Concepcion','Evangelista','Laiban','Mababoy','Maguasawang Ilat','Minuyan','Pinugay','Puting Kahoy','San Juan','San Marcos','San Miguel','San Rafael','Santa Cruz'],
  'Binangonan':['Batingan','Calumpang','Habay','Hulo','Janosa','Layunan','Lunsad','Mabolo','Macamot','Mahabang Lupa','Malakaban','Pantok','Pag-asa','San Carlos','San Pedro','Tagpos','Tatala','Wawa'],
  'Cainta':['San Andres','San Isidro','San Juan','Sto. Domingo','Sto. Tomas','Sta. Rosa'],
  'Cardona':['Balibago','Calumpang','Looc','Mabalo','Real','Sampad','San Roque','Sumilang','Wawa'],
  'Jalajala':['Bagumbong','Halayhayin','Paaralang Bago','Pagkalinawan','Poblacion','San Isidro','Sipsipin'],
  'Morong':['Bombongan','Can-Cal-Lan','Lagundi','Maybancal','Poblacion'],
  'Pililla':['Halayhayin','Hulo','Imatong','Malaya','Niogan','Quisao','Takungan','Wawa'],
  'Rodriguez':['Balite','Burgos','Geronimo','Macabud','Manggahan','Mascap','Puray','Rosario','San Isidro','San Jose','San Rafael','San Andres'],
  'San Mateo':['Ampid I','Ampid II','Banaba','Dulong Bayan','Guitnang Bayan I','Guitnang Bayan II','Guinayang','Malanday','Nangka','Pintong Bukawe','Sta. Ana','San Roque','Silangan'],
  'Tanay':['Cuyambay','Daraitan','Katipunan','Kaybuto','Laiban','Lano','Mag-ampon','Mamuyao','Pinagkamaligan','Sampalok','San Andres','San Isidro','Tanay Proper','Tandang','Wawa'],
  'Taytay':['Dolores','Muzon','San Juan','Santa Ana','Sta. Cruz'],
  'Teresa':['Poblacion','San Gabriel','San Roque','Santiago'],
  // Cavite Province
  'Bacoor City':['Aniban I','Aniban II','Aniban III','Aniban IV','Aniban V','Banalo','Bayanan','Campo Santo','Digman','Dulong Bayan','Habay I','Habay II','Kaingin','Ligas I','Ligas II','Ligas III','Mabolo I','Mabolo II','Mabolo III','Maliksi I','Maliksi II','Maliksi III','Mambog I','Mambog II','Mambog III','Mambog IV','Mambog V','Molino I','Molino II','Molino III','Molino IV','Molino V','Molino VI','Niog I','Niog II','Niog III','P.F. Espiritu I','P.F. Espiritu II','P.F. Espiritu III','P.F. Espiritu IV','P.F. Espiritu V','P.F. Espiritu VI','P.F. Espiritu VII','Panapaan I','Panapaan II','Panapaan III','Panapaan IV','Panapaan V','Panapaan VI','Panapaan VII','Panapaan VIII','Queens Row Central','Queens Row East','Queens Row West','Real I','Real II','Salinas I','Salinas II','Salinas III','Salinas IV','San Nicolas I','San Nicolas II','San Nicolas III','Sineguelasan','Talaba I','Talaba II','Talaba III','Talaba IV','Talaba V','Talaba VI','Talaba VII','Zapote I','Zapote II','Zapote III','Zapote IV','Zapote V'],
  'Cavite City':['Barangay I','Barangay II','Barangay III','Barangay IV','Barangay V','Barangay VI','Barangay VII','Barangay VIII','Barangay IX','Barangay X','Caridad','Dalahican','Domicilio','Karsada','Lallana','Lelong','Marcelo','Molo','San Antonio','Santa Cruz','Urduja','Wakas'],
  'Dasmarinas City':['Burol I','Burol II','Burol III','Emmanuel Bergado I','Emmanuel Bergado II','Habay I','Habay II','Langkaan I','Langkaan II','Luzviminda I','Luzviminda II','Maharlika I','Maharlika II','Paliparan I','Paliparan II','Paliparan III','Sabang','Salawag','Salitran I','Salitran II','Salitran III','Salitran IV','Sampaloc I','Sampaloc II','Sampaloc III','Sampaloc IV','San Agustin I','San Agustin II','San Agustin III','San Andres I','San Andres II','San Jose','San Luis I','San Luis II','San Manuel I','San Manuel II','San Miguel I','San Miguel II','San Miguel III','San Simon','Santa Cristina I','Santa Cristina II','Santa Cruz I','Santa Cruz II','Santa Fe I','Santa Fe II','Santa Maria','Santa Sophia','Santo Cristo I','Santo Cristo II','Santo Nino I','Santo Nino II','Victoria Reyes','Zone I','Zone II','Zone III','Zone IV'],
  'General Emilio Aguinaldo':['Bano','Biluso','Buck Estate','Buho','Ipilan','Kalayaan','Kaymisas','Kayrilaw','Lalaan I','Lalaan II','Lantic','Liwanag','Loma','Lucsuhin','Luzviminda','Maguyam','Maitim 2nd','Malagasang I','Malagasang II','Naic','Panungyanan','Pasong Camachile I','Pasong Camachile II','Pasong Kawayan I','Pasong Kawayan II','Poblacion I','Poblacion II','Poblacion III','San Francisco I','San Francisco II','San Juan I','San Juan II','Santiago','Tapia','Tejero','Vibora'],
  'General Mariano Alvarez':['Aldiano Olaes','Barangay I','Barangay II','Barangay III','Barangay IV','Barangay V','Barangay VI','Barangay VII','Barangay VIII','Barangay IX','Benjamin Tirona','Eduardo Camerino','Francisco De Castro','General Lim','Maharlika','Marigondon','Tejero'],
  'General Trias City':['Alingaro','Arnaldo','Bacao I','Bacao II','Bagumbayan','Biclatan','Buenavista I','Buenavista II','Buenavista III','Corregidor','Dulong Bayan','Gov. Ferrer Poblacion I','Gov. Ferrer Poblacion II','Gov. Ferrer Poblacion III','Javalera','Manggahan','Navarro','Ninety Sixth','Panungyanan','Pasong Camachile I','Pasong Camachile II','Pasong Kawayan I','Pasong Kawayan II','Pinagtipunan','Prinza','San Francisco I','San Francisco II','San Juan I','San Juan II','Santiago','Tapia','Tejero','Vibora'],
  'Imus City':['Alapan I','Alapan II','Anabu I','Anabu II','Bagong Silang','Bayan Luma I','Bayan Luma II','Bayan Luma III','Bayan Luma IV','Bayan Luma V','Bayan Luma VI','Bayan Luma VII','Bayan Luma VIII','Bayan Luma IX','Carsadang Bago I','Carsadang Bago II','Magdalo','Malagasang I','Malagasang II','Mariana I','Mariana II','Medicion I','Medicion II','Palico I','Palico II','Palico III','Palico IV','Pasong Buaya I','Pasong Buaya II','Poblacion I','Poblacion II','Poblacion III','Poblacion IV','Poblacion V','Poblacion VI','Poblacion VII','Poblacion VIII','Tanzang Luma I','Tanzang Luma II','Tanzang Luma III','Tanzang Luma IV','Tanzang Luma V','Tanzang Luma VI','Toclong I','Toclong II','Toclong III'],
  'Tagaytay City':['Asisan','Bagong Tubig','Calabuso','Dapdap East','Dapdap West','Francisco','Guinhawa North','Guinhawa South','Iruhin Central','Iruhin East','Iruhin West','Kaybagal Central','Kaybagal East','Kaybagal North','Kaybagal South','Mag-asawang Ilat','Maharlika East','Maharlika West','Maitim 2nd Central','Maitim 2nd East','Maitim 2nd West','Mendez Crossing East','Mendez Crossing West','Neogan','Patutong Malaki North','Patutong Malaki South','Sambong','San Jose','Silang Junction North','Silang Junction South','Sungay East','Sungay West','Tolentino East','Tolentino West','Zambal'],
  'Trece Martires City':['Aguado','Cabezas','Cabuco','De Ocampo','Gregorio','Hugo Perez','Inocencio','Lapidario','Luciano','Perez','Poblacion I','Poblacion II','Poblacion III','San Agustin','Conchu'],
  'Alfonso':['Amayong','Barangay I','Barangay II','Barangay III','Barangay IV','Barangay V','Barangay VI','Barangay VII','Barangay VIII','Buck Estate','Kayquit I','Kayquit II','Kayquit III','Luksuhin','Luksuhin Ilaya','Mangas I','Mangas II','Pajo','Poblacion I','Poblacion II','Poblacion III','Sikat','Sulsugin','Taywanak Ibaba','Taywanak Ilaya','Upli'],
  'Amadeo':['Banaybanay','Barangay I','Barangay II','Barangay III','Barangay IV','Barangay V','Barangay VI','Barangay VII','Barangay VIII','Barangay IX','Barangay X','Barangay XI','Barangay XII','Barangay XIII','Barangay XIV','Barangay XV','Dagatan','Halang','Loma','Maitim','Manggahan','Poblacion','Talon','Tanggalan'],
  'Carmona':['Bancal','Jose Abad Santos','Lantic','Maduya','Mambog','Milagrosa','Poblacion','Salazar','San Roque'],
  'Indang':['Agus-os','Alulod','Banaba Cerca','Banaba Lejos','Bancod','Buna Cerca','Buna Lejos I','Buna Lejos II','Calumpang Cerca','Calumpang Lejos','Carasuchi','Daine I','Daine II','Guyam Malaki','Guyam Munti','Harasan','Kayquit','Limbon','Lumampong Balagbag','Lumampong Halayhay','Mahabang Kahoy Cerca','Mahabang Kahoy Lejos','Mataas na Lupa','Pulo','Tambo Balagbag','Tambo Kulit','Tambo Malaki','Tambo Munti','Toclong','Wakas I','Wakas II'],
  'Kawit':['Balsahan-Bisita','Batong Dalig','Binakayan-Aplaya','Binakayan-Kanluran','Congbalay-Lerma','Gahak','Kaingen','Magdalo','Manggahan','Marulas','Pulvorista','Putol','Recodo','Sagsakay','San Sebastian','Santa Isabel','Tabon I','Tabon II','Tabon III','Toclong','Tramo-Bantayan','Wakas I','Wakas II'],
  'Magallanes':['Barangay I','Barangay II','Barangay III','Barangay IV','Barangay V','Barangay VI'],
  'Maragondon':['Barangay I','Barangay II','Barangay III','Barangay IV','Barangay V','Barangay VI','Barangay VII','Barangay VIII','Barangay IX','Barangay X','Barangay XI','Barangay XII','Barangay XIII','Barangay XIV','Barangay XV'],
  'Mendez':['Anuling Lejos I','Anuling Lejos II','Anuling Cerca I','Anuling Cerca II','Avenida Rizal','Bangkay','Bucal I','Bucal II','Bucal III','Bucal IV','Carasuchi','Cayungan','Galicia I','Galicia II','Janagdag','Punta I','Punta II','San Isidro I','San Isidro II','San Jose','San Juan','San Pedro I','San Pedro II','Tanay I','Tanay II','Tanay III'],
  'Naic':['Bagong Kalsada','Halang','Humbac','Ibayo Estacion','Ibayo Silangan','Kanluran','Labac','Labac Uno','Mabolo','Makina','Malindong','Mataas na Lupa','Muzon','Navotas','Palangue I','Palangue II','Palangue III','Sabang','San Roque','Santulan','Sapa','Timalan Balsahan','Timalan Concepcion'],
  'Noveleta':['Magdiwang','Poblacion','San Antonio I','San Antonio II','San Jose I','San Jose II','San Juan I','San Juan II','San Rafael I','San Rafael II','Santa Rosa I','Santa Rosa II'],
  'Rosario':['Bagbag I','Bagbag II','Kanluran','Ligtong I','Ligtong II','Ligtong III','Ligtong IV','Muzon I','Muzon II','Poblacion I','Poblacion II','Sapa I','Sapa II','Sapa III','Sapa IV','Tejero','Wawa I','Wawa II','Wawa III'],
  'Silang':['Acacia','Anuling Lejos I','Anuling Lejos II','Anuling Cerca','Aranez','Batas','Biga I','Biga II','Biluso','Buho','Burol','Citin','Consolacion','Crossroads','Dalacan','Don Emilio Perez','Don Ernesto Perez','Don Pablo Perez','Esteban Cafe','General Lim','Inchican','Ipilan','Janaojanao','Lalaan I','Lalaan II','Litlit','Lucsuhin','Lumil','Maguyam','Malabag','Mataas na Lupa','Munting Ilog','Narra I','Narra II','Narra III','Paligawan','Pasong Langka','Pooc I','Pooc II','Puting Kahoy','Sabutan','San Miguel I','San Miguel II','San Vicente I','San Vicente II','Santa Rosa I','Santa Rosa II','Santol','Sulit','Sulsugin','Talon','Tibig','Tulos','Tungkod'],
  'Tanza':['Bagtas','Biga','Biwas','Bucal','Bunga','Calibuyo','Capipisa','Daang Amaya I','Daang Amaya II','Daang Amaya III','Julugan I','Julugan II','Julugan III','Julugan IV','Julugan V','Julugan VI','Julugan VII','Julugan VIII','Lambingan','Luyos','Mabiga','Makina','Mulawin','Punta I','Punta II','Sahud Ulan','Sanja Mayor','Santol','Sinala','Tres Cruses'],
  'Ternate':['Bucana','Poblacion I','Poblacion II','Poblacion III','San Jose'],
  // Laguna Province
  'Calamba City':['Barangay I','Barangay II','Barangay III','Barangay IV','Barangay V','Barangay VI','Barangay VII','Barangay VIII','Barangay IX','Bagong Kalsada','Batino','Bubuyan','Bucal','Bunggo','Burol','Came','Canlubang','Halang','Hornalan','Laguerta','Lawa','Lecheria','Lingga','Looc','Maitim','Majada Labas','Majada Out','Makiling','Mapagong','Masili','Maunong','Mayapa','Milagrosa','Paciano Rizal','Palingon','Palo-Alto','Pansol','Parian','Pittland','Putho Tuntungin','Real','Saimsim','Salamba','Sampaloc','San Cristobal','San Juan','Sirang Lupa','Sucol','Turbina','Ulango','Uno'],
  'Santa Rosa City':['Aplaya','Balibago','Caingin','Dila','Dita','Don Jose','Ibaba','Kanluran','Labas','Macabling','Malitlit','Malusak','Market Area','Pooc','Sinalhan','Tagapo'],
  'Binan City':['Binan','Canlalay','Casile','De La Paz','Ganado','Langkiwa','Loma','Malaban','Nangka','Platero','Poblacion','San Antonio','San Francisco','San Jose','San Vicente','Santo Tomas','Soro-soro','Timbao','Tubigan','Zapote'],
  'Cabuyao City':['Baclaran','Banay-banay','Banlic','Bigaa','Butong','Casile','Diezmo','Gulod','Mamatid','Marinig','Niugan','Pittland','Pulo','San Isidro','Sala','Sampiruhan'],
  'San Pablo City':['Bagong Buhay I','Bagong Buhay II','Bagong Buhay III','Del Remedio','Dolores','San Bartolome','San Buenaventura','San Crispin','San Cristobal','San Diego','San Francisco','San Gabriel I','San Gabriel II','San Gregorio','San Ignacio','San Isidro','San Jose','San Juan','San Lorenzo','San Lucas I','San Lucas II','San Marcos','San Mateo','San Miguel','San Nicolas I','San Nicolas II','San Pedro','San Roque','San Salvador','Santa Catalina Norte','Santa Catalina Sur','Santa Elena','Santa Filomena','Santa Isabel','Santa Maria','Santa Monica','Santa Veronica','Santiago I','Santiago II','Santo Angel Central','Santo Angel Norte','Santo Angel Sur','Santo Cristo Norte','Santo Cristo Sur','Santo Nino Norte','Santo Nino Sur'],
  'San Pedro City':['Bagong Silang','Calendola','Cuyab','Estrella','Langgam','Laram','Magsaysay','Narra','New San Pedro','Pacita I','Pacita II','Poblacion','Riverside','Sampaguita','San Antonio','Unidos','Unitown'],
  'Los Banos':['Anos','Bagong Silang','Bambang','Batong Malake','Baybayin','Bayog','Lalakay','Maahas','Malinta','Mayondon','Putho-Tuntungin','San Antonio','San Jose','Santo Tomas','Tadlak','Timugan'],
  'Santa Cruz':['Barangay I','Barangay II','Barangay III','Barangay IV','Barangay V','Barangay VI','Barangay VII','Barangay VIII','Bubukal','Calios','Duhat','Gatid','Ibaba','Kanluran','Labuin','Malinao','Pagsawitan','Palayan','Poblacion','San Juan','Santisima Cruz','Santo Angel','Santo Cristo','Taytay','Wawa'],
  'Alaminos':['Barangay I','Barangay II','Barangay III','Barangay IV','Barangay V','Barangay VI','Barangay VII','Barangay VIII','Barangay IX','Barangay X'],
  'Calauan':['Bangyas','Dayap','Hanggan','Imok','Mabacan','Masiit','May-It','Pansol','Prinza','San Isidro','San Miguel','Turbina'],
  // Batangas Province
  'Batangas City':['Alangilan','Bagong Tubig','Balagtas','Balete','Banaba Center','Banaba East','Banaba Ibaba','Banaba West','Birinayan','Bolbok','Bukal','Calicanto','Conde Labak','Cumba','Cuta','Dalig','Dela Paz','Dela Paz Pulot Center','Dela Paz Pulot Itaas','Domoclay','Gulod Itaas','Gulod Labak','Ilijan','Kumintang Ibaba','Kumintang Ilaya','Libjo','Liponpon','Lon-oh','Luquin','Maapas','Mabacong','Malibayo','Malitam','Maruclap','Malalim','Natunuan North','Natunuan South','Pallocan East','Pallocan West','Pinamucan','Pinamucan East','Pinamucan West','Punta','San Agapito','San Agustin Kanluran','San Agustin Silangan','San Andres','San Antonio','San Isidro','San Jose Sico','San Miguel','San Pedro','Santo Domingo','Santo Tomas','Simlong','Sirang Lupa','Sta. Clara','Sta. Rita Aplaya','Sta. Rita Karsada','Sto. Nino','Sto. Tomas','Tabangao Aplaya','Tabangao Dao','Tabangao-Ambulong','Talahib Pandayan','Talahib Payapa','Talumpok East','Talumpok West','Tingga Itaas','Tingga Labak','Tulo','Wawa'],
  'Lipa City':['Adya','Anilao-Labac','Anilao-Taytay','Balintawak','Banaybanay','Bolbok','Buli','Dagatan','Duhatan','Halang','Inosluban','Kayumanggi','Landayan','Langgaan','Luyos','Mabini','Malagonlong','Malitlit','Marawoy','Mataas na Lupa','Munting Pulo','Pagolingin Bata','Pagolingin East','Pagolingin West','Pangao','Pinagkawitan','Pinagtongulan','Plaridel','Poblacion Balagtas','Poblacion Bigaa','Poblacion Ibaba','Poblacion Ilaya','Poblacion Kayumanggi','Poblacion Mabini','Poblacion Malitlit','Poblacion San Carlos','Poblacion Sampaguita','Pulong Anahao','Pusil','Quezon','Rizal','Sabang','Sampaguita','San Benito','San Carlos','San Celestino','San Francisco','San Guillermo','San Jose','San Lucas','San Pablo','San Pedro','Santiago','Santo Tomas','Sico','Talisay','Tambo','Tibig','Tipacan'],
  'Tanauan City':['Altura Bata','Altura Matanda','Anastacia','Bagbag','Bagumbayan','Balele','Banjo East','Banjo West','Bilog-Bilog','Boot','Cale','Calsada','Cubamba','Darasa','Gonzales','Hidalgo','Janopol','Janopol Oriental','Laurel','Leynes','Lodlod','Luyos','Mabini','Malaking Pulo','Maria Paz','Mataas Na Kahoy','Matingain I','Matingain II','Nangkaan','Pagaspas','Pantay Matanda','Pantay Bata','Paragahan','Pinagtungulan','Poblacion I','Poblacion II','Poblacion III','Putol','Raf-Raf','Randang Pala','Sambat','San Jose','Santor','Ulango','Wawa'],
  'Santo Tomas':['Barangay I','Barangay II','Barangay III','Barangay IV','Barangay V','Barangay VI','Barangay VII','Barangay VIII','Barangay IX','Barangay X','Barangay XI','Barangay XII','Barangay XIII','Barangay XIV','Barangay XV','Barangay XVI','Barangay XVII','Barangay XVIII','Barangay XIX','Barangay XX'],
  'Balayan':['Barangay I','Barangay II','Barangay III','Barangay IV','Barangay V','Barangay VI','Barangay VII','Barangay VIII','Barangay IX','Barangay X','Barangay XI','Barangay XII','Barangay XIII','Barangay XIV','Barangay XV','Barangay XVI','Barangay XVII','Barangay XVIII'],
  'Nasugbu':['Bilaran','Bucana','Bunducan','Butucan','Calayo','Catandaan','Cogunan','Dayap Itaas','Dayap Calauit','Labac','Looc','Lumbangan','Malapad na Bato','Maugat East','Maugat West','Munting Indan','Natipuan','Papaya','Poblacion','Reparo','Tumalim','Utod','Wawa'],
  // Quezon Province
  'Lucena City':['Barangay I','Barangay II','Barangay III','Barangay IV','Barangay V','Barangay VI','Barangay VII','Barangay VIII','Barangay IX','Barangay X','Dalahican','Domoit Kanluran','Domoit Silangan','Gulang-Gulang','Ibabang Dupay','Ibabang Iyam','Ibabang Talim','Ilayang Dupay','Ilayang Iyam','Ilayang Talim','Isabang','Market Area','Mayao Castillo','Mayao Crossing','Mayao Kanluran','Mayao Parada','Mayao Silangan','Ransohan','Salinas','Talao-Talao'],
  'Tayabas City':['Alitao','Alsam Ibaba','Alsam Ilaya','Amontay','Anos','Ayusan I','Ayusan II','Baguio','Banilad','Bukal Ibaba','Bukal Ilaya','Bulo','Bungoy','Cagacag','Cagsiay I','Cagsiay II','Cagsiay III','Camaysa','Dapdap','Domoit','Gibanga','Ibas','Ilasan','Ipilan','Isabang','Katimo','Kinatakutan','Kulawit','Lakawan','Lalo','Lammac','Lapolapo I','Lapolapo II','Lapolapo III','Lita','Maglipad','Magsaysay','Maguibuay','Mahuwag','Malaoa','Masin Norte','Masin Sur','Mateuna','Mayowe','Opias','Palale','Pook','Potol','San Diego Ibaba','San Diego Ilaya','San Francisco','San Isidro','Tiaong','Tiburcio Hillario','Tinagpan','Tinugtogan','Tuhian','Ulango'],
  'Candelaria':['Buenavista','Bukal Norte','Bukal Sur','Kinatakutan','Masin Norte','Masin Sur','Pansol','Poblacion Ilaya','Poblacion Ibaba','San Andres','San Isidro Norte','San Isidro Sur','San Jose','San Roque','Santa Catalina Norte','Santa Catalina Sur','Sta. Cruz','Sto. Cristo'],
  // Bulacan Province
  'Malolos City':['Anilao','Atlag','Babatnin','Bagna','Balayong','Balite','Bangkal','Barihan','Bulihan','Bungahan','Caingin','Calero','Calizon','Canate','Catmon','Cofradia','Dakila','Guinhawa','Ligas','Liyang','Longos','Look 1st','Look 2nd','Lugam','Mabolo','Malusak','Masile','Matimbo','Mojon','Namtutan','Niugan','Pamarawan','Panasahan','Pinagbakahan','San Agustin','San Gabriel','San Juan','San Pablo','Santa Ines','Santiago','Santo Nino','Santo Rosario','Santol','Sumapang Bata','Sumapang Matanda','Taal','Tikay'],
  'Meycauayan City':['Bagbaguin','Bahay Pare','Bancal','Banga','Bayugo','Caingin','Calvario','Camalig','Gasak','Hulo','Iba','Langka','Lawa','Libtong','Liputan','Longos','Malhacan','Pajo','Pantoc','Perez','Poblacion','Saluysoy','St. Francis','Tugatog','Ubihan','Zamora'],
  'San Jose del Monte City':['Bagong Buhay I','Bagong Buhay II','Bagong Buhay III','Citrus','Dulong Bayan','Francisco Homes I','Francisco Homes II','Francisco Homes III','Fatima I','Fatima II','Fatima III','Fatima IV','Fatima V','Gaya-gaya','Graceville','Gumaoc Central','Gumaoc East','Gumaoc West','Kaybanban','Kaypian','Lawang Pari','Maharlika','Minuyan I','Minuyan II','Minuyan III','Minuyan IV','Minuyan V','Minuyan Proper','Paradise III','Poblacion','Sapang Palay','Sapang Palay Proper','St. Martin I','St. Martin II','St. Martin III','St. Martin IV','Sto. Cristo','Sto. Nino I','Sto. Nino II','Sto. Nino III','Sto. Nino IV','Tungkong Mangga'],
  'Marilao':['Abangan Norte','Abangan Sur','Ibayo','Lambakin','Lias','Loma de Gato','Nagbalon','Patubig','Poblacion I','Poblacion II','Saog','Tabing Ilog'],
  'Bocaue':['Antipona','Bagumbayan','Batia','Binuangan','Bukid','Calvario','Canalate','Caret','Catmon','Diliman I','Diliman II','Kinalaglagan','Lolomboy','Poblacion','Pulong Bayabas','Sapang Baho','Sulucan','Turo'],
  'Balagtas':['Balagtas Proper','Buko','Burol','Gatbuca','Guinhawa','Longos','Palanas','Santol','Wawa'],
  'Baliuag':['Bagong Nayon','Barangca','Calantipay','Catulinan','Concepcion','Hinukay','Makinabang','Pagala','Paitan','Piel','Pinagbarilan','Poblacion','San Jose','San Roque','Santa Barbara','Santo Cristo','Subic','Sulivan','Tangos','Tarcan','Tiaong','Tibag','Tibagan','Virgoneza'],
  'Bulacan':['Balagtas','Balasing','Bambang','Matungao','Maysantol','Perez','Poblacion','San Francisco','San Jose','Santa Ines'],
  'Bustos':['Camachile','Kapalangan','Lepanto','Meyto','Panginay','Palahanan I','Palahanan II','San Juan','Santa Catalina','Talampas'],
  'Calumpit':['Balite','Balungao','Calizon','Corazon','Gatbuca','Guiginto','Iba Este','Iba Ote','Lambakin','Longos','Poblacion','Pungo','San Jose Norte','San Jose Sur','San Pedro','Santo Nino','Sapang Bayan','Wakas Norte','Wakas Sur'],
  'Guiguinto':['Cutcut','Daungan','General Baldomero Lim','Malis','Panginay','Poblacion','Santa Cruz','Santo Cristo','Tabing Ilog','Tiaong'],
  'Hagonoy':['Iba','Iba-Ibayo','Palimbo-Caguisitan','Palimbo-Proper','Pinalagdan','Sagrada Familia','San Agustin','San Antonio','San Isidro','San Jose','San Juan','San Pascual','San Pedro','Santiagopoblacion','Santo Cristo','Santo Rosario','Subic'],
  'Norzagaray':['Bangkal','Bigte','Friendship','Minuyan','Partida','Poblacion','San Lorenzo','San Mateo'],
  'Obando':['Binuangan','Catanghalan','Hulo','Paco','Paliwas','Panghulo','Salambao','San Pascual','Tawiran'],
  'Pandi':['Bagong Buhay','Baka-Bakahan','Bunsuran I','Bunsuran II','Bunsuran III','Cacarong Bata','Cacarong Matanda','Cupang','Malibong Bata','Malibong Matanda','Manatal','Mapulang Lupa','Masagana','Mawaklat','Poblacion','San Roque','Santa Cruz','Santo Nino','Siling Bata','Siling Matanda'],
  'Plaridel':['Agnaya','Bangkal','Banga I','Banga II','Bintog','Culianin','Dampol I','Dampol II A','Dampol II B','Gandus','Lumang Bayan','Parulan','Poblacion','Pungo','San Juan','Santa Ines','Santol','Sumaging','Talacsan','Talapitan','Tali','Toril'],
  'Pulilan':['Balatong A','Balatong B','Cutcot','Dampol','Dulong Malabon','Inaon','Longos','Lumbac','Paltao','Penabatan','Poblacion','Santo Cristo','Taal','Tabon','Tibag','Tinejero'],
  'San Ildefonso':['Akle','Alagao','Anyatam','Bagong Buhay','Bagong Sikat','Basuit','Bulac','Burol','Capipis','Caratagan','Divisoria','Kapalangan','Lictingan','Malabon','Malipampang','Mataas na Parang','Pugad','Pulong Tamo','San Juan','Santo Cristo','Sapang Bulak','Sapang Palay','Sibul','Tartaro','Tibag'],
  'San Miguel':['Alagao','Alcala','Bagong Buhay','Bahay Pare','Biclat','Buga','Buliran Norte','Buliran Sur','Calabuyan','Camangyanan','Camias','Ibd Site','Kayang','Labi','Lagundi','Lico','Mabuhay','Manigang','Mapangpang','Masapang','Pacalag','Paliwasan','Pantoc','Penaranda','Pinambaran','Pulong Bayabas','Sacdalan','Sapang Baluktot','Sapang Buho','Sibul','Siling Bata','Siling Matanda','Siling Norte','Siling Sur','Solar','Tigpalas'],
  'San Rafael':['Cabiangan','Camias','Liciada','Maasim','Mabalas-balas','Maguinao','Maronquillo','Paco','Paombong','Pasong Bangkal','Poblacion','San Agustin','San Jose','Santo Cristo','Ulingao'],
  'Santa Maria':['Balasing','Buenavista','Bulac','Catmon','Cay Pombo','Caysio','Guyong','Lalakhan','Mag-asawang Sapa','Mahabang Parang','Manggahan','Parada','Poblacion','Pulong Buhangin','San Gabriel','San Jose','Santo Cristo','Santo Nino','Silangan','Tumana'],
  // Pampanga Province
  'Angeles City':['Agapito del Rosario','Anunas','Balibago','Capaya','Claro M. Recto','Cuayan','Cutcut','Cutud','Lourdes Norte','Lourdes Sur','Lourdes Sur East','Malabanias','Margot','Mining','Ninoy Aquino','Pampang','Pandan','Pulung Cacutud','Pulung Maragul','Salapungan','San Jose','San Nicolas','Santa Teresita','Santa Trinidad','Santo Cristo','Santo Domingo','Santo Rosario','Sapalibutad','Sapangbato','Tabun','Virgen Delos Remedios'],
  'San Fernando City':['Alasas','Baliti','Bulaon','Calulut','Dela Paz Norte','Dela Paz Sur','Del Carmen','Del Pilar','Del Rosario','Dolores','Juliana','Lara','Lourdes','Magliman','Maimpis','Malino','Malpitic','Pandaras','Panipuan','Pulung Bulu','Quebiawan','Saguin','San Agustin','San Felipe','San Isidro','San Jose','San Juan','San Nicolas','San Pedro','Santa Lucia','Santa Teresita','Santo Nino','Santo Rosario','Sindalan','Telabastagan'],
  'Mabalacat City':['Atlu-Bola','Bical','Bundagul','Cacutud','Calumpang','Camachiles','Capitangan','Caruncho','Dau','Dolores','Duquit','Lakandula','Mabiga','Mabulac','Magalang','Mamatitang','Mangalit','Marcos Village','Mawaque','Paralayunan','Poblacion','San Francisco','San Joaquin','Santa Ines','Santa Maria','Santo Rosario','Sapang Balen','Sapang Biabas','Tabun'],
  'Apalit':['Balucuc','Calantipe','Cansinala','Capalangan','Colgante','Paligui','Sampaloc','San Juan','San Vicente','Sucad','Sulipan','Tabuyuc'],
  'Arayat':['Arenas','Baliti','Batasan','Buensuceso','Candating','Gatiawin','Guemasan','La Paz','Lacquios','Mangalit','Maniago','Namulandayan','Palinlang','Paralaya','Poblacion','San Agustin Norte','San Agustin Sur','San Antonio','San Jose Norte','San Jose Sur','San Matias','San Nicolas','San Roque Arenas','San Roque Bitas','Santa Ana','Santa Catalina','Santa Cruz','Santa Maria','Santo Rosario Poblacion','Santo Rosario Tabuan','Suclayin','Telapayong'],
  'Candaba':['Bahay Pare','Balas','Balsik','Bamban','Bangkal','Bulaon','Bulsa','Camba','Capalangan','Colgante','Gulap','Lanang','Lourdes','Mabiga','Mandasig','Mangilag Norte','Mangilag Sur','Masapocan','Niugan','Palimpe','Pando','Paralaya','Poblacion','San Agustin','San Antonio','San Isidro Norte','San Isidro Sur','San Jose','San Pedro','San Roque','San Vicente','Santa Monica','Santo Rosario','Tagulod','Talang','Tenejero','Tigbe','Vizal San Pablo','Vizal Santo Cristo'],
  'Guagua':['Ascomo','Bancal','Ban-ban','Betis','Brgy. 1','Brgy. 2','Brgy. 3','Brgy. 4','Brgy. 5','Brgy. 6','Brgy. 7','Brgy. 8','Imas I','Imas II','Kaming','Lambac','Malusac','Moras de la Paz','Murla','Natividad','Palimpe','Pias','Pitombayog','Pulungbulo','Pulungmasle','Rizal','San Agustin','San Antonio','San Isidro','San Jose','San Juan','San Matias','San Miguel','San Nicolas','San Pablo Libutad','San Pablo Proper','San Pedro','San Vicente','Santa Filomena','Santa Ines','Santa Ursula','Santo Nino','Santo Rosario'],
  'Floridablanca':['Anon','Apalit','Bodega','Cabangcalan','Calantas','Carmencita','Consuelo','Dampe','Del Carmen','Dolores','San Antonio','San Carlos','San Isidro','San Jose','San Nicolas','San Pedro','San Ramon','San Roque','Santa Monica','Santo Rosario','Solib','Valdez'],
  // Tarlac Province
  'Tarlac City':['Aguso','Alvindia Segundo','Amucao','Armenia','Asturias','Atioc','Balete','Balibago I','Balibago II','Banaba','Bantog','Baras-baras','Batang-batang','Binauganan','Bora','Buenavista','Burot','Calingcuan','Capehan','Carangian','Care','Central','Culipat','Cut-cut I','Cut-cut II','Dalayap','Dela Paz','Dolores','Lara','Ligtasan','Lourdes','Mabilog','Mabini','Maliwalo','Mapalacsiao','Mapalad','Namnama','Navotas','Paraiso','Pinian','Poblacion','Salapungan','San Carlos','San Francisco','San Isidro','San Jose','San Luis','San Manuel','San Miguel','San Nicolas','San Pablo','San Rafael','San Roque','San Sebastian','San Vicente','Santa Cruz','Santa Maria','Santo Cristo','Santo Nino','Sapang Maragul','Sapang Tagalog','Sepung Calzada','Sinait','Suizo','Tariji','Trinidad','Ungot','Victoria'],
  'Capas':['Aranguren','Bueno','Cristo Rey','Cubcub','Cutcut II','Dolores','Estrada','Lawy','Lingo','Manga','Maruglu','Nueva Era','O\'Donnell','Sto. Domingo I','Sto. Domingo II','Talaga','Versalles','Villa Militar','Sta. Juliana','Sta. Lucia','Sta. Rita'],
  // Zambales Province
  'Olongapo City':['Asinan','Bajac-Bajac','Balangkas','Banicain','Barreto','East Bajac-Bajac','Gordon Heights','Kalaklan','Mabayuan','New Cabalan','New Ilalim','New Kababae','New Kalalake','Old Cabalan','Pag-asa','Santa Rita','West Bajac-Bajac'],
  'Subic':['Aningway Sacatihan','Asinan','Baraca-Camachile','Batiawan','Calapacuan','Calubian','Cawag','Ilwas','Mangan-Vaca','Matain','Naugsol','Pamatawan','San Isidro','Santo Tomas','Wawandue'],
  // Nueva Ecija
  'Cabanatuan City':['Aduas Centro','Aduas Norte','Aduas Sur','Bagong Buhay I','Bagong Buhay II','Bagong Buhay III','Bakero','Bakod Bayan','Balite','Bangad','Bantug Norte','Bantug Sur','Barlis','Barrera District','Bibiclat','Bonifacio District','Bungad','Cabu','Campo','Caridad','Communal','Cruz Roja','Daang Sarile','Dalampang','Dicarma','Dionisio S. Garcia','Fatima','General Luna','Ibabao-Bungad','Imelda District','Isla','Kapitan Pepe','Kalikid Norte','Kalikid Sur','Magsaysay District','Mabini Extension','Mabini Homesite','Maharlika','Maliwalo','Manggahan','Maot','Mapayapa Village I','Mapayapa Village II','Maria Theresa','Matadero','Meiling','Obrero','Pag-asa','Pagas','Pantoc','Plaridel','Pula','Puto Bumbong','Quezon District','Rizal','Saranay','Sumacab Este','Sumacab Norte','Sumacab Sur','Valle Cruz','Valdefuente','Valle'],
  'Gapan City':['Baloc','Bayanihan','Buliran','Bungo','Burnay','Camba','Cuyapo','Mahipon','Pias','Poblacion Norte','Poblacion Sur','San Isidro','San Roque','San Vicente'],
  // Ilocos Region
  'Laoag City':['Barangay I','Barangay II','Barangay III','Barangay IV','Barangay V','Barangay VI','Barangay VII','Barangay VIII','Barangay IX','Barangay X','Barangay XI','Barangay XII','Barangay XIII','Barangay XIV','Barangay XV','Barangay XVI','Barangay XVII','Barangay XVIII','Barangay XIX','Barangay XX','Barangay XXI','Barangay XXII','Barangay XXIII','Barangay XXIV','Barangay XXV','Barangay XXVI','Barangay XXVII','Barangay XXVIII','Barangay XXIX','Barangay XXX','Barangay XXXI','Barangay XXXII','Barangay XXXIII','Barangay XXXIV','Barangay XXXV','Barangay XXXVI','Barangay XXXVII','Barangay XXXVIII','Barangay XXXIX','Barangay XL'],
  'Vigan City':['Ayusan Norte','Ayusan Sur','Barangay I','Barangay II','Barangay III','Barangay IV','Barangay V','Barangay VI','Barangay VII','Barangay VIII','Barangay IX','Barangay X','Cabalangegan','Cabaroan Daya','Cabaroan Laud','Camangaan','Capangpangan','Mindoro','Nagsangalan','Pantay Daya','Pantay Fatima','Pantay Laud','Paoa','Paratong','Pong-ol','Purok-a-Bassit','Purok-a-Dackel','Raois','Rugsuanan','Salindeg','San Jose','San Julian Norte','San Julian Sur','San Pedro','Tamag'],
  'Candon City':['Allangigan Primero','Allangigan Segundo','Amguid','Ayaoan','Bagani Camposanto','Bagani Gabor','Bagani Halog','Bagani Tocgo','Bagani Ubbog','Bagar','Balingaoan','Baliw','Bayubay Norte','Bayubay Sur','Bobon Caoayan','Bobon Capangpangan','Bobon Lourdes','Bobon San Antonio','Bobon Uno','Bungro','Cabaroan','Cabugao','Caburao','Cabuloan','Camandingan','Camangaan','Caparacadan','Caterman','Cato','Cervantes','Collago','Crugna','Damacuag','Ducob','Gayusan','Lintic','Looney','Lussoc','Manga','Nalsian Norte','Nalsian Sur','Palacapac','Pang-pang','Paratong Norte','Paratong Tres','Paratong Uno','Paratong Quatro','San Agustin','San Andres','San Antonio','San Isidro Norte','San Isidro Sur','San Jose Norte','San Jose Sur','San Juan','San Nicolas','San Pedro','Santa Cruz','Santa Lucia','Santo Tomas','Tablac','Talogtog','Tamurong','Tonoton'],
  // Region VII - Additional Cebu Cities
  'Lapu-Lapu City':['Agus','Babag','Bankal','Baring','Basak','Buaya','Canjulao','Caubian','Caw-oy','Cordova','Gun-ob','Ibo','Looc','Mactan','Maribago','Marigondon','Pajac','Pajo','Punta Engano','Pusok','Sabang','Santa Rosa','Subabasbas','Talima','Tingo','Tungasan'],
  'Mandaue City':['Alang-Alang','Bakilid','Banilad','Basak','Cambaro','Canduman','Casili','Casuntingan','Centro','Cubacub','Guizo','Ibabao-Estancia','Jagobiao','Labogon','Looc','Maguikay','Mantuyong','Opao','Pakna-an','Pagsabungan','Pokuna','Subangdaku','Tabok','Tawason','Tingub','Tipolo','Umapad'],
  'Talisay City':['Biasong','Bulacao','Cadulawan','Cansojong','Dumlog','Jaclupan','Lagtang','Lawaan I','Lawaan II','Lawaan III','Linao','Maghaway','Manipis','Mohon','Poblacion','Pooc','San Isidro','San Roque','Tabunok','Tangke'],
  'Toledo City':['Awihao','Bagakay','Balonga','Basak','Bunga','Cabitoonan','Calongcalong','Cambang-ug','Camp 8','Canlumampao','Cantabaco','Capitan Lorenzo','Daanglungsod','Don Andres Soriano','Dumlog','Ilihan','Juan Climaco Sr.','Landahan','Loay','Luray II','Matab-ang','Media Once','Pangamihan','Poblacion','Poog','Putlongon','Sagay','Sam-ang','Sangi','Santo Nino','Subayon','Talavera','Tilod','Tuburan'],
  'Danao City':['Baliang','Binaliw','Cabungahan','Cagat-Lamac','Cahumayan','Cambanay','Cambubho','Cogon-Cruz','Danasan','Dunggo','Dungo-an','Guinsay','Ibo','Langosig','Lawaan','Licos','Looc','Lugo','Managase','Marcos','Pagsabungan','Patag','Poblacion','Sabang','Suba','Sulangan','Sungay','Taytay','Trinidad','Tuburan','Uling'],
  // Region XI - Davao
  'Tagum City':['Apokon','Bincungan','Busaon','Canocotan','Cuambogan','La Filipina','Liboganon','Madaum','Magdum','Magugpo East','Magugpo North','Magugpo Poblacion','Magugpo South','Magugpo West','Mankilam','New Balamban','Nueva Fuerza','Pagsabangan','Pandaitan','Quezon','San Agustin','San Isidro','San Miguel','Santo Nino','Visayan Village'],
  'Panabo City':['A.O. Florentino','Buenavista','Datu Abdul Dadia','Gredu','J.P. Laurel','Kakar','Katipunan','Langcoan','Mabunao','Maduao','Malativas','Manay','Nanyo','New Malaga','New Pandan','New Visayas','Quezon','Salvacion','San Francisco','San Nicolas','San Pedro','San Roque','San Vicente','Santo Nino','Sto. Tomas','Tibungol'],
  'General Santos City':['Apopong','Baluan','Batomelong','Buayan','Bula','Calumpang','City Heights','Conel','Dadiangas East','Dadiangas North','Dadiangas South','Dadiangas West','Fatima','Katangawan','Labangal','Lagao','Ligaya','Mabuhay','Olympog','San Isidro','San Jose','Sinawal','Tambler','Tinagacan','Upper Labay'],
  'Digos City':['Aplaya','Balabag','Binaton','Cogon','Colorado','Ruparan','San Agustin','San Jose','San Miguel','San Roque','Santa Cruz','Santa Maria','Sinawilan','Soong','Tiguman'],
  // Region XII
  'Koronadal City':['Assumption','Avanceña','Cacub','Caloocan','Carpenter Hill','Concepcion','General Paulino Santos','Mabini','Magsaysay','Namnama','New Pangasinan','Paraiso','Poblacion','San Isidro','San Jose','Saravia','Zone I','Zone II','Zone III'],
  'Tacurong City':['Baras','Buenaflor','Calean','F. Cajelo','Griño','Imao','Kakar','Katinon','Lancheta','Lapu','Lower Katungal','Magon','Matin-ao','New Isabela','New Lagao','New Passi','Rajah Muda','San Emmanuel','San Mateo','San Pablo','Santo Nino','Sudapin','Upper Katungal'],
  // CARAGA
  'Butuan City':['Agao','Ambago','Amparo','Ampayon','Anticala','Antongalon','Aupagan','Baan KM 3','Baan Riverside','Babag','Bading','Bancasi','Banza','Baobaoan','Basag','Bayanihan','Bilay','Bit-os','Bitan-ag','Bobon','Bonbon','Bugabus','Bugsukan','Buhangin','Cabcabon','Camayahan','Dagohoy','Dankias','De Oro','Diego Silang','Don Francisco','Doongan','Dulag','Dumalagan','Florida','Kinamlutan','Lemon','Libertad','Limaha','Los Angeles','Lumbocan','Maguinda','Mahay','Mahogany','Maibu','Mandamo','Maon','Masao','Maug','Montivista','Ong Yiu','Pagatpatan','Pangabugan','Pinamanculan','Port Poyohon','Rajah Soliman','Salvacion','San Ignacio','San Mateo','San Vicente','Sikatuna','Silongan','Sumilihon','Tagabaca','Taguibo','Taligaman','Tiniwisan','Tungao','Urduja','Villa Kananga'],
  'Cabadbaran City':['Calibunan','Caasinan','Colonia','Compostela','Corocotan','Corongcoron','Datu','Doña Carmen','Katugasan','Lagtang','Mahaba','Poblacion I','Poblacion II','Poblacion III','Poblacion IV','Poblacion V','Poblacion VI','Poblacion VII','Poblacion VIII','Poblacion IX','Poblacion X','Poblacion XI','Poblacion XII','Poblacion XIII'],
  'Surigao City':['Anomar','Bilabid','Buenavista','Canlanipa','Canlasid','Dao','Ipil','Lisondra','Luna','Mat-i','Sabang','San Juan','San Roque','Taft','Togbongon','Tugas','Washington'],
  'Tandag City':['Awasian','Bag-ong Lungsod','Barangay I','Barangay II','Barangay III','Barangay IV','Barangay V','Barangay VI','Barangay VII','Barangay VIII','Barangay IX','Barangay X','Barangay XI','Bagong Silang','Bongtod','Buenavista','Dao','Mabua','Mabuhay','Mahanub','Salvacion'],
  // Mindanao - Region X
  'Iligan City':['Abuno','Acmac','Bagong Silang','Bonbonon','Bunawan','Buru-un','Dalipuga','Del Carmen','Digkilaan','Ditucalan','Dulag','Hinaplanon','Hindang','Kabacsanan','Kalilangan','Kiwalan','Lanipao','Luinab','Mahayahay','Mainit','Mandulog','Maria Cristina','Palao','Panoroganan','Poblacion','Puga-an','Rogongon','San Miguel','San Roque','Santiago','Santo Rosario','Saray','Suarez','Tambacan','Tibanga','Tipanoy','Tominobo Ibaba','Tominobo Ilaya','Tubod','Ubaldo Laya','Upper Hinaplanon','Villa Verde'],
  'Valencia City':['Bagontaas','Banlag','Batangan','Catumbalon','Colonia','Concepcion','Dagat-Dagatan','Guinoyuran','Kahapunan','Laligan','Lilingayon','Linabo','Lumbo','Maapag','Manalog','Matingao','Merangeran','Mt. Nebo','Nabago','Paitan','Palacapao','Pinatilan','Poblacion','San Carlos','San Isidro','Sugod','Tankulan','Tongantongan'],
  'Ozamiz City':['Bacolod','Bagakay','Baybay Santa Cruz','Baybay Triunfo','Bongbong','Calabayan','Capucao C.','Capucao P.','Catadman','Cavinte','Cogon','Corrales','Dalapang','Doña Consuelo','Doongan','Kinuman Norte','Kinuman Sur','Lam-an','Lapasan','Liposong','Litapan','Malaubang','Manaka','Maningcol','Maranat','Molicay','Naga','Ozamiz City Proper','Pines','Pulot','San Antonio','San Jose','Tinago','Triunfo'],
  // Region IX
  'Zamboanga City':['Arena Blanco','Ayala','Baliwasan','Baluno','Boalan','Bolong','Buenavista','Bunguiao','Busay','Cabaluay','Cabatangan','Cacao','Calabasa','Calarian','Camino Nuevo','Campo Islam','Campo Uno','Campo Dos','Campo Tres','Carmen','Cawit','Cob-Cob','Colon','Coneha','Culianan','Dita','Divisoria','Dumagat','Dulian Lower','Dulian Upper','Guiwan','Kagay','Kalonong','Kasanyangan','La Paz','Labuan','Lacasanao','Limpapa','Lubigan','Lumayang','Lumbangan','Lunzuran','Maasin','Malagutay','Mampang','Manalipa','Mariki','Mazauer','Mercedes','Moret','Muti','Pag-asa','Pamucutan','Pangpang','Panubigan','Pasilmanta','Pasobolong','Patalon','Penancula','Pettit Barracks','Putik','Recodo','Rio Hondo','Sacol','Salaan','San Jose Cawa-cawa','San Jose Gusu','San Roque','San Vicente','Sangali','Santa Barbara','Santa Catalina','Santa Maria','Santo Nino','Sinunoc','Sta. Catalina','Talon-talon','Taluksangay','Tetuan','Tictapul','Tigbalabag','Tigtabon','Tolosa','Tugbungan','Tumaga','Tumalutab','Tuminobo','Victoria','Vitali','Waling-waling','Zambowood'],
  // Bicol Region
  'Naga City':['Abella','Bagumbayan Norte','Bagumbayan Sur','Balatas','Calauag','Cararayan','Carolina','Concepcion Grande','Concepcion Pequena','Dinaga','Igualdad Interior','Lerma','Liboton','Mabolo','Pacol','Panicuason','Penaranda','Sabang','San Felipe','San Francisco','San Isidro','Santa Cruz','Tabuco','Tinago','Triangulo'],
  'Legazpi City':['Arimbay','Bagacay','Banquerohan','Barangay 1','Barangay 2','Barangay 3','Barangay 4','Barangay 5','Barangay 6','Barangay 7','Barangay 8','Barangay 9','Barangay 10','Barangay 11','Barangay 12','Barangay 13','Barangay 14','Barangay 15','Barangay 16','Barangay 17','Barangay 18','Barangay 19','Barangay 20','Barangay 21','Bitano','Bonot','Buyuan','Cabagaan','Bonga','Cruzada','Dap-dap','Estanza','Gogon','Homapon','Ilaor Norte','Ilaor Sur','Imalnod','Kapantawan','Kilikao','Padang','Pawa','Rawis','Sagpon','Saluday','San Joaquin','San Miguel','San Pedro','Pinaric','Tagas','Tinago','Tulas','Tulapos'],
  'Iloilo City':['Adgao','Aguinaldo','Alabang','Arevalo','Balantang','Baldoza','Batiano','Bito-on','Bolilao','Bonifacio','Buhang','Buntatala','Burgos-Mabini-Plaza','Camalig','City Proper','Compania','Costa Sur','Cubay Norte','Cubay Sur','Cuartero','Daldalon','Democracia','Desamparados','Dungon','Dungon A','Dungon B','East Baluarte','East Timawa','Edganzon','El 98','Fajardo','Gustilo','Hibao-an Norte','Hibao-an Sur','Hinactacan','Hipodromo','Inday','Ingore','Jibao-an','La Paz','Laguda','Lapuz Norte','Lapuz Sur','Leganes','Libertad','Libertad Weste','Loboc','Lopez Jaena Norte','Lopez Jaena Sur','Luna','Maasin','Macasandig','Mansaya-Lapuz','Navais','Nonoy','North Avanceña','North Fundidor','North San Jose','Oñate de Leon','Osmena','Pale Benedicto Rizal','Phhc Block 17','Phhc Block 22','Quintin Salas','Rizal Palapala I','Rizal Palapala II','Rizal Estanzuela','San Isidro Norte','San Isidro Sur','San Jose','San Pedro','Santa Cruz','Taal','Tabuc Suba','Tanza Norte','Tanza Sur','Tico','Timawa Tay-tay','West Habog-habog','West Timawa','Yulo Drive','Zone I Sur','Zone II Norte'],
  'Bacolod City':['Alangilan','Alijis','Bacolod City Proper','Bata','Cabug','Estefania','Felisa','Granada','Handumanan','Mandalagan','Mansilingan','Montevista','Pahanocoy','Punta Taytay','Singcang-Airport','Sum-ag','Taculing','Tangub','Taytay','Vista Alegre'],
  'Dumaguete City':['Bagacay','Bajumpandan','Balugo','Banilad','Bantayan','Batinguel','Bunao','Cadawinonan','Calindagan','Camanjac','Candau-ay','Cantil-e','Daro','Junob','Looc','Mangnao-Canal','Motong','Piapi','Poblacion No. 1','Poblacion No. 2','Poblacion No. 3','Poblacion No. 4','Poblacion No. 5','Poblacion No. 6','Poblacion No. 7','Poblacion No. 8','Pulantubig','Tabuctubig','Taclobo','Talay'],
  'Tacloban City':['Anibong','Bagacay','Balon Anito','Barangay 1','Barangay 2','Barangay 3','Barangay 4','Barangay 5','Barangay 6','Barangay 7','Barangay 8','Barangay 9','Barangay 10','Barangay 11','Barangay 12','Barangay 13','Barangay 14','Barangay 15','Barangay 16','Barangay 17','Barangay 18','Barangay 19','Barangay 20','Barangay 21','Barangay 22','Barangay 23','Barangay 24','Barangay 25','Barangay 26','Barangay 27','Barangay 28','Barangay 29','Barangay 30','Barangay 31','Barangay 32','Barangay 33','Barangay 34','Barangay 35','Barangay 36','Barangay 37','Barangay 38','Barangay 39','Barangay 40','Barangay 41','Barangay 42','Barangay 43','Barangay 44','Barangay 45','Barangay 46','Barangay 47','Barangay 48','Barangay 49','Barangay 50','Barangay 51','Barangay 52','Barangay 53','Barangay 54','Barangay 55','Barangay 56','Barangay 57','Barangay 58','Barangay 59','Barangay 60','Barangay 61','Barangay 62','Barangay 63','Barangay 64','Barangay 65','Barangay 66','Barangay 67','Barangay 68','Barangay 69','Barangay 70','Barangay 71','Barangay 72','Barangay 73','Barangay 74','Barangay 75','Barangay 76','Barangay 77','Barangay 78','Barangay 79','Barangay 80','Barangay 81','Barangay 82','Barangay 83','Barangay 84','Barangay 85','Barangay 86','Barangay 87','Barangay 88','Barangay 89','Barangay 90','Barangay 91','Barangay 92'],
};

function saUpdateBranchSummary() {
  const total = saBranchAllEmployees.length;
  const unassigned = saBranchAllEmployees.filter((e) => !e.branch).length;

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = String(val); };
  set('sa-ba-count-total', total);
  set('sa-ba-count-unassigned', unassigned);

  rebuildSABranchFilterSelect(total, unassigned);
}

function rebuildSABranchFilterSelect(total, unassigned) {
  const select = document.getElementById('sa-ba-branch-select');
  if (!select) return;

  if (saBranchFilter !== 'all' && saBranchFilter !== 'unassigned' && !saAssignBranches.some((b) => b.id === saBranchFilter)) {
    saBranchFilter = 'all';
  }

  const currentVal = saBranchFilter || 'all';
  let html = `<option value="all">All (${total})</option><option value="unassigned">Unassigned (${unassigned})</option>`;
  saAssignBranches.forEach((b) => {
    const count = saBranchAllEmployees.filter((e) => e.branch === b.id).length;
    const name = String(b.name || '').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    html += `<option value="${b.id}">${name} (${count})</option>`;
  });
  select.innerHTML = html;
  select.value = currentVal;
  if (!select.value) select.value = 'all';
}

function saGetFilteredBranchEmployees() {
  const search = saBranchSearch.toLowerCase();
  return saBranchAllEmployees.filter((e) => {
    if (saBranchFilter === 'unassigned') { if (e.branch) return false; }
    else if (saBranchFilter !== 'all')   { if (e.branch !== saBranchFilter) return false; }
    if (!search) return true;
    const hay = [e.full_name, e.employee_id, e.email].map((v) => String(v || '').toLowerCase()).join(' ');
    return hay.includes(search);
  });
}

function saRenderBranchTable(employees) {
  const tbody = document.getElementById('sa-ba-table-body');
  if (!tbody) return;

  if (!employees.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="color:var(--t3);">No employees found.</td></tr>`;
    return;
  }

  tbody.innerHTML = employees.map((emp) => {
    const branchIdx = emp.branch ? saAssignBranches.findIndex((b) => b.id === emp.branch) : -1;
    const branchColor = branchIdx >= 0 ? SA_BRANCH_BADGE_COLORS[branchIdx % SA_BRANCH_BADGE_COLORS.length] : 'var(--t3)';
    const inactiveTag = emp.branch && emp.branch_status && emp.branch_status !== 'Active' ? ' (Inactive)' : '';
    const branchLabel = emp.branch ? String((emp.branch_label || 'Unknown branch') + inactiveTag).replace(/</g,'&lt;').replace(/>/g,'&gt;') : null;
    const branchCell = branchLabel
      ? `<span style="display:inline-block;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600;background:${branchColor}22;color:${branchColor};border:1px solid ${branchColor}55;">${branchLabel}</span>`
      : `<span class="badge br"><span class="bd"></span>Unassigned</span>`;
    const assignedAt = emp.assigned_at
      ? new Date(emp.assigned_at).toLocaleDateString('en-PH', { year:'numeric', month:'short', day:'numeric' })
      : '—';
    const typeClass = emp.employee_type === 'Non-Teaching' ? 'ba' : 'bt2';

    return `
      <tr>
        <td class="nm">${String(emp.full_name || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</td>
        <td class="mn">${String(emp.employee_id || '—').replace(/&/g,'&amp;')}</td>
        <td><span class="badge ${typeClass}">${emp.employee_type || 'Teaching'}</span></td>
        <td class="mn">${emp.position || '—'}</td>
        <td>${branchCell}</td>
        <td class="mn" style="font-size:11px;">${assignedAt}</td>
      </tr>
    `;
  }).join('');
}

function saRenderFilteredBranch() {
  saUpdateBranchSummary();
  if (saBranchPaginator) {
    saBranchPaginator.setData(saGetFilteredBranchEmployees());
  } else {
    saRenderBranchTable(saGetFilteredBranchEmployees());
  }
}

function setSABranchFilter(filter) {
  saBranchFilter = filter;
  const select = document.getElementById('sa-ba-branch-select');
  if (select && select.value !== filter) select.value = filter;
  saRenderFilteredBranch();
}

function setSABranchSearch(value) {
  saBranchSearch = String(value || '').trim();
  saRenderFilteredBranch();
}

async function loadSABranchAssignment() {
  const tbody = document.getElementById('sa-ba-table-body');
  if (tbody) tbody.innerHTML = skeletonRows(6);

  try {
    saAssignBranches = await fetchBranchesCached().catch(() => saAssignBranches);

    const response = await fetch('/api/admin/branch-employees', { method: 'GET' });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Failed to load branch assignments');

    saBranchAllEmployees = payload.employees || [];
    saRenderFilteredBranch();
  } catch (error) {
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="6" style="color:var(--red);">${String(error.message || 'Error').replace(/</g,'&lt;')}</td></tr>`;
    }
  }
}

// The per-row "Reassign"/"Assign" button and its modal are retired — the
// Employee Branch List above is now purely informational. Moving someone is
// exclusively "New Transfer Request" below, which (for Super Admin) creates
// a transfer_requests row and immediately approves it in the same step —
// same table and trigger the Admin-initiated flow uses, just no waiting
// since Super Admin has no one above them to approve to.
function openSATransferRequestModal() {
  const modal = document.getElementById('sa-branch-assign-modal');
  const employeeSelect = document.getElementById('sa-transfer-request-employee');
  const branchSelect = document.getElementById('sa-transfer-request-branch');
  if (!modal || !employeeSelect || !branchSelect) return;

  employeeSelect.innerHTML = saBranchAllEmployees
    .map((e) => `<option value="${String(e.id).replace(/"/g,'&quot;')}">${String(e.full_name || e.employee_id || '').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</option>`)
    .join('');

  branchSelect.innerHTML = saAssignBranches
    .map((b) => `<option value="${String(b.id).replace(/"/g,'&quot;')}">${String(b.name || '').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</option>`)
    .join('');

  const form = document.getElementById('sa-branch-assign-form');
  form?.reset();
  const feedbackEl = document.getElementById('sa-ba-modal-feedback');
  if (feedbackEl) feedbackEl.textContent = '';

  modal.style.display = 'flex';
}

function closeSATransferRequestModal() {
  const modal = document.getElementById('sa-branch-assign-modal');
  if (modal) modal.style.display = 'none';
}

async function submitSATransferRequest(event) {
  event.preventDefault();
  const form = event.target;
  const submitBtn = form.querySelector('button[type="submit"]');
  const feedbackEl = document.getElementById('sa-ba-modal-feedback');
  const formData = new FormData(form);

  const userId = String(formData.get('employee_id') || '').trim();
  const branchId = String(formData.get('to_branch_id') || '').trim();
  const remarks = String(formData.get('remarks') || '').trim();

  if (!userId || !branchId) {
    if (feedbackEl) { feedbackEl.textContent = 'Missing required fields.'; feedbackEl.className = 'adm-feedback err'; }
    return;
  }

  try {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Assigning...';

    const createRes = await fetch('/api/admin/transfer-requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employee_id: userId, to_branch_id: branchId, remarks: remarks || 'Branch assignment' }),
    });
    const created = await createRes.json();
    if (!createRes.ok) throw new Error(created.error || 'Failed to submit transfer request');

    const approveRes = await fetch('/api/admin/transfer-requests', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: created.request.id, action: 'approve' }),
    });
    const approved = await approveRes.json();
    if (!approveRes.ok) throw new Error(approved.error || 'Failed to approve branch assignment');

    if (feedbackEl) { feedbackEl.textContent = 'Employee assigned.'; feedbackEl.className = 'adm-feedback ok'; }
    await loadSABranchAssignment();
    await loadSATransferRequests();
    setTimeout(() => closeSATransferRequestModal(), 600);
  } catch (error) {
    if (feedbackEl) { feedbackEl.textContent = error.message; feedbackEl.className = 'adm-feedback err'; }
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Confirm Assignment';
  }
}

/* ═══════════════════════════════════════
   SA SYSTEM MAINTENANCE — RFID
   ═══════════════════════════════════════ */

function saFormatTimeOnly(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-PH', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}

function formatSARfidScanFeedback(record) {
  if (!record) return '';
  const name = record.employee_name || 'Employee';
  if (record.time_out) {
    return `${name}: Time Out recorded at ${saFormatTimeOnly(record.time_out)}.`;
  }
  return `${name}: Time In recorded at ${saFormatTimeOnly(record.time_in)} (${record.status || 'Present'}).`;
}

function saGetFilteredRfidDevices() {
  const search = saRfidDeviceSearch.toLowerCase();
  if (!search) return saAllRfidDevices;
  return saAllRfidDevices.filter((device) => {
    const haystack = [device.full_name, device.employee_id, device.rfid_uid]
      .map((v) => String(v || '').toLowerCase())
      .join(' ');
    return haystack.includes(search);
  });
}

function saRenderRfidDevices(devices) {
  const tbody = document.getElementById('sa-rfid-table-body');
  if (!tbody) return;

  if (!devices.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="color:var(--t3);">No employees found.</td></tr>`;
    return;
  }

  tbody.innerHTML = devices.map((device) => {
    const safeName = String(device.full_name || '').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const safeEmpId = String(device.employee_id || 'N/A').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const safeType = String(device.employee_type || 'Teaching').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const typeBadge = safeType === 'Non-Teaching' ? 'ba' : 'bt2';
    const hasRfid = Boolean(String(device.rfid_uid || '').trim());
    const rfidDisplay = hasRfid ? String(device.rfid_uid).replace(/</g,'&lt;').replace(/>/g,'&gt;') : '—';
    const rfidBadge = hasRfid ? 'bg' : 'ba';
    const rfidStatus = hasRfid ? 'Assigned' : 'Unassigned';
    const deviceId = String(device.id).replace(/'/g, "\\'");

    if (device.archived) return '';

    return `
      <tr>
        <td class="nm">${safeName}</td>
        <td class="mn">${safeEmpId}</td>
        <td><span class="badge ${typeBadge}">${safeType}</span></td>
        <td class="mn" style="font-family:var(--mono);font-size:12px;">${rfidDisplay}</td>
        <td><span class="badge ${rfidBadge}"><span class="bd"></span>${rfidStatus}</span></td>
        <td>
          <button class="btn btn-outline" style="font-size:11px;padding:5px 11px;" onclick="openSARfidEditModal('${deviceId}')">
            ${hasRfid ? 'Update' : 'Assign'}
          </button>
          ${hasRfid ? `<button class="btn btn-red" style="font-size:11px;padding:5px 11px;margin-left:6px;" onclick="voidSARfidCard('${deviceId}')">Void</button>` : ''}
        </td>
      </tr>
    `;
  }).filter(Boolean).join('');
}

function saRenderFilteredRfidDevices() {
  const filtered = saGetFilteredRfidDevices().filter((d) => !d.archived);
  if (saRfidPaginator) {
    saRfidPaginator.setData(filtered);
  } else {
    saRenderRfidDevices(filtered);
  }
}

function setSARfidDeviceSearch(value) {
  saRfidDeviceSearch = String(value || '').trim();
  saRenderFilteredRfidDevices();
}

async function loadSASystemData() {
  const rfidTbody = document.getElementById('sa-rfid-table-body');
  if (rfidTbody) rfidTbody.innerHTML = skeletonRows(6);

  try {
    const response = await fetch('/api/admin/system', { method: 'GET' });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Failed to load system data');

    saAllRfidDevices = payload.rfid_devices || [];

    if (!saRfidPaginator) {
      saRfidPaginator = createPaginator({ id: 'sa-rfid', pageSize: 15, renderFn: saRenderRfidDevices });
    }
    saRenderFilteredRfidDevices();
  } catch (error) {
    if (rfidTbody) {
      rfidTbody.innerHTML = `<tr><td colspan="6" style="color:#E85555;">${String(error.message).replace(/</g,'&lt;')}</td></tr>`;
    }
  }
}

function openSARfidEditModal(employeeId) {
  const modal = document.getElementById('sa-rfid-edit-modal');
  const form = document.getElementById('sa-rfid-edit-form');
  if (!modal || !form) return;

  saCurrentEditingRfid = saAllRfidDevices.find((d) => d.id === employeeId);
  if (!saCurrentEditingRfid) {
    window.alert('Employee not found. Please refresh the list.');
    return;
  }

  form.elements.id.value = saCurrentEditingRfid.id;
  form.elements.employee_display.value = `${saCurrentEditingRfid.full_name} (${saCurrentEditingRfid.employee_id || 'N/A'})`;
  form.elements.rfid_uid.value = saCurrentEditingRfid.rfid_uid || '';

  const feedbackEl = document.getElementById('sa-rfid-edit-feedback');
  if (feedbackEl) feedbackEl.textContent = '';

  modal.style.display = 'flex';

  // Auto-focus so a HID RFID reader's keystrokes land in the field immediately
  setTimeout(() => form.elements.rfid_uid?.select(), 0);
}

function closeSARfidEditModal() {
  const modal = document.getElementById('sa-rfid-edit-modal');
  if (modal) modal.style.display = 'none';
}

async function submitSARfidUpdate(event) {
  event.preventDefault();
  const form = event.target;
  const submitBtn = form.querySelector('button[type="submit"]');
  const formData = new FormData(form);
  const feedbackEl = document.getElementById('sa-rfid-edit-feedback');

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
    if (typeof pushNotification === 'function') pushNotification('RFID Updated', payload.rfid_uid ? 'RFID UID has been assigned to the employee.' : 'RFID UID has been removed.', 'success');
    await loadSASystemData();
    setTimeout(() => closeSARfidEditModal(), 500);
  } catch (error) {
    if (feedbackEl) { feedbackEl.textContent = error.message; feedbackEl.className = 'adm-feedback err'; }
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Save RFID';
  }
}

async function voidSARfidCard(employeeId) {
  const device = saAllRfidDevices.find((d) => d.id === employeeId);
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

    if (typeof pushNotification === 'function') pushNotification('RFID Voided', `RFID card for ${device.full_name} has been voided.`, 'success');
    await loadSASystemData();
  } catch (error) {
    if (typeof pushNotification === 'function') pushNotification('Error', error.message, 'error');
  }
}

function showSARfidFeedback(message, isError = false) {
  const feedback = document.getElementById('sa-rfid-feedback');
  if (!feedback) return;

  feedback.textContent = message;
  feedback.classList.toggle('err', isError);
  feedback.classList.toggle('ok', !isError && Boolean(message));
}

// USB RFID readers plug in as HID keyboards: tapping a card types the UID
// into whichever input has focus, then sends Enter. Bound once so the field
// auto-submits on Enter instead of requiring a manual button click.
function attachSARfidScannerInput() {
  const input = document.getElementById('sa-rfid-input');
  if (!input || input.dataset.scannerBound === '1') return;
  input.dataset.scannerBound = '1';

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      submitSARfidAttendanceScan();
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
      if (/^\d{6,}$/.test(input.value.trim()) && !saRfidScanInFlight) submitSARfidAttendanceScan();
    }, 400);
  });
}

let saRfidScanInFlight = false;

async function submitSARfidAttendanceScan() {
  const input = document.getElementById('sa-rfid-input');
  if (!input || saRfidScanInFlight) return;

  const rfidCode = String(input.value || '').trim();
  if (!rfidCode) {
    showSARfidFeedback('Enter RFID or employee ID first.', true);
    return;
  }

  saRfidScanInFlight = true;
  input.disabled = true;

  try {
    showSARfidFeedback('Processing RFID scan...', false);

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
    showSARfidFeedback(formatSARfidScanFeedback(payload.record) || payload.message || 'RFID scan recorded.', false);
  } catch (error) {
    showSARfidFeedback(error.message, true);
  } finally {
    saRfidScanInFlight = false;
    input.disabled = false;
    input.focus();
  }
}

window.setSARfidDeviceSearch = setSARfidDeviceSearch;
window.loadSASystemData = loadSASystemData;
window.openSARfidEditModal = openSARfidEditModal;
window.closeSARfidEditModal = closeSARfidEditModal;
window.submitSARfidUpdate = submitSARfidUpdate;
window.voidSARfidCard = voidSARfidCard;
window.submitSARfidAttendanceScan = submitSARfidAttendanceScan;

window.loadSAAttendanceData = loadSAAttendanceData;
window.exportSAAttendanceCsv = exportSAAttendanceCsv;

window.openSAViewEmployeeModal = openSAViewEmployeeModal;
window.closeSAViewEmployeeModal = closeSAViewEmployeeModal;
window.openSAAdminUserModal = openSAAdminUserModal;
window.closeSAAdminUserModal = closeSAAdminUserModal;
window.submitSAAdminUser = submitSAAdminUser;
window.toggleArchiveSAAdminUser = toggleArchiveSAAdminUser;

window.setSABranchFilter = setSABranchFilter;
window.setSABranchSearch = setSABranchSearch;
window.loadSABranchAssignment = loadSABranchAssignment;
window.openSATransferRequestModal = openSATransferRequestModal;
window.closeSATransferRequestModal = closeSATransferRequestModal;
window.submitSATransferRequest = submitSATransferRequest;
window.onSABranchRegionChange = onSABranchRegionChange;
window.onSABranchProvinceChange = onSABranchProvinceChange;
window.onSABranchCityChange = onSABranchCityChange;
window.populateSABranchLocationSelects = populateSABranchLocationSelects;
window.rebuildSABranchFilterSelect = rebuildSABranchFilterSelect;

const saScreen = document.getElementById('s-super-admin');
if (saScreen?.classList.contains('active')) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSAPortal);
  } else {
    initSAPortal();
  }
} else if (saScreen) {
  const saObserver = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === 'attributes' && m.attributeName === 'class') {
        if (saScreen.classList.contains('active')) {
          saObserver.disconnect();
          initSAPortal();
        }
      }
    }
  });
  saObserver.observe(saScreen, { attributes: true });
}
