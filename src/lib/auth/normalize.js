export function normalizeText(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

export function normalizeRole(value) {
  const role = normalizeText(value).toLowerCase();
  if (role === "super_admin") return "super_admin";
  if (role === "admin") return "admin";
  if (role === "accountant") return "accountant";
  if (role === "hr") return "hr";
  return "employee";
}

export function normalizeRoleEmail(emailInput) {
  const email = normalizeText(emailInput).toLowerCase();
  const atIndex = email.indexOf("@");
  if (atIndex <= 0 || atIndex === email.length - 1) {
    return "";
  }
  return email;
}

/**
 * Strips everything but digits (a client may send a dash-formatted value like
 * "12-3456789-0") and caps the result at maxLength. Used for the numeric-only
 * ID/account fields (SSS, Pag-IBIG, PhilHealth, bank account) — the stored
 * value is always digits-only; dashes are a display/input-mask concern only.
 * Server-side defense in depth alongside each field's DB CHECK constraint —
 * never trust client-side input masking alone.
 */
export function normalizeDigits(value, maxLength) {
  const digits = String(value ?? "").replace(/\D+/g, "");
  return maxLength ? digits.slice(0, maxLength) : digits;
}
