import { listUsersCached, invalidateUsersCache } from "@/lib/auth/users-cache";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { normalizeText, normalizeDigits } from "@/lib/auth/normalize";
import { requirePermission, resolveTargetEmail } from "@/lib/rbac/guard";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function POST(request) {
  // "profile" is SCOPE_SELF for every role in the matrix, so this always
  // resolves to the caller's own session email. Previously the account to edit
  // was taken from body.email with no check that it was the caller's, which
  // let any signed-in user rewrite another employee's bank_account_number —
  // i.e. redirect someone else's salary payment.
  const guard = await requirePermission(request, "profile", "update");
  if (guard.denied) return guard.denied;

  const body = await request.json().catch(() => ({}));

  const email = resolveTargetEmail(guard, body.email);
  const full_name = normalizeText(body.full_name, "");

  if (!email) {
    return NextResponse.json({ error: "Email is required." }, { status: 400 });
  }

  if (!full_name) {
    return NextResponse.json({ error: "Full name is required." }, { status: 400 });
  }

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "Server configuration error." }, { status: 500 });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: usersData, error: listError } = await listUsersCached(supabase);
  if (listError) {
    return NextResponse.json({ error: "Failed to verify account." }, { status: 500 });
  }

  const user = (usersData.users || []).find(
    (u) => (u.email || "").toLowerCase() === email.toLowerCase(),
  );

  if (!user) {
    return NextResponse.json({ error: "Account not found." }, { status: 404 });
  }

  const currentMeta = user.user_metadata || {};
  const isEmployee = guard.role === "employee";

  const updatedMeta = {
    ...currentMeta,
    full_name,
    // An employee can see their bank details on this same screen but never
    // change them here — that stays HR/Admin's call, through the employee-
    // management routes. Hiding the fields client-side (readonly inputs) is
    // trivially bypassed by a direct API call, so it's enforced here too:
    // whatever the body sends for these two is ignored for that role.
    bank_name: isEmployee
      ? normalizeText(currentMeta.bank_name, "")
      : normalizeText(body.bank_name, ""),
    bank_account_number: isEmployee
      ? normalizeText(currentMeta.bank_account_number, "")
      : normalizeText(body.bank_account_number, ""),
  };

  // Only the employee portal sends address/cp_number — other roles' settings
  // modals have no such fields, so an absent value must leave whatever's on
  // file untouched rather than getting wiped by an implicit empty string.
  if (body.address !== undefined) {
    updatedMeta.address = normalizeText(body.address, "");
  }
  if (body.cp_number !== undefined) {
    updatedMeta.cp_number = normalizeDigits(body.cp_number, 11);
  }

  const { error: updateError } = await supabase.auth.admin.updateUserById(user.id, {
    user_metadata: updatedMeta,
  });

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  invalidateUsersCache();

  // profiles is authoritative for cp_number (see
  // supabase/migrations/20260910_transfer_requests_and_employee_contact.sql)
  // — every employee-listing route reads it from there, not user_metadata.
  const profilePatch = { full_name };
  if (body.cp_number !== undefined) {
    profilePatch.cp_number = updatedMeta.cp_number || null;
  }
  await supabase.from("profiles").update(profilePatch).eq("id", user.id);

  return NextResponse.json({
    success: true,
    profile: {
      full_name: updatedMeta.full_name,
      address: updatedMeta.address,
      cp_number: updatedMeta.cp_number,
      bank_name: updatedMeta.bank_name,
      bank_account_number: updatedMeta.bank_account_number,
    },
  });
}
