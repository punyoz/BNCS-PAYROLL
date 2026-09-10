import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sanitizeError } from "@/lib/api-error";
import { requirePermission, scopeListToBranch } from "@/lib/rbac/guard";

const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function getAdminClient() {
  if (!projectUrl || !serviceRoleKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.");
  }
  return createClient(projectUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Read-only: public.employee_info_view (id, full_name, cp_number, branch_id,
// position, status, date_hired). The service-role key bypasses the view's
// own RLS (see src/lib/rbac/guard.js's header comment), so branch scoping is
// applied here in code exactly like every other admin route.
export async function GET(request) {
  const guard = await requirePermission(request, "employee_info_readonly", "read");
  if (guard.denied) return guard.denied;

  try {
    const supabase = getAdminClient();
    const { data, error } = await supabase
      .from("employee_info_view")
      .select("id,full_name,cp_number,branch_id,position,status,date_hired");

    if (error) throw new Error(error.message);

    const rows = scopeListToBranch(data || [], guard, (r) => r.branch_id);
    rows.sort((a, b) => String(a.full_name || "").localeCompare(String(b.full_name || "")));

    return NextResponse.json({ employees: rows });
  } catch (error) {
    return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });
  }
}
