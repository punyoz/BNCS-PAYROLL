import { listUsersCached } from "@/lib/auth/users-cache";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sanitizeError } from "@/lib/api-error";
import { normalizeText } from "@/lib/auth/normalize";

const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function getAdminClient() {
  if (!projectUrl || !serviceRoleKey) {
    throw new Error("Missing Supabase environment variables.");
  }
  return createClient(projectUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Where the password-reset link should send the user.
 *
 * This used to be built straight from the request's Origin header — a value
 * the caller controls. Sending `Origin: https://evil.com` produced a reset
 * link pointing at the attacker's site, so anyone who could trigger a reset
 * for an account could have the recovery token delivered to themselves.
 *
 * The destination is now decided server-side. APP_URL is authoritative. A
 * request's own origin is honoured only when it appears in APP_URL_ALLOWLIST
 * (comma-separated), which keeps multi-host deployments working without
 * trusting arbitrary input. When neither is configured we return an empty
 * string and omit redirectTo entirely, which makes Supabase fall back to the
 * project's own configured Site URL — the safe default, never the caller's.
 */
function resolveResetRedirect(request) {
  const stripSlash = (value) => normalizeText(value).replace(/\/+$/, "");

  const allowlist = normalizeText(process.env.APP_URL_ALLOWLIST)
    .split(",")
    .map(stripSlash)
    .filter(Boolean);

  const origin = stripSlash(request.headers.get("origin"));
  if (origin && allowlist.includes(origin)) {
    return `${origin}/reset-password`;
  }

  const configured = stripSlash(process.env.APP_URL);
  if (configured) {
    return `${configured}/reset-password`;
  }

  return "";
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const identity = normalizeText(body.identity);

    if (!identity) {
      return NextResponse.json({ error: "Employee ID or email is required." }, { status: 400 });
    }

    const supabase = getAdminClient();
    const { data: listData, error: listError } = await listUsersCached(supabase);

    if (listError) {
      throw new Error(listError.message);
    }

    const lower = identity.toLowerCase();
    const user = (listData.users || []).find((u) => {
      const meta = u.user_metadata || {};
      const empId = normalizeText(meta.employee_id).toLowerCase();
      const fullEmail = normalizeText(u.email).toLowerCase();
      const rawEmail = fullEmail.replace(/^sacs\./, "");
      return empId === lower || fullEmail === lower || rawEmail === lower;
    });

    // Always return success to prevent account enumeration
    const genericSuccess = {
      success: true,
      message:
        "If an account exists for this identity, a password reset link has been sent to the registered email address.",
    };

    if (!user) {
      return NextResponse.json(genericSuccess);
    }

    const role = normalizeText(user.user_metadata?.role).toLowerCase();
    if (role === "admin") {
      // Admin accounts cannot use this reset flow
      return NextResponse.json(genericSuccess);
    }

    if (!anonKey) {
      // Without an anon key we cannot trigger the reset email; respond generically.
      return NextResponse.json(genericSuccess);
    }

    const redirectTo = resolveResetRedirect(request);

    const anonClient = createClient(projectUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    await anonClient.auth.resetPasswordForEmail(
      user.email,
      redirectTo ? { redirectTo } : undefined,
    );

    return NextResponse.json(genericSuccess);
  } catch (error) {
    return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });
  }
}
