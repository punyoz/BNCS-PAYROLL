import { listUsersCached, invalidateUsersCache } from "@/lib/auth/users-cache";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { normalizeText } from "@/lib/auth/normalize";
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
  const bank_name = normalizeText(body.bank_name, "");
  const bank_account_number = normalizeText(body.bank_account_number, "");

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
  const updatedMeta = {
    ...currentMeta,
    full_name,
    bank_name,
    bank_account_number,
  };

  // Only the employee portal sends address — other roles' settings modals
  // have no such field, so an absent value must leave whatever's on file
  // untouched rather than getting wiped by an implicit empty string.
  if (body.address !== undefined) {
    updatedMeta.address = normalizeText(body.address, "");
  }

  const { error: updateError } = await supabase.auth.admin.updateUserById(user.id, {
    user_metadata: updatedMeta,
  });

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  invalidateUsersCache();

  await supabase.from("profiles").update({ full_name }).eq("id", user.id);

  return NextResponse.json({
    success: true,
    profile: {
      full_name: updatedMeta.full_name,
      address: updatedMeta.address,
      bank_name: updatedMeta.bank_name,
      bank_account_number: updatedMeta.bank_account_number,
    },
  });
}
