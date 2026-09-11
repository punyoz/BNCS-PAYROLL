/* ═══════════════════════════════════════
   app.js — core application logic
   Handles: login, logout, theme toggle
   Edit this file for auth and routing init
   ═══════════════════════════════════════ */

'use strict';

/* ── THEME ── */
const THEME_KEY = 'sacs-theme';

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem(THEME_KEY, theme);
  // update all toggle button icons
  document.querySelectorAll('.theme-toggle').forEach(btn => {
    btn.textContent = theme === 'dark' ? '☀️' : '🌙';
    btn.title = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
  });
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  document.body.classList.add('theme-transitioning');
  applyTheme(current === 'dark' ? 'light' : 'dark');
  setTimeout(() => document.body.classList.remove('theme-transitioning'), 300);
}

/* ── AUTH CONSTANTS ── */
const AUTH_CONTEXT_KEY = 'sacs-auth-context';
const AUTH_CONTEXT_EVENT = 'sacs-auth-context-changed';
const ROLE_PAGE_STATE_PREFIX = 'sacs-active-page-';

function dispatchAuthContextChanged(context) {
  try {
    window.dispatchEvent(new CustomEvent(AUTH_CONTEXT_EVENT, { detail: context || null }));
  } catch {
    // CustomEvent may fail in very old browsers; ignore.
  }
}

function toTitleCase(value) {
  const text = String(value || '').trim();
  if (!text) return '';

  return text
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

function inferNameFromIdentity(identity) {
  const raw = String(identity || '').trim();
  if (!raw) return '';

  const fromEmail = raw.includes('@') ? raw.split('@')[0] : raw;
  return toTitleCase(fromEmail.replace(/[._-]+/g, ' '));
}

function saveAuthContext(result, role, identityInput) {
  const profile = result?.profile || {};
  const resolvedRole = String(profile.role || role || 'employee').toLowerCase();
  const fullName = String(profile.full_name || '').trim() || inferNameFromIdentity(profile.email || identityInput);

  const context = {
    role: resolvedRole,
    full_name: fullName,
    email: String(profile.email || '').trim(),
    employee_id: String(profile.employee_id || '').trim(),
    employee_type: String(profile.employee_type || '').trim(),
    position: String(profile.position || '').trim(),
    address: String(profile.address || '').trim(),
    sss_number: String(profile.sss_number || '').trim(),
    pagibig_number: String(profile.pagibig_number || '').trim(),
    philhealth_number: String(profile.philhealth_number || '').trim(),
    bank_name: String(profile.bank_name || '').trim(),
    bank_account_number: String(profile.bank_account_number || '').trim(),
  };

  localStorage.setItem(AUTH_CONTEXT_KEY, JSON.stringify(context));
  dispatchAuthContextChanged(context);
}

function getAuthContext() {
  try {
    const raw = localStorage.getItem(AUTH_CONTEXT_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function getRolePageStateKey(role) {
  return `${ROLE_PAGE_STATE_PREFIX}${String(role || '').trim().toLowerCase()}`;
}

function persistRolePageState(role, pageId) {
  const normalizedRole = String(role || '').trim().toLowerCase();
  const normalizedPage = String(pageId || '').trim();
  if (!normalizedRole || !normalizedPage) return;

  localStorage.setItem(getRolePageStateKey(normalizedRole), normalizedPage);

  const params = new URLSearchParams(window.location.search);
  if (params.get('role') === normalizedRole) {
    params.set('page', normalizedPage);
    const next = `${window.location.pathname}?${params.toString()}`;
    window.history.replaceState(null, '', next);
  }
}

function getPersistedRolePageState(role) {
  const normalizedRole = String(role || '').trim().toLowerCase();
  if (!normalizedRole) return '';

  const params = new URLSearchParams(window.location.search);
  if (params.get('role') === normalizedRole) {
    const fromUrl = String(params.get('page') || '').trim();
    if (fromUrl) return fromUrl;
  }

  return String(localStorage.getItem(getRolePageStateKey(normalizedRole)) || '').trim();
}

function clearPersistedRolePageStates() {
  ['super_admin', 'admin', 'accountant', 'employee', 'hr'].forEach((role) => {
    localStorage.removeItem(getRolePageStateKey(role));
  });
}

function ensureConfirmDialog() {
  let backdrop = document.getElementById('legacy-confirm-backdrop');
  if (backdrop) return backdrop;

  backdrop = document.createElement('div');
  backdrop.id = 'legacy-confirm-backdrop';
  backdrop.className = 'confirm-backdrop';
  backdrop.setAttribute('aria-hidden', 'true');
  backdrop.innerHTML = `
    <div class="confirm-card card" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
      <div class="confirm-header">
        <div class="confirm-icon">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
            <line x1="12" y1="9" x2="12" y2="13"></line>
            <line x1="12" y1="17" x2="12.01" y2="17"></line>
          </svg>
        </div>
        <div class="confirm-title" id="confirm-title">Warning</div>
      </div>
      <div class="confirm-body" id="confirm-body"></div>
      <div class="confirm-actions">
        <button type="button" class="btn btn-outline" id="confirm-cancel-btn">Cancel</button>
        <button type="button" class="btn btn-primary btn-red" id="confirm-ok-btn">Continue</button>
      </div>
    </div>
  `;

  document.body.appendChild(backdrop);
  return backdrop;
}

async function confirmDestructiveAction(actionLabel, detailText) {
  const action = String(actionLabel || 'this action').trim();
  const detail = String(detailText || '').trim();
  const backdrop = ensureConfirmDialog();
  const body = backdrop.querySelector('#confirm-body');
  const okButton = backdrop.querySelector('#confirm-ok-btn');
  const cancelButton = backdrop.querySelector('#confirm-cancel-btn');

  if (!body || !okButton || !cancelButton) {
    return window.confirm(`WARNING: You are about to ${action}. Continue?`);
  }

  body.innerHTML = `
    <p>You are about to <strong style="color:var(--t1);">${action}</strong>.</p>
    ${detail ? `<p>${detail}</p>` : ''}
  `;

  backdrop.classList.add('active');
  backdrop.setAttribute('aria-hidden', 'false');

  return new Promise((resolve) => {
    const cleanup = (result) => {
      backdrop.classList.remove('active');
      backdrop.setAttribute('aria-hidden', 'true');

      okButton.removeEventListener('click', onOk);
      cancelButton.removeEventListener('click', onCancel);
      backdrop.removeEventListener('click', onBackdrop);
      document.removeEventListener('keydown', onEsc);

      resolve(result);
    };

    const onOk = () => cleanup(true);
    const onCancel = () => cleanup(false);
    const onBackdrop = (event) => {
      if (event.target === backdrop) cleanup(false);
    };
    const onEsc = (event) => {
      if (event.key === 'Escape') cleanup(false);
    };

    okButton.addEventListener('click', onOk, { once: true });
    cancelButton.addEventListener('click', onCancel, { once: true });
    backdrop.addEventListener('click', onBackdrop);
    document.addEventListener('keydown', onEsc);
  });
}

/* ── SETTINGS MODAL ── */
function populateSettingsModalProfile(prefix) {
  const ctx = getAuthContext();
  if (!ctx) return;
  const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };

  // Only a single composed full_name is stored — split it back into parts
  // so Name starts pre-filled with something reasonable. splitFullName()
  // is defined in admin.js, loaded before any of this runs.
  const nameParts = typeof splitFullName === 'function' ? splitFullName(ctx.full_name || '') : {};
  const midName = nameParts.middle_initial
    || (nameParts.second_name && nameParts.second_name !== nameParts.last_name ? nameParts.second_name : '');
  setVal(`${prefix}-edit-firstname`,  nameParts.first_name);
  setVal(`${prefix}-edit-middlename`, midName);
  setVal(`${prefix}-edit-lastname`,   nameParts.last_name);
  setVal(`${prefix}-edit-suffix`,     nameParts.suffix);

  // Only the employee portal's settings modal has an address field — other
  // roles' own profiles don't display or edit Home Address.
  setVal(`${prefix}-edit-address`,     ctx.address);
  setVal(`${prefix}-edit-bankname`,    ctx.bank_name);
  setVal(`${prefix}-edit-bankaccount`, ctx.bank_account_number);
}

async function saveProfileInfo(prefix) {
  const ctx = getAuthContext();
  const email = String(ctx?.email || '').trim();
  const feedbackEl = document.getElementById(`${prefix}-profile-feedback`);

  if (!email) {
    if (feedbackEl) { feedbackEl.textContent = 'Unable to identify account. Please sign in again.'; feedbackEl.className = 'adm-feedback err'; }
    return;
  }

  const first_name  = String(document.getElementById(`${prefix}-edit-firstname`)?.value  || '').trim();
  const middle_name = String(document.getElementById(`${prefix}-edit-middlename`)?.value || '').trim();
  const last_name   = String(document.getElementById(`${prefix}-edit-lastname`)?.value   || '').trim();
  const suffix      = String(document.getElementById(`${prefix}-edit-suffix`)?.value     || '').trim();
  const bank_name        = String(document.getElementById(`${prefix}-edit-bankname`)?.value     || '').trim();
  const bank_account_number = String(document.getElementById(`${prefix}-edit-bankaccount`)?.value || '').trim();
  // Address is only present in the employee portal's modal — other roles
  // have no such field, so leave it out of their payload entirely rather
  // than sending an empty string that would wipe out any address already
  // on file for that account.
  const addressEl = document.getElementById(`${prefix}-edit-address`);
  const address = addressEl ? String(addressEl.value || '').trim() : undefined;

  if (!first_name || !last_name) {
    if (feedbackEl) { feedbackEl.textContent = 'First and last name are required.'; feedbackEl.className = 'adm-feedback err'; }
    return;
  }
  if (!/^[A-Za-z\s]+$/.test(first_name)) {
    if (feedbackEl) { feedbackEl.textContent = 'First name must contain only letters.'; feedbackEl.className = 'adm-feedback err'; }
    return;
  }
  if (!/^[A-Za-z\s]+$/.test(last_name)) {
    if (feedbackEl) { feedbackEl.textContent = 'Last name must contain only letters.'; feedbackEl.className = 'adm-feedback err'; }
    return;
  }
  if (middle_name && !/^[A-Za-z\s]+$/.test(middle_name)) {
    if (feedbackEl) { feedbackEl.textContent = 'Middle name must contain only letters.'; feedbackEl.className = 'adm-feedback err'; }
    return;
  }

  const full_name = typeof composeFullName === 'function'
    ? composeFullName({ first_name, middle_initial: middle_name, last_name, suffix })
    : [first_name, middle_name, last_name, suffix].filter(Boolean).join(' ');

  if (feedbackEl) { feedbackEl.textContent = 'Saving...'; feedbackEl.className = 'adm-feedback loading'; }

  try {
    const payload = { email, full_name, bank_name, bank_account_number };
    if (address !== undefined) payload.address = address;

    const response = await fetch('/api/legacy-auth/update-profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Failed to update profile.');

    const updatedCtx = { ...ctx, full_name, bank_name, bank_account_number };
    if (address !== undefined) updatedCtx.address = address;
    localStorage.setItem(AUTH_CONTEXT_KEY, JSON.stringify(updatedCtx));
    dispatchAuthContextChanged(updatedCtx);

    if (feedbackEl) { feedbackEl.textContent = 'Profile updated successfully.'; feedbackEl.className = 'adm-feedback ok'; }
    pushNotification('Profile Updated', 'Your information has been saved.', 'success');

    setTimeout(() => {
      if (feedbackEl && feedbackEl.textContent.includes('successfully')) {
        feedbackEl.textContent = '';
        feedbackEl.className = 'adm-feedback';
      }
    }, 3000);
  } catch (error) {
    if (feedbackEl) { feedbackEl.textContent = error.message; feedbackEl.className = 'adm-feedback err'; }
  }
}

// `section` picks which view of the modal shows: 'password' (the gear-icon
// Settings shortcut — just Change Password) or 'profile' (the Profile
// page's Edit Account button — Personal Information/Bank only, no
// password). Only portals with both `${prefix}-settings-profile-section`
// and `${prefix}-settings-password-section` wrapper ids in their modal
// markup actually split; portals without them (e.g. admin, which has only
// one entry point) show the same combined content regardless of `section`.
function openSettingsModal(prefix, section = 'password') {
  const modal = document.getElementById(`${prefix}-settings-modal`);
  if (!modal) return;

  const profileSection = document.getElementById(`${prefix}-settings-profile-section`);
  const passwordSection = document.getElementById(`${prefix}-settings-password-section`);
  if (profileSection) profileSection.hidden = section !== 'profile';
  if (passwordSection) passwordSection.hidden = section === 'profile';

  const titleEl = document.getElementById(`${prefix}-settings-title`);
  if (titleEl && profileSection && passwordSection) {
    titleEl.textContent = section === 'profile' ? 'Edit Account' : 'Account Settings';
  }

  populateSettingsModalProfile(prefix);
  modal.classList.add('active');
  modal.setAttribute('aria-hidden', 'false');

  if (!modal._escBound) {
    modal._escBound = true;
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modal.classList.contains('active')) closeSettingsModal(prefix);
    });
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeSettingsModal(prefix);
    });
  }
}

function closeSettingsModal(prefix) {
  const modal = document.getElementById(`${prefix}-settings-modal`);
  if (!modal) return;
  modal.classList.remove('active');
  modal.setAttribute('aria-hidden', 'true');

  const feedback = document.getElementById(`${prefix}-change-password-feedback`);
  if (feedback) { feedback.textContent = ''; feedback.className = 'adm-feedback'; }

  const profileFeedback = document.getElementById(`${prefix}-profile-feedback`);
  if (profileFeedback) { profileFeedback.textContent = ''; profileFeedback.className = 'adm-feedback'; }
}

function ensureApproveDialog() {
  let backdrop = document.getElementById('legacy-approve-backdrop');
  if (backdrop) return backdrop;

  backdrop = document.createElement('div');
  backdrop.id = 'legacy-approve-backdrop';
  backdrop.className = 'confirm-backdrop';
  backdrop.setAttribute('aria-hidden', 'true');
  backdrop.innerHTML = `
    <div class="confirm-card card" role="dialog" aria-modal="true" aria-labelledby="approve-title">
      <div class="confirm-header">
        <div class="confirm-icon confirm-icon-approve">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
        </div>
        <div class="confirm-title" id="approve-title">Confirm Approval</div>
      </div>
      <div class="confirm-body" id="approve-body"></div>
      <div class="confirm-actions">
        <button type="button" class="btn btn-outline" id="approve-cancel-btn">Cancel</button>
        <button type="button" class="btn btn-green" id="approve-ok-btn">Approve</button>
      </div>
    </div>
  `;

  document.body.appendChild(backdrop);
  return backdrop;
}

// options: { title, confirmLabel } — lets non-approval positive actions (e.g.
// restoring a user) reuse this dialog without saying "Approve". The dialog
// element is created once and reused, so both are always set, not just when
// overridden, otherwise wording would leak from the previous call.
async function confirmApproveAction(actionLabel, detailText, options = {}) {
  const action = String(actionLabel || 'this action').trim();
  const detail = String(detailText || '').trim();
  const title = String(options.title || 'Confirm Approval').trim();
  const confirmLabel = String(options.confirmLabel || 'Approve').trim();
  const backdrop = ensureApproveDialog();
  const body = backdrop.querySelector('#approve-body');
  const okButton = backdrop.querySelector('#approve-ok-btn');
  const cancelButton = backdrop.querySelector('#approve-cancel-btn');
  const titleEl = backdrop.querySelector('#approve-title');

  if (!body || !okButton || !cancelButton) {
    return window.confirm(`Confirm: You are about to ${action}. Continue?`);
  }

  if (titleEl) titleEl.textContent = title;
  okButton.textContent = confirmLabel;

  body.innerHTML = `
    <p>You are about to <strong style="color:var(--t1);">${action}</strong>.</p>
    ${detail ? `<p>${detail}</p>` : ''}
  `;

  backdrop.classList.add('active');
  backdrop.setAttribute('aria-hidden', 'false');

  return new Promise((resolve) => {
    const cleanup = (result) => {
      backdrop.classList.remove('active');
      backdrop.setAttribute('aria-hidden', 'true');

      okButton.removeEventListener('click', onOk);
      cancelButton.removeEventListener('click', onCancel);
      backdrop.removeEventListener('click', onBackdrop);
      document.removeEventListener('keydown', onEsc);

      resolve(result);
    };

    const onOk = () => cleanup(true);
    const onCancel = () => cleanup(false);
    const onBackdrop = (event) => {
      if (event.target === backdrop) cleanup(false);
    };
    const onEsc = (event) => {
      if (event.key === 'Escape') cleanup(false);
    };

    okButton.addEventListener('click', onOk, { once: true });
    cancelButton.addEventListener('click', onCancel, { once: true });
    backdrop.addEventListener('click', onBackdrop);
    document.addEventListener('keydown', onEsc);
  });
}

/* ── GLOBAL SEARCH + NOTIFICATIONS ── */
let searchDebounceTimer = null;

function getActiveScreen() {
  return document.querySelector('.screen.active') || null;
}

function getRoleNameFromScreen(screen) {
  const id = screen?.id;
  if (id === 's-super-admin') return 'Super Administrator';
  if (id === 's-admin') return 'Administrator';
  if (id === 's-accountant') return 'Accountant';
  if (id === 's-emp') return 'Employee';
  if (id === 's-hr') return 'HR';
  return 'Portal';
}

function syncSearchInputs(value, sourceInput) {
  document.querySelectorAll('.global-search-input').forEach((input) => {
    if (sourceInput && input === sourceInput) return;
    input.value = value;
  });
}

function updateSearchContainerState(input, state, term = '') {
  const container = input?.closest('.tb-search');
  if (!container) return;

  container.classList.remove('search-hit', 'search-miss');

  if (!term) {
    input.title = '';
    return;
  }

  if (state === 'hit') {
    container.classList.add('search-hit');
    input.title = `Search hit for "${term}"`;
    return;
  }

  container.classList.add('search-miss');
  input.title = `No match for "${term}"`;
}

function performGlobalSearch(term, forward = true) {
  const query = String(term || '').trim();
  if (!query) return true;

  if (typeof window.find !== 'function') {
    return false;
  }

  return Boolean(window.find(query, false, !forward, true, false, false, false));
}

function runSearchFromInput(input, forward = true) {
  const term = String(input?.value || '').trim();
  if (!term) {
    updateSearchContainerState(input, '', '');
    return;
  }

  const found = performGlobalSearch(term, forward);
  updateSearchContainerState(input, found ? 'hit' : 'miss', term);

  document.querySelectorAll('.global-search-input').forEach((otherInput) => {
    if (otherInput === input) return;
    updateSearchContainerState(otherInput, found ? 'hit' : 'miss', term);
  });
}

function attachGlobalSearchHandlers() {
  document.querySelectorAll('.global-search-input').forEach((input) => {
    if (input.dataset.searchBound === 'true') return;
    input.dataset.searchBound = 'true';

    input.addEventListener('input', () => {
      const term = String(input.value || '');
      syncSearchInputs(term, input);

      if (searchDebounceTimer) {
        clearTimeout(searchDebounceTimer);
      }

      searchDebounceTimer = setTimeout(() => {
        runSearchFromInput(input, true);
      }, 120);
    });

    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        runSearchFromInput(input, !event.shiftKey);
      }

      if (event.key === 'Escape') {
        input.value = '';
        syncSearchInputs('', input);
        runSearchFromInput(input, true);
      }
    });
  });

  document.querySelectorAll('.tb-search').forEach((container) => {
    if (container.dataset.searchContainerBound === 'true') return;
    container.dataset.searchContainerBound = 'true';

    const icon = container.querySelector('.search-ic');
    const input = container.querySelector('.global-search-input');
    if (!icon || !input) return;

    icon.style.cursor = 'pointer';
    icon.addEventListener('click', () => {
      runSearchFromInput(input, true);
      input.focus();
    });
  });
}

/* ── TOAST + NOTIFICATION HISTORY ── */
const notificationHistory = [];
let unreadNotificationCount = 0;

function notifEscape(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatNotifTime(date) {
  const now = new Date();
  const diff = Math.floor((now - date) / 1000);
  if (diff < 60) return 'Just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return date.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
}

function showToast(title, desc, type) {
  let stack = document.getElementById('toast-stack');
  if (!stack) {
    stack = document.createElement('div');
    stack.id = 'toast-stack';
    stack.className = 'toast-stack';
    document.body.appendChild(stack);
  }

  const iconMap = {
    success: `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`,
    info:    `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`,
    error:   `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`,
  };

  const toast = document.createElement('div');
  toast.className = `toast toast-${type || 'success'}`;
  toast.innerHTML = `
    <div class="toast-icon">${iconMap[type] || iconMap.success}</div>
    <div class="toast-text">
      <div class="toast-title"></div>
      ${desc ? '<div class="toast-desc"></div>' : ''}
    </div>
    <button class="toast-close" aria-label="Dismiss">×</button>
  `;
  toast.querySelector('.toast-title').textContent = title;
  if (desc) toast.querySelector('.toast-desc').textContent = desc;

  toast.querySelector('.toast-close').addEventListener('click', () => dismissToast(toast));
  stack.appendChild(toast);

  const timer = setTimeout(() => dismissToast(toast), 4500);
  toast._dismissTimer = timer;
}

function dismissToast(toast) {
  if (toast._dismissed) return;
  toast._dismissed = true;
  clearTimeout(toast._dismissTimer);
  toast.classList.add('toast-out');
  setTimeout(() => toast.remove(), 350);
}

function updateNotificationDot() {
  document.querySelectorAll('.global-notification-trigger .nd').forEach((dot) => {
    dot.style.display = unreadNotificationCount > 0 ? '' : 'none';
  });
}

function pushNotification(title, desc, type) {
  const safeType = type || 'success';
  notificationHistory.unshift({ title: String(title || ''), desc: String(desc || ''), type: safeType, time: new Date(), unread: true });
  if (notificationHistory.length > 30) notificationHistory.length = 30;

  unreadNotificationCount++;
  updateNotificationDot();
  showToast(title, desc, safeType);

  const panel = document.getElementById('global-notification-panel');
  if (panel?.classList.contains('active')) renderNotificationPanel();
}

function getRoleNotifications() {
  const screenId = getActiveScreen()?.id;

  if (screenId === 's-super-admin') {
    const users = Number(document.getElementById('sa-dash-users')?.textContent || 0);
    const dbStatus = String(document.getElementById('sa-dash-status')?.textContent || 'Online');

    return [
      {
        title: `System Status: ${dbStatus}`,
        desc: 'All services are being monitored centrally.',
      },
      {
        title: users > 0 ? `${users} users registered system-wide` : 'User data loading…',
        desc: 'Go to Roles & Permissions to manage user accounts.',
      },
    ];
  }

  if (screenId === 's-admin') {
    const pending = Number(document.getElementById('adm-panel-pending-approvals')?.textContent || 0);
    const totalEmployees = Number(document.getElementById('adm-panel-total-employees')?.textContent || 0);

    return [
      {
        title: pending > 0 ? `${pending} salary approvals are waiting` : 'No pending salary approvals',
        desc: pending > 0
          ? 'Open Salary Approvals to review pending salary changes.'
          : 'All submitted salary changes have been processed.',
      },
      {
        title: `${totalEmployees || 0} active employees loaded`,
        desc: 'Manage Employees has the current staff list and status.',
      },
    ];
  }

  if (screenId === 's-accountant') {
    const pending = Number(document.getElementById('ac-pending-count')?.textContent || 0);
    const period = String(document.getElementById('pc-period')?.value || 'Current period');

    return [
      {
        title: pending > 0 ? `${pending} payroll submissions are pending` : 'No pending payroll submissions',
        desc: pending > 0
          ? 'Submitted payroll is locked while waiting for admin approval.'
          : 'You can prepare and send payroll drafts for approval.',
      },
      {
        title: `Current pay period: ${period}`,
        desc: 'Use Process Payroll to compute and submit payroll entries.',
      },
    ];
  }

  if (screenId === 's-hr') {
    const pending = Number(document.getElementById('hr-dash-pending-leaves')?.textContent || 0);
    const total = Number(document.getElementById('hr-dash-total-employees')?.textContent || 0);

    return [
      {
        title: pending > 0 ? `${pending} leave request${pending > 1 ? 's' : ''} pending approval` : 'No pending leave requests',
        desc: pending > 0
          ? 'Open Leave Approval to review and approve pending requests.'
          : 'All leave requests have been processed.',
      },
      {
        title: `${total || 0} employees on record`,
        desc: 'Use Employee Records to view and update staff information.',
      },
    ];
  }

  if (screenId === 's-emp') {
    const present = String(document.getElementById('emp-stat-present')?.textContent || '').trim();
    const late    = String(document.getElementById('emp-stat-late')?.textContent    || '').trim();
    const absent  = String(document.getElementById('emp-stat-absent')?.textContent  || '').trim();
    const salary  = String(document.getElementById('emp-stat-netpay')?.textContent  || '').trim();

    const hasStats = present && present !== '—';
    const leaveItems = document.querySelectorAll('#emp-leave-list > div[style*="border"]');
    const pendingLeaves = Array.from(leaveItems).filter(el =>
      el.querySelector('.badge.ba')
    ).length;

    return [
      {
        title: hasStats
          ? `This month: ${present} present · ${late} late · ${absent} absent`
          : 'Attendance data loading…',
        desc: salary && salary !== '—'
          ? `Basic salary: ${salary}`
          : 'Attendance is tracked via RFID tap.',
      },
      {
        title: pendingLeaves > 0
          ? `${pendingLeaves} leave request${pendingLeaves > 1 ? 's' : ''} pending approval`
          : 'No pending leave requests',
        desc: 'Submit a leave request from the Leave Request form below.',
      },
    ];
  }

  return [
    {
      title: 'No notifications right now',
      desc: 'Switch to a role page to view current updates.',
    },
  ];
}

function ensureNotificationPanel() {
  let panel = document.getElementById('global-notification-panel');
  if (panel) return panel;

  panel = document.createElement('div');
  panel.id = 'global-notification-panel';
  panel.className = 'notif-panel';
  panel.innerHTML = `
    <div class="notif-head">
      <div class="notif-title">Notifications</div>
      <div class="notif-sub" id="global-notif-sub">Portal</div>
    </div>
    <div class="notif-list" id="global-notif-list"></div>
  `;

  document.body.appendChild(panel);
  return panel;
}

function renderNotificationPanel() {
  const panel = ensureNotificationPanel();
  const list = panel.querySelector('#global-notif-list');
  const sub = panel.querySelector('#global-notif-sub');
  if (!list || !sub) return;

  sub.textContent = getRoleNameFromScreen(getActiveScreen());

  let html = '';

  if (notificationHistory.length > 0) {
    html += '<div class="notif-section-label">Recent Activity</div>';
    html += notificationHistory.map((item) => `
      <div class="notif-item${item.unread ? ' notif-unread' : ''}">
        <div class="notif-item-row">
          <div class="notif-item-dot notif-dot-${notifEscape(item.type)}"></div>
          <div class="notif-item-title">${notifEscape(item.title)}</div>
          <div class="notif-item-time">${formatNotifTime(item.time)}</div>
        </div>
        ${item.desc ? `<div class="notif-item-desc">${notifEscape(item.desc)}</div>` : ''}
      </div>
    `).join('');
    html += '<div class="notif-section-label">Status</div>';
  }

  const roleItems = getRoleNotifications();
  html += roleItems.map((item) => `
    <div class="notif-item">
      <div class="notif-item-title">${item.title}</div>
      <div class="notif-item-desc">${item.desc}</div>
    </div>
  `).join('');

  list.innerHTML = html;
}

function closeNotificationPanel() {
  const panel = document.getElementById('global-notification-panel');
  if (!panel) return;
  panel.classList.remove('active');
}

function refreshCurrentPortal() {
  if (typeof window.getPersistedRolePageState === 'function') {
    const currentRole = new URLSearchParams(window.location.search).get('role');
    if (currentRole) {
      const pageId = window.getPersistedRolePageState(currentRole);
      
      if (currentRole === 'admin' && typeof adminNav === 'function' && pageId) {
        const navEl = document.querySelector(`#s-admin .ni[onclick*="${pageId}"]`);
        adminNav(pageId, navEl);
        return;
      }
      if (currentRole === 'accountant' && typeof acctNav === 'function' && pageId) {
        const navEl = document.querySelector(`#s-accountant .ni[onclick*="${pageId}"]`);
        acctNav(pageId, navEl);
        return;
      }
      if (currentRole === 'employee') {
        if (typeof applyEmployeeIdentity === 'function') applyEmployeeIdentity();
        if (typeof renderPayslipOptions === 'function') renderPayslipOptions();
        if (typeof loadMyLeaveRequests === 'function') loadMyLeaveRequests();
        return;
      }
      if (currentRole === 'hr' && typeof hrNav === 'function' && pageId) {
        const navEl = document.querySelector(`#s-hr .ni[onclick*="${pageId}"]`);
        hrNav(pageId, navEl);
        return;
      }
      if (currentRole === 'super_admin' && typeof saNav === 'function' && pageId) {
        const navEl = document.querySelector(`#s-super-admin .ni[onclick*="${pageId}"]`);
        saNav(pageId, navEl);
        return;
      }
    }
  }

  // Fallback
  window.location.reload();
}

function toggleNotificationPanel(trigger) {
  const panel = ensureNotificationPanel();
  renderNotificationPanel();

  const isOpen = panel.classList.contains('active');
  if (isOpen) {
    closeNotificationPanel();
    return;
  }

  const rect = trigger.getBoundingClientRect();
  panel.style.top = `${Math.max(12, Math.round(rect.bottom + 8))}px`;
  panel.style.right = `${Math.max(12, Math.round(window.innerWidth - rect.right))}px`;
  panel.classList.add('active');

  notificationHistory.forEach((item) => { item.unread = false; });
  unreadNotificationCount = 0;
  updateNotificationDot();
}

function attachNotificationHandlers() {
  document.querySelectorAll('.global-notification-trigger').forEach((button) => {
    if (button.dataset.notifBound === 'true') return;
    button.dataset.notifBound = 'true';

    button.addEventListener('click', (event) => {
      event.stopPropagation();
      toggleNotificationPanel(button);
    });
  });

  if (document.body.dataset.notifGlobalBound === 'true') return;
  document.body.dataset.notifGlobalBound = 'true';

  document.addEventListener('click', (event) => {
    const panel = document.getElementById('global-notification-panel');
    if (!panel || !panel.classList.contains('active')) return;

    if (panel.contains(event.target)) return;
    if (event.target.closest('.global-notification-trigger')) return;
    closeNotificationPanel();
  });
}

function openProofDocument(proofUrl) {
  const url = String(proofUrl || '').trim();
  if (!url) {
    showProofError('No proof document attached to this request.');
    return;
  }

  // Remove any existing viewer
  const existing = document.getElementById('proof-viewer-overlay');
  if (existing) existing.remove();

  const isDataUrl = url.startsWith('data:');
  const mime = isDataUrl ? url.slice(5, Math.max(url.indexOf(';'), url.indexOf(','))).replace(/[;,].*/, '') : '';
  const isImage = isDataUrl ? mime.startsWith('image/') : /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(url);
  const isPdf   = (isDataUrl && mime === 'application/pdf') || /\.pdf$/i.test(url);

  const overlay = document.createElement('div');
  overlay.id = 'proof-viewer-overlay';
  overlay.style.cssText = [
    'position:fixed;inset:0;z-index:99999;',
    'background:rgba(11,15,20,.93);',
    'display:flex;flex-direction:column;',
    'animation:proofFadeIn .15s ease;',
  ].join('');

  // Inject keyframe once
  if (!document.getElementById('proof-viewer-style')) {
    const s = document.createElement('style');
    s.id = 'proof-viewer-style';
    s.textContent = '@keyframes proofFadeIn{from{opacity:0}to{opacity:1}}';
    document.head.appendChild(s);
  }

  // Data URLs only contain base64-safe chars; plain URLs don't need HTML-escaping here.
  const safeUrl = url;

  overlay.innerHTML = `
    <div style="padding:10px 16px;display:flex;align-items:center;justify-content:space-between;
                border-bottom:1px solid rgba(255,255,255,.12);flex-shrink:0;gap:12px;">
      <span style="color:#e6eef8;font-size:13px;font-weight:600;">Proof Document</span>
      <div style="display:flex;gap:10px;align-items:center;">
        <a id="proof-dl-link" href="${safeUrl}" download="proof-document"
           style="color:#60a5fa;font-size:12px;text-decoration:underline;cursor:pointer;">
          ⬇ Download
        </a>
        <button id="proof-close-btn"
          style="background:#ef4444;border:none;color:#fff;padding:5px 14px;
                 border-radius:6px;cursor:pointer;font-size:13px;font-weight:600;">
          ✕ Close
        </button>
      </div>
    </div>
    <div id="proof-viewer-body"
         style="flex:1;display:flex;align-items:center;justify-content:center;
                overflow:auto;padding:${(isPdf || (!isImage && isDataUrl)) ? '0' : '20px'};"></div>
  `;

  document.body.appendChild(overlay);

  const body = document.getElementById('proof-viewer-body');

  if (isImage) {
    const img = document.createElement('img');
    img.src = url;
    img.alt = 'Proof Document';
    img.style.cssText = 'max-width:100%;max-height:100%;object-fit:contain;border-radius:6px;box-shadow:0 4px 32px rgba(0,0,0,.6);';
    body.appendChild(img);
  } else if (isPdf || isDataUrl) {
    const frame = document.createElement('iframe');
    frame.src = url;
    frame.title = 'Proof Document';
    frame.style.cssText = 'width:100%;height:100%;border:none;';
    body.appendChild(frame);
  } else {
    body.innerHTML = `
      <div style="color:#e6eef8;text-align:center;font-family:system-ui,sans-serif;padding:32px;">
        <div style="font-size:48px;margin-bottom:16px;">📎</div>
        <div style="margin-bottom:12px;">This file type cannot be previewed inline.</div>
        <a href="${safeUrl}" download
           style="color:#60a5fa;text-decoration:underline;font-size:14px;">Download the file</a>
      </div>`;
  }

  function closeViewer() {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  }

  function onKey(e) { if (e.key === 'Escape') closeViewer(); }

  document.getElementById('proof-close-btn').addEventListener('click', closeViewer);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeViewer(); });
  document.addEventListener('keydown', onKey);
}

function showProofError(message) {
  const banner = document.createElement('div');
  banner.style.cssText = [
    'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);',
    'background:#1e293b;border:1px solid #475569;border-radius:8px;',
    'color:#e6eef8;padding:12px 20px;font-size:13px;z-index:99999;',
    'box-shadow:0 4px 16px rgba(0,0,0,.4);',
  ].join('');
  banner.textContent = message;
  document.body.appendChild(banner);
  setTimeout(() => banner.remove(), 4000);
}

/* ── GLOBAL SCROLL HELPERS ── */
let observedScrollTarget = null;

function isScrollableElement(element) {
  if (!element) return false;
  const styles = window.getComputedStyle(element);
  const allowsScroll = styles.overflowY === 'auto' || styles.overflowY === 'scroll';
  return allowsScroll && element.scrollHeight > element.clientHeight;
}

function getActiveScrollContainer() {
  const activeScreen = document.querySelector('.screen.active');
  if (!activeScreen) {
    return document.scrollingElement || document.documentElement;
  }

  const activePage = activeScreen.querySelector('.page.active');
  if (activePage) return activePage;

  const employeeBody = activeScreen.querySelector('.emp-body');
  if (employeeBody) return employeeBody;

  const mainArea = activeScreen.querySelector('.main');
  if (mainArea) return mainArea;

  if (isScrollableElement(activeScreen)) return activeScreen;

  if (activePage) return activePage;

  return document.scrollingElement || document.documentElement;
}

function scrollWebsite(direction = 'down', amount = 320) {
  const target = getActiveScrollContainer();
  const delta = direction === 'up' ? -Math.abs(amount) : Math.abs(amount);

  target.scrollBy({
    top: delta,
    behavior: 'smooth',
  });
}

function scrollWebsiteTo(position = 'top') {
  const target = getActiveScrollContainer();
  const top = position === 'bottom' ? target.scrollHeight : 0;

  target.scrollTo({
    top,
    behavior: 'smooth',
  });
}

function attachScrollListeners() {
  const target = getActiveScrollContainer();
  if (!target) return;

  if (observedScrollTarget && observedScrollTarget !== target) {
    observedScrollTarget.removeEventListener('scroll', handleActiveScreenWheelRelay);
  }

  observedScrollTarget = target;
  target.addEventListener('scroll', handleActiveScreenWheelRelay, { passive: true });
}

function handleActiveScreenWheelRelay() {
  // Scroll handler placeholder to keep a stable listener reference.
}

function handleGlobalMouseWheel(event) {
  // Keep the handler for compatibility, but rely on native browser scrolling.
  if (event.ctrlKey) return;
}

/* ── RESET PASSWORD (LOGIN PAGE) ── */
function openResetPasswordModal() {
  const modal = document.getElementById('reset-password-modal');
  const input = document.getElementById('reset-identity-input');
  const feedback = document.getElementById('reset-password-feedback');
  const btn = document.getElementById('reset-submit-btn');

  if (!modal) return;

  if (input) input.value = '';
  if (feedback) { feedback.textContent = ''; feedback.style.color = ''; }
  if (btn) { btn.textContent = 'Send Reset Link'; btn.disabled = false; }

  modal.style.display = 'flex';
}

function closeResetPasswordModal() {
  const modal = document.getElementById('reset-password-modal');
  if (modal) modal.style.display = 'none';
}

async function submitResetPassword() {
  const input = document.getElementById('reset-identity-input');
  const feedback = document.getElementById('reset-password-feedback');
  const btn = document.getElementById('reset-submit-btn');

  const identity = String(input?.value || '').trim();

  if (!identity) {
    if (feedback) {
      feedback.textContent = 'Enter your Employee ID or email address.';
      feedback.style.color = '#E85555';
    }
    return;
  }

  if (btn) { btn.disabled = true; btn.textContent = 'Sending...'; }
  if (feedback) { feedback.textContent = ''; feedback.style.color = ''; }

  try {
    const response = await fetch('/api/legacy-auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identity }),
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(result.error || 'Failed to send reset link.');
    }

    if (feedback) {
      feedback.textContent = result.message || 'Reset link sent. Check your registered email address.';
      feedback.style.color = '#3EC97A';
    }
    if (btn) { btn.textContent = 'Sent'; }
    if (input) input.value = '';
  } catch (error) {
    if (feedback) {
      feedback.textContent = error.message;
      feedback.style.color = '#E85555';
    }
    if (btn) { btn.disabled = false; btn.textContent = 'Send Reset Link'; }
  }
}

/* ── LOGIN ── */
function toggleLoginPasswordVisibility() {
  const input = document.getElementById('login-password-input');
  const btn = document.getElementById('login-password-toggle');
  if (!input) return;

  const isHidden = input.type === 'password';
  input.type = isHidden ? 'text' : 'password';
  if (btn) {
    btn.textContent = isHidden ? 'Hide' : 'Show';
    btn.title = isHidden ? 'Hide password' : 'Show password';
    btn.setAttribute('aria-label', btn.title);
  }
}

async function login() {
  const usernameInput = document.getElementById('login-identity-input')?.value?.trim();
  const password = document.getElementById('login-password-input')?.value?.trim();

  if (!usernameInput || !password) {
    window.alert(`Enter your username or email and password to sign in.`);
    return;
  }

  const response = await fetch('/api/legacy-auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ employeeId: usernameInput, password }),
  });

  const result = await response.json().catch(() => ({}));

  if (!response.ok || !result.redirectTo) {
    window.alert(result.error || 'Unable to sign in.');
    return;
  }

  // result.role is sent from our updated API
  saveAuthContext(result, result.role || 'employee', usernameInput);

  window.top.location.href = result.redirectTo;
}

/* ── LOGOUT ── */
function logout() {
  localStorage.removeItem(AUTH_CONTEXT_KEY);
  clearPersistedRolePageStates();
  dispatchAuthContextChanged(null);

  const forcedRole = new URLSearchParams(window.location.search).get('role');
  if (forcedRole) {
    window.top.location.href = '/login';
    return;
  }

  ['s-super-admin', 's-admin', 's-accountant', 's-emp', 's-hr'].forEach(id => {
    document.getElementById(id)?.classList.remove('active');
  });
  document.getElementById('s-login').classList.add('active');
}

function showRoleScreen(role) {
  const screens = ['s-login', 's-super-admin', 's-admin', 's-accountant', 's-emp', 's-hr'];
  screens.forEach(id => document.getElementById(id)?.classList.remove('active'));

  if (role === 'super_admin') {
    document.getElementById('s-super-admin')?.classList.add('active');
  } else if (role === 'admin') {
    document.getElementById('s-admin')?.classList.add('active');
  } else if (role === 'accountant') {
    document.getElementById('s-accountant')?.classList.add('active');
  } else if (role === 'employee') {
    document.getElementById('s-emp')?.classList.add('active');
  } else if (role === 'hr') {
    document.getElementById('s-hr')?.classList.add('active');
  } else {
    document.getElementById('s-login')?.classList.add('active');
  }

  // Wait for active screen transition then sync scroll controls.
  setTimeout(() => {
    attachScrollListeners();
  }, 0);
}

/* ── SKELETON LOADING ── */
function skeletonRows(cols, count = 5) {
  const widths = [55, 80, 70, 90, 65, 75];
  const tds = Array.from({ length: cols }, (_, i) =>
    `<td><div class="sk-bar" style="width:${widths[i % widths.length]}%"></div></td>`
  ).join('');
  return Array.from({ length: count }, () => `<tr class="sk-row">${tds}</tr>`).join('');
}

function skeletonCards(count = 3) {
  return Array.from({ length: count }, () => `
    <div class="sk-card">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:8px;">
        <div class="sk-bar" style="width:40%;height:13px;border-radius:5px;"></div>
        <div class="sk-bar" style="width:18%;height:13px;border-radius:10px;"></div>
      </div>
      <div class="sk-bar" style="width:60%;height:10px;margin-bottom:6px;"></div>
      <div class="sk-bar" style="width:85%;height:10px;margin-bottom:6px;"></div>
      <div class="sk-bar" style="width:35%;height:9px;"></div>
    </div>
  `).join('');
}

/**
 * Shared, stale-time-capped cache for /api/admin/branches, mirroring
 * listUsersCached() on the server (src/lib/auth/users-cache.js) — every
 * portal's branch-assign, transfer-requests, and employee tables were each
 * independently re-fetching the same rarely-changing list. Concurrent
 * callers share one in-flight request; a failed fetch is never cached.
 */
let __branchesCache = null;   // { branches, expiresAt }
let __branchesInFlight = null;
const BRANCHES_CACHE_TTL_MS = 60_000;

function invalidateBranchesCache() {
  __branchesCache = null;
  __branchesInFlight = null;
}

async function fetchBranchesCached({ activeOnly = true } = {}) {
  if (__branchesCache && __branchesCache.expiresAt > Date.now()) {
    return filterBranches(__branchesCache.branches, activeOnly);
  }

  if (!__branchesInFlight) {
    __branchesInFlight = fetch('/api/admin/branches')
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('Failed to load branches.'))))
      .then((data) => {
        const branches = data.branches || [];
        __branchesCache = { branches, expiresAt: Date.now() + BRANCHES_CACHE_TTL_MS };
        return branches;
      })
      .catch((err) => {
        __branchesCache = null;
        throw err;
      })
      .finally(() => {
        __branchesInFlight = null;
      });
  }

  const branches = await __branchesInFlight;
  return filterBranches(branches, activeOnly);
}

function filterBranches(branches, activeOnly) {
  return activeOnly ? branches.filter((b) => b.status === 'Active') : branches;
}

/**
 * Same short-stale-time cache shape as fetchBranchesCached(), for
 * /api/admin/dashboard — clicking away to another sidebar page and back
 * was re-running the full dashboard aggregation every time. A short TTL
 * (payroll/attendance figures, not real-time data) keeps quick navigation
 * instant without showing meaningfully stale numbers.
 */
let __dashboardCache = null;
let __dashboardInFlight = null;
const DASHBOARD_CACHE_TTL_MS = 20_000;

function invalidateDashboardCache() {
  __dashboardCache = null;
  __dashboardInFlight = null;
}

async function fetchDashboardCached() {
  if (__dashboardCache && __dashboardCache.expiresAt > Date.now()) {
    return __dashboardCache.payload;
  }

  if (!__dashboardInFlight) {
    __dashboardInFlight = fetch('/api/admin/dashboard')
      .then(async (res) => {
        const payload = await res.json();
        if (!res.ok) throw new Error(payload.error || 'Failed to load dashboard data');
        __dashboardCache = { payload, expiresAt: Date.now() + DASHBOARD_CACHE_TTL_MS };
        return payload;
      })
      .catch((err) => {
        __dashboardCache = null;
        throw err;
      })
      .finally(() => {
        __dashboardInFlight = null;
      });
  }

  return __dashboardInFlight;
}

/**
 * Numeric-only input handling for the government-ID / bank-account fields
 * (SSS, Pag-IBIG, PhilHealth, Bank Account Number) shared across Admin's and
 * HR's Add/Edit Employee forms. Stored values are always digits-only — the
 * dashes here are a display/input-mask concern, matching each field's
 * placeholder format (e.g. 12-3456789-0) and the DB CHECK constraint added in
 * supabase/migrations/20260914_profile_id_fields_and_perf.sql, which also
 * strips non-digits server-side as a second line of defense.
 */
function digitsOnly(value) {
  return String(value || '').replace(/\D+/g, '');
}

function formatDigitGroups(digits, groups) {
  if (!groups || !groups.length) return digits;
  let result = '';
  let pos = 0;
  for (let i = 0; i < groups.length && pos < digits.length; i++) {
    const chunk = digits.slice(pos, pos + groups[i]);
    if (!chunk) break;
    result += (i > 0 ? '-' : '') + chunk;
    pos += groups[i];
  }
  return result;
}

const DIGIT_FIELD_SPECS = {
  sss_number: { maxLength: 10, groups: [2, 7, 1] },
  pagibig_number: { maxLength: 12, groups: [4, 4, 4] },
  philhealth_number: { maxLength: 12, groups: [2, 9, 1] },
  bank_account_number: { maxLength: 20, groups: null },
};

function setFormattedDigitValue(input, rawValue, groups) {
  if (!input) return;
  input.value = formatDigitGroups(digitsOnly(rawValue), groups);
}

function bindDigitInput(input, { maxLength, groups } = {}) {
  if (!input || input.dataset.digitBound === '1') return;
  input.dataset.digitBound = '1';
  input.setAttribute('inputmode', 'numeric');

  input.addEventListener('input', () => {
    const atEnd = input.selectionStart === input.value.length;
    input.value = formatDigitGroups(digitsOnly(input.value).slice(0, maxLength), groups);
    if (atEnd) input.setSelectionRange(input.value.length, input.value.length);
  });

  // Blocks a non-digit keystroke from landing at all — the 'input' handler
  // above already strips it, but this avoids the visible flicker of a
  // rejected character appearing then disappearing.
  input.addEventListener('keypress', (e) => {
    if (e.key.length === 1 && !/[0-9]/.test(e.key)) e.preventDefault();
  });

  input.addEventListener('paste', (e) => {
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text');
    input.value = formatDigitGroups(digitsOnly(text).slice(0, maxLength), groups);
  });
}

/** Binds every known numeric ID field present in the given form. */
function bindDigitFieldsIn(form) {
  if (!form) return;
  Object.keys(DIGIT_FIELD_SPECS).forEach((name) => {
    const input = form.elements[name];
    if (input) bindDigitInput(input, DIGIT_FIELD_SPECS[name]);
  });
}

/** Populates every known numeric ID field from `source`, dash-formatted. */
function populateDigitFieldsIn(form, source) {
  if (!form || !source) return;
  Object.keys(DIGIT_FIELD_SPECS).forEach((name) => {
    const input = form.elements[name];
    if (input) setFormattedDigitValue(input, source[name], DIGIT_FIELD_SPECS[name].groups);
  });
}

function attachSidebarSpotlight(sidebar) {
  if (!sidebar) return;
  sidebar.addEventListener('mousemove', (e) => {
    const rect = sidebar.getBoundingClientRect();
    sidebar.style.setProperty('--mx', `${e.clientX - rect.left}px`);
    sidebar.style.setProperty('--my', `${e.clientY - rect.top}px`);
  });
  sidebar.addEventListener('mouseleave', () => {
    sidebar.style.removeProperty('--mx');
    sidebar.style.removeProperty('--my');
  });
}

/* ── PAGINATION ── */
const _pgRegistry = {};

function createPaginator({ id, pageSize = 15, renderFn }) {
  const state = { data: [], currentPage: 1, pageSize };
  _pgRegistry[id] = state;

  function renderBar() {
    const bar = document.getElementById(`${id}-pg`);
    if (!bar) return;
    const total = state.data.length;
    const pages = Math.max(1, Math.ceil(total / state.pageSize));

    if (pages <= 1) {
      bar.innerHTML = '';
      return;
    }

    const cur = state.currentPage;
    let html = `<span class="pg-info">${total} records · page ${cur} of ${pages}</span>`;
    html += `<button ${cur === 1 ? 'disabled' : ''} onclick="paginatorGoTo('${id}',${cur - 1})">&#8249;</button>`;
    for (let p = 1; p <= pages; p++) {
      if (pages > 9 && p !== 1 && p !== pages && Math.abs(p - cur) > 2) {
        if (p === 2 || p === pages - 1) html += `<span class="pg-info">…</span>`;
        continue;
      }
      html += `<button class="${p === cur ? 'pg-active' : ''}" onclick="paginatorGoTo('${id}',${p})">${p}</button>`;
    }
    html += `<button ${cur === pages ? 'disabled' : ''} onclick="paginatorGoTo('${id}',${cur + 1})">&#8250;</button>`;
    bar.innerHTML = html;
  }

  function goToPage(page) {
    const pages = Math.max(1, Math.ceil(state.data.length / state.pageSize));
    state.currentPage = Math.min(Math.max(1, Number(page)), pages);
    const start = (state.currentPage - 1) * state.pageSize;
    renderFn(state.data.slice(start, start + state.pageSize));
    renderBar();
  }

  state._goToPage = goToPage;
  return {
    setData(data) {
      state.data = Array.isArray(data) ? data : [];
      goToPage(1);
    },
  };
}

function paginatorGoTo(id, page) {
  _pgRegistry[id]?._goToPage(Number(page));
}

/* ── INIT ── */
function initApp() {
  // Restore saved theme or default to dark
  const saved = localStorage.getItem(THEME_KEY) || 'dark';
  applyTheme(saved);

  const roleRouteMap = {
    super_admin: '/super-admin',
    admin: '/admin',
    accountant: '/accountant',
    employee: '/employee',
    hr: '/hr',
  };

  const role = new URLSearchParams(window.location.search).get('role');
  if (role) {
    const ctx = getAuthContext();
    // The proxy already verified the signed session cookie owns this portal
    // before this page could load, so localStorage (display-only) is not the
    // authority here. Repair a stale mismatch instead of redirecting on it —
    // redirecting from a value this same code is about to correct is how the
    // browser used to bounce forever between two portals.
    if (!ctx || !ctx.role) {
      window.top.location.href = '/login';
      return;
    }
    if (ctx.role !== role) {
      localStorage.setItem(AUTH_CONTEXT_KEY, JSON.stringify({ ...ctx, role }));
    }
    showRoleScreen(role);
  } else {
    // On the login page — if localStorage claims we're already signed in,
    // confirm the server session is still valid before leaving this page.
    // localStorage never expires on its own; trusting it alone would bounce
    // the browser forever between here and the portal once the session
    // cookie lapses, since the portal's proxy always sends an unauthenticated
    // visitor straight back to /login — that endless bounce is what showed up
    // as the site "flickering" and never finishing load.
    const ctx = getAuthContext();
    if (ctx && ctx.role && roleRouteMap[ctx.role]) {
      fetch('/api/rbac/me')
        .then((response) => (response.ok ? response.json() : null))
        .catch(() => null)
        .then((me) => {
          if (me?.user?.role === ctx.role) {
            window.top.location.href = roleRouteMap[ctx.role];
          } else {
            // Server disagrees (expired/missing/mismatched session): the
            // stale localStorage context can no longer be trusted.
            localStorage.removeItem(AUTH_CONTEXT_KEY);
          }
        });
    }
    showRoleScreen('');
  }

  // Rebind listeners whenever role/page classes change.
  const appRoot = document.getElementById('app-root');
  if (appRoot) {
    const observer = new MutationObserver(() => {
      attachScrollListeners();
    });

    observer.observe(appRoot, {
      subtree: true,
      attributes: true,
      attributeFilter: ['class'],
    });
  }

  document.addEventListener('keydown', (event) => {
    if (event.key === 'PageDown') {
      event.preventDefault();
      scrollWebsite('down');
    }

    if (event.key === 'PageUp') {
      event.preventDefault();
      scrollWebsite('up');
    }

    if (event.key === 'Enter') {
      const loginScreen = document.getElementById('s-login');
      if (loginScreen && loginScreen.classList.contains('active')) {
        login();
      }
    }
  });

  // Native mouse-wheel scrolling is more reliable across browsers and devices.
  // Do not intercept wheel events globally.

  // Expose helpers for manual usage when needed.
  window.scrollWebsite = scrollWebsite;
  window.scrollWebsiteTo = scrollWebsiteTo;
  window.getLegacyAuthContext = getAuthContext;
  window.confirmDestructiveAction = confirmDestructiveAction;
  window.confirmApproveAction = confirmApproveAction;
  window.pushNotification = pushNotification;
  window.openSettingsModal = openSettingsModal;
  window.closeSettingsModal = closeSettingsModal;
  window.saveProfileInfo = saveProfileInfo;
  window.persistRolePageState = persistRolePageState;
  window.getPersistedRolePageState = getPersistedRolePageState;
  window.refreshCurrentPortal = refreshCurrentPortal;
  window.openProofDocument = openProofDocument;
  window.openResetPasswordModal = openResetPasswordModal;
  window.closeResetPasswordModal = closeResetPasswordModal;
  window.submitResetPassword = submitResetPassword;
  window.toggleLoginPasswordVisibility = toggleLoginPasswordVisibility;
  window.login = login;
  window.logout = logout;
  window.createPaginator = createPaginator;
  window.paginatorGoTo = paginatorGoTo;
  window.skeletonRows = skeletonRows;
  window.skeletonCards = skeletonCards;

  // Sync auth context across tabs/windows without requiring refresh.
  window.addEventListener('storage', (event) => {
    if (event && event.key === AUTH_CONTEXT_KEY) {
      dispatchAuthContextChanged(getAuthContext());
    }
  });

  attachGlobalSearchHandlers();
  attachNotificationHandlers();
  attachLoginPasswordToggle();
}

function attachLoginPasswordToggle() {
  const btn = document.getElementById('login-password-toggle');
  if (btn && btn.dataset.toggleBound !== '1') {
    btn.dataset.toggleBound = '1';
    btn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleLoginPasswordVisibility();
    });
  }

  // Document-level delegation as a final fallback in case the inline
  // onclick and direct listener both fail to fire (overlapping element,
  // cached HTML, etc.). The dataset.toggleBound guard prevents this from
  // double-firing alongside the direct listener.
  if (!document.body.dataset.passwordToggleDelegationBound) {
    document.body.dataset.passwordToggleDelegationBound = '1';
    document.addEventListener('click', (event) => {
      const target = event.target?.closest?.('[data-action="toggle-login-password"]');
      if (!target) return;
      if (target.dataset.toggleBound === '1') return;
      event.preventDefault();
      toggleLoginPasswordVisibility();
    });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
