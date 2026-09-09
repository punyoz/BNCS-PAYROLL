import { listUsersCached } from "@/lib/auth/users-cache";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sanitizeError } from "@/lib/api-error";
import { requirePermission, resolveTargetEmail, denyForeignBranch } from "@/lib/rbac/guard";

const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function getAdminClient() {
  if (!projectUrl || !serviceRoleKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  }
  return createClient(projectUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function getCurrentPhilippineMonth() {
  const now = new Date();
  const dateStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);

  const [year, month] = dateStr.split("-").map(Number);
  const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const monthEnd = `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`;

  const monthLabel = new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    month: "long",
    year: "numeric",
  }).format(now);

  return { monthStart, monthEnd, todayKey: dateStr, monthLabel };
}

function formatPeso(amount) {
  const n = Number(amount || 0);
  if (!n) return null;
  return "₱ " + n.toLocaleString("en-PH", { maximumFractionDigits: 0 });
}

export async function GET(request) {
  try {
    const guard = await requirePermission(request, "dashboard", "read");
    if (guard.denied) return guard.denied;

    // SCOPE_SELF for Employee — pinned to the session, ?email= is ignored.
    const url = new URL(request.url);
    const email = resolveTargetEmail(guard, url.searchParams.get("email"));

    if (!email) {
      return NextResponse.json({ error: "email is required." }, { status: 400 });
    }

    const supabase = getAdminClient();

    // Find the user by email
    const usersResult = await listUsersCached(supabase);
    if (usersResult.error) {
      throw new Error(`Failed to list users: ${usersResult.error.message}`);
    }

    const user = (usersResult.data.users || []).find(
      (u) => String(u.email || "").trim().toLowerCase() === email,
    );

    if (!user) {
      return NextResponse.json({ present: 0, late: 0, absent: 0, basic_salary: null, today: null });
    }

    const foreign = denyForeignBranch(guard, user.user_metadata?.branch_id);
    if (foreign) return foreign;

    const { monthStart, monthEnd, todayKey, monthLabel } = getCurrentPhilippineMonth();

    // Fetch this month's attendance for the employee
    let present = 0;
    let late = 0;
    let absent = 0;
    let today = null;
    const records = [];

    try {
      const attResult = await supabase
        .from("attendance_logs")
        .select("status, log_date, time_in, time_out")
        .eq("employee_id", user.id)
        .gte("log_date", monthStart)
        .lt("log_date", monthEnd)
        .order("log_date", { ascending: true });

      if (!attResult.error && Array.isArray(attResult.data)) {
        for (const row of attResult.data) {
          const status = String(row.status || "").toLowerCase();
          if (status === "present") present++;
          else if (status === "late") late++;
          else if (status === "absent") absent++;

          records.push({
            date: row.log_date,
            status: row.status || "Absent",
            time_in: row.time_in || null,
            time_out: row.time_out || null,
          });

          if (row.log_date === todayKey && !today) {
            today = {
              time_in: row.time_in || null,
              time_out: row.time_out || null,
              status: row.status || "Absent",
            };
          }
        }
      }
    } catch {
      // attendance_logs table may not exist — return zeros
    }

    // Basic salary from user metadata
    const basicSalary = Number(user.user_metadata?.basic_salary || 0) || null;

    return NextResponse.json({
      present,
      late,
      absent,
      basic_salary: formatPeso(basicSalary),
      today,
      records,
      month_label: monthLabel,
      today_key: todayKey,
    });
  } catch (error) {
    return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });
  }
}
