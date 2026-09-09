import { listUsersCached } from "@/lib/auth/users-cache";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sanitizeError } from "@/lib/api-error";
import { requirePermission, resolveTargetEmail, denyForeignBranch } from "@/lib/rbac/guard";

const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

/* ── Philippine national holidays (2024-2027) ── */
const PH_HOLIDAYS = {
  "2024-01-01": { name: "New Year's Day",       type: "holiday" },
  "2024-04-09": { name: "Araw ng Kagitingan",   type: "holiday" },
  "2024-03-28": { name: "Maundy Thursday",      type: "holiday" },
  "2024-03-29": { name: "Good Friday",          type: "holiday" },
  "2024-05-01": { name: "Labor Day",            type: "holiday" },
  "2024-06-12": { name: "Independence Day",     type: "holiday" },
  "2024-08-26": { name: "National Heroes Day",  type: "holiday" },
  "2024-11-01": { name: "All Saints Day",       type: "special" },
  "2024-11-30": { name: "Bonifacio Day",        type: "holiday" },
  "2024-12-25": { name: "Christmas Day",        type: "holiday" },
  "2024-12-30": { name: "Rizal Day",            type: "holiday" },
  "2025-01-01": { name: "New Year's Day",       type: "holiday" },
  "2025-04-09": { name: "Araw ng Kagitingan",   type: "holiday" },
  "2025-04-17": { name: "Maundy Thursday",      type: "holiday" },
  "2025-04-18": { name: "Good Friday",          type: "holiday" },
  "2025-05-01": { name: "Labor Day",            type: "holiday" },
  "2025-06-12": { name: "Independence Day",     type: "holiday" },
  "2025-08-25": { name: "National Heroes Day",  type: "holiday" },
  "2025-11-01": { name: "All Saints Day",       type: "special" },
  "2025-11-30": { name: "Bonifacio Day",        type: "holiday" },
  "2025-12-25": { name: "Christmas Day",        type: "holiday" },
  "2025-12-30": { name: "Rizal Day",            type: "holiday" },
  "2026-01-01": { name: "New Year's Day",       type: "holiday" },
  "2026-04-02": { name: "Maundy Thursday",      type: "holiday" },
  "2026-04-03": { name: "Good Friday",          type: "holiday" },
  "2026-04-09": { name: "Araw ng Kagitingan",   type: "holiday" },
  "2026-05-01": { name: "Labor Day",            type: "holiday" },
  "2026-06-12": { name: "Independence Day",     type: "holiday" },
  "2026-08-31": { name: "National Heroes Day",  type: "holiday" },
  "2026-11-01": { name: "All Saints Day",       type: "special" },
  "2026-11-30": { name: "Bonifacio Day",        type: "holiday" },
  "2026-12-25": { name: "Christmas Day",        type: "holiday" },
  "2026-12-30": { name: "Rizal Day",            type: "holiday" },
  "2027-01-01": { name: "New Year's Day",       type: "holiday" },
  "2027-04-01": { name: "Maundy Thursday",      type: "holiday" },
  "2027-04-02": { name: "Good Friday",          type: "holiday" },
  "2027-04-09": { name: "Araw ng Kagitingan",   type: "holiday" },
  "2027-05-01": { name: "Labor Day",            type: "holiday" },
  "2027-06-12": { name: "Independence Day",     type: "holiday" },
  "2027-08-30": { name: "National Heroes Day",  type: "holiday" },
  "2027-11-01": { name: "All Saints Day",       type: "special" },
  "2027-11-30": { name: "Bonifacio Day",        type: "holiday" },
  "2027-12-25": { name: "Christmas Day",        type: "holiday" },
  "2027-12-30": { name: "Rizal Day",            type: "holiday" },
};

const SHIFT_IN_H  = 8;   // 08:00 AM
const SHIFT_OUT_H = 17;  // 05:00 PM
const REQ_HOURS   = 8;

function getAdminClient() {
  if (!projectUrl || !serviceRoleKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  }
  return createClient(projectUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function formatTime12(isoString) {
  if (!isoString) return null;
  try {
    return new Intl.DateTimeFormat("en-PH", {
      timeZone: "Asia/Manila",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    })
      .format(new Date(isoString))
      .toUpperCase();
  } catch {
    return null;
  }
}

function getDayName(dateStr) {
  try {
    return new Intl.DateTimeFormat("en-PH", {
      timeZone: "Asia/Manila",
      weekday: "long",
    }).format(new Date(`${dateStr}T00:00:00+08:00`));
  } catch {
    return "";
  }
}

function getDayOfWeek(dateStr) {
  try {
    return new Date(`${dateStr}T00:00:00+08:00`).getDay();
  } catch {
    return -1;
  }
}

function calcTardiness(timeInIso) {
  if (!timeInIso) return 0;
  try {
    const timeIn = new Date(timeInIso);
    const phDate = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Manila",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(timeIn);
    const shiftIn = new Date(
      `${phDate}T${String(SHIFT_IN_H).padStart(2, "0")}:00:00+08:00`,
    );
    const diff = Math.floor((timeIn - shiftIn) / 60000);
    return diff > 0 ? diff : 0;
  } catch {
    return 0;
  }
}

function calcUndertime(timeOutIso) {
  if (!timeOutIso) return 0;
  try {
    const timeOut = new Date(timeOutIso);
    const phDate = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Manila",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(timeOut);
    const shiftOut = new Date(
      `${phDate}T${String(SHIFT_OUT_H).padStart(2, "0")}:00:00+08:00`,
    );
    const diff = Math.floor((shiftOut - timeOut) / 60000);
    return diff > 0 ? diff : 0;
  } catch {
    return 0;
  }
}

function generateDateRange(startDate, endDate) {
  const dates = [];
  const cur   = new Date(`${startDate}T00:00:00+08:00`);
  const end   = new Date(`${endDate}T00:00:00+08:00`);
  while (cur <= end) {
    const y = cur.getFullYear();
    const m = String(cur.getMonth() + 1).padStart(2, "0");
    const d = String(cur.getDate()).padStart(2, "0");
    dates.push(`${y}-${m}-${d}`);
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

function getShiftInfo(dateStr) {
  const dow = getDayOfWeek(dateStr);

  if (dow === 0 || dow === 6) {
    return {
      row_type: "rest",
      shift_type: "Rest Day",
      shift_in: null,
      shift_out: null,
      required_hours: 0,
    };
  }

  const holiday = PH_HOLIDAYS[dateStr];
  if (holiday) {
    return {
      row_type: holiday.type,
      shift_type: holiday.name,
      shift_in: null,
      shift_out: null,
      required_hours: 0,
    };
  }

  return {
    row_type: "regular",
    shift_type: "Regular",
    shift_in: `${String(SHIFT_IN_H).padStart(2, "0")}:00 AM`,
    shift_out: `${String(SHIFT_OUT_H - 12).padStart(2, "0")}:00 PM`,
    required_hours: REQ_HOURS,
  };
}

export async function GET(request) {
  try {
    const guard = await requirePermission(request, "timesheet", "read");
    if (guard.denied) return guard.denied;

    // SCOPE_SELF for Employee — pinned to the session, ?email= is ignored.
    const url       = new URL(request.url);
    const email     = resolveTargetEmail(guard, url.searchParams.get("email"));
    const startDate = String(url.searchParams.get("start_date") || "").trim();
    const endDate   = String(url.searchParams.get("end_date")   || "").trim();

    if (!email) {
      return NextResponse.json({ error: "email is required." }, { status: 400 });
    }
    if (!startDate || !endDate) {
      return NextResponse.json(
        { error: "start_date and end_date are required." },
        { status: 400 },
      );
    }
    if (startDate > endDate) {
      return NextResponse.json(
        { error: "start_date must not be after end_date." },
        { status: 400 },
      );
    }

    const dayDiff = (new Date(endDate) - new Date(startDate)) / 86400000;
    if (dayDiff > 366) {
      return NextResponse.json(
        { error: "Date range cannot exceed 366 days." },
        { status: 400 },
      );
    }

    const supabase = getAdminClient();

    const usersResult = await listUsersCached(supabase);
    if (usersResult.error)
      throw new Error(`Failed to list users: ${usersResult.error.message}`);

    const user = (usersResult.data.users || []).find(
      (u) => String(u.email || "").trim().toLowerCase() === email,
    );

    if (!user) return NextResponse.json({ records: [] });

    const foreign = denyForeignBranch(guard, user.user_metadata?.branch_id);
    if (foreign) return foreign;

    /* Attendance logs for the date range */
    const attResult = await supabase
      .from("attendance_logs")
      .select("status, log_date, time_in, time_out")
      .eq("employee_id", user.id)
      .gte("log_date", startDate)
      .lte("log_date", endDate)
      .order("log_date", { ascending: true });

    const attMap = {};
    if (!attResult.error && Array.isArray(attResult.data)) {
      for (const row of attResult.data) {
        attMap[row.log_date] = row;
      }
    }

    /* Approved leave requests overlapping the date range */
    const leaveDates = new Set();
    try {
      const fullName = String(user.user_metadata?.full_name || "").trim();
      let leaveQuery = supabase
        .from("leave_requests")
        .select("start_date, end_date")
        .eq("status", "Approved")
        .lte("start_date", endDate)
        .gte("end_date", startDate);

      if (user.id) leaveQuery = leaveQuery.eq("employee_id", user.id);

      const leaveResult = await leaveQuery;
      if (!leaveResult.error && Array.isArray(leaveResult.data)) {
        for (const lv of leaveResult.data) {
          const lc = new Date(`${lv.start_date}T00:00:00+08:00`);
          const le = new Date(`${lv.end_date}T00:00:00+08:00`);
          while (lc <= le) {
            const y = lc.getFullYear();
            const m = String(lc.getMonth() + 1).padStart(2, "0");
            const d = String(lc.getDate()).padStart(2, "0");
            leaveDates.add(`${y}-${m}-${d}`);
            lc.setDate(lc.getDate() + 1);
          }
        }
      }
    } catch {
      /* leave table may not exist — silently skip */
    }

    /* Build a record for every calendar day in the range */
    const dates   = generateDateRange(startDate, endDate);
    const records = dates.map((dateStr) => {
      const shift     = getShiftInfo(dateStr);
      const att       = attMap[dateStr] || null;
      const hasLeave  = leaveDates.has(dateStr) ? 1 : 0;
      const timeInIso = att?.time_in  || null;
      const timeOutIso= att?.time_out || null;

      let tardiness = 0;
      let undertime = 0;
      if (shift.row_type === "regular" && att?.time_in) {
        tardiness = calcTardiness(att.time_in);
        if (att.time_out) undertime = calcUndertime(att.time_out);
      }

      return {
        date:           dateStr,
        day:            getDayName(dateStr),
        shift_type:     shift.shift_type,
        shift_in:       shift.shift_in,
        shift_out:      shift.shift_out,
        required_hours: shift.required_hours,
        time_in:        formatTime12(timeInIso),
        time_out:       formatTime12(timeOutIso),
        tardiness,
        undertime,
        leave_with_pay: hasLeave,
        row_type:       shift.row_type,
        status:         att?.status || (shift.row_type === "rest" ? "Rest Day" : "No Record"),
      };
    });

    return NextResponse.json({ records });
  } catch (error) {
    return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });
  }
}
