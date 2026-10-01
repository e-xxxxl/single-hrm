import mongoose from "mongoose";
import { Attendance } from "../models/hrm/Attendance.js";
import { Employee } from "../models/hrm/Employee.js";
import { Organization } from "../models/hrm/Organization.js";
import { Branch } from "../models/hrm/Branch.js";
import { AppError } from "../utils/AppError.js";
import { hasPermission } from "../utils/permissions.js";
import { evaluateGeofence, reverseGeocode } from "../utils/geo.js";
import {
  dayKey as toDayKey,
  dayKeyToDate,
  minutesOfDay,
  hhmmToMinutes,
  zonedWeekday,
  monthDayKeys,
} from "../utils/datetime.js";
import { parsePagination, paginated, escapeRegex } from "../utils/query.js";
import { approvedLeaveDayKeys } from "./leave.service.js";

const oid = (id) => new mongoose.Types.ObjectId(String(id));

async function orgSettings(orgId) {
  const org = await Organization.findById(orgId).select("settings name");
  if (!org) throw AppError.badRequest("Unknown organization");
  return org.settings || {};
}

/** The Employee record for the authenticated user within this organization. */
async function selfEmployee(orgId, userId) {
  const employee = await Employee.findOne({ organizationId: orgId, user: userId }).populate(
    "branch",
    "name location geofenceRadiusMeters",
  );
  if (!employee) {
    throw AppError.badRequest(
      "Your user account is not linked to an employee record in this organization. Ask HR to complete your onboarding.",
    );
  }
  return employee;
}

function buildPunch({ at, lat, lng, accuracy, device, source }, branch, address) {
  const geo = evaluateGeofence(branch, lat, lng);
  return {
    at,
    latitude: lat,
    longitude: lng,
    accuracyMeters: accuracy ?? undefined,
    address: address || "",
    device: device || "",
    source: source || "web",
    geofenceChecked: geo.checked,
    withinGeofence: geo.withinGeofence,
    distanceMeters: geo.distanceMeters,
    allowedRadiusMeters: geo.allowedRadiusMeters,
  };
}

export async function clockIn(orgId, userId, input, ctx = {}) {
  if (input.latitude == null || input.longitude == null) {
    throw AppError.badRequest("GPS coordinates are required to clock in");
  }
  const settings = await orgSettings(orgId);
  const tz = settings.timezone || "Africa/Lagos";
  const employee = await selfEmployee(orgId, userId);

  const now = new Date();
  const key = toDayKey(now, tz);

  const existing = await Attendance.findOne({ organizationId: orgId, employee: employee._id, dayKey: key });
  if (existing?.clockIn) {
    throw AppError.conflict("You have already clocked in today");
  }

  const address = await reverseGeocode(input.latitude, input.longitude);
  const punch = buildPunch(
    {
      at: now,
      lat: input.latitude,
      lng: input.longitude,
      accuracy: input.accuracyMeters,
      device: input.device || ctx.userAgent,
      source: input.source || "web",
    },
    employee.branch,
    address,
  );

  const standard = hhmmToMinutes(settings.standardClockIn || "08:00");
  const grace = settings.lateGraceMinutes ?? 15;
  const lateBy = Math.max(0, minutesOfDay(now, tz) - standard - grace);
  const status = lateBy > 0 ? "Late" : "Present";

  const doc = await Attendance.findOneAndUpdate(
    { organizationId: orgId, employee: employee._id, dayKey: key },
    {
      $set: {
        organizationId: orgId,
        employee: employee._id,
        branch: employee.branch?._id,
        date: dayKeyToDate(key, tz),
        dayKey: key,
        clockIn: punch,
        status,
        lateByMinutes: lateBy,
        geofenceViolation: punch.geofenceChecked && punch.withinGeofence === false,
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
  return decorate(doc, employee);
}

export async function clockOut(orgId, userId, input, ctx = {}) {
  if (input.latitude == null || input.longitude == null) {
    throw AppError.badRequest("GPS coordinates are required to clock out");
  }
  const settings = await orgSettings(orgId);
  const tz = settings.timezone || "Africa/Lagos";
  const employee = await selfEmployee(orgId, userId);

  const now = new Date();
  const key = toDayKey(now, tz);

  const doc = await Attendance.findOne({ organizationId: orgId, employee: employee._id, dayKey: key });
  if (!doc || !doc.clockIn) throw AppError.badRequest("You have not clocked in today");
  if (doc.clockOut) throw AppError.conflict("You have already clocked out today");

  const address = await reverseGeocode(input.latitude, input.longitude);
  doc.clockOut = buildPunch(
    {
      at: now,
      lat: input.latitude,
      lng: input.longitude,
      accuracy: input.accuracyMeters,
      device: input.device || ctx.userAgent,
      source: input.source || "web",
    },
    employee.branch,
    address,
  );
  doc.totalHours = Math.round(((now - doc.clockIn.at) / 3_600_000) * 100) / 100;
  if (doc.clockOut.geofenceChecked && doc.clockOut.withinGeofence === false) {
    doc.geofenceViolation = true;
  }
  await doc.save();
  return decorate(doc, employee);
}

export async function myStatus(orgId, userId) {
  const settings = await orgSettings(orgId);
  const tz = settings.timezone || "Africa/Lagos";
  const employee = await selfEmployee(orgId, userId);
  const key = toDayKey(new Date(), tz);
  const record = await Attendance.findOne({ organizationId: orgId, employee: employee._id, dayKey: key });
  return {
    employee: {
      id: employee._id,
      name: employee.fullName,
      employeeId: employee.employeeId,
      branch: employee.branch ? { id: employee.branch._id, name: employee.branch.name } : null,
    },
    dayKey: key,
    standardClockIn: settings.standardClockIn || "08:00",
    record: record ? record.toJSON() : null,
    state: !record ? "not_clocked_in" : record.clockOut ? "clocked_out" : "clocked_in",
  };
}

/**
 * Dashboard roster for a single day: every active employee with their status
 * (Present / Late / Absent / Not clocked in). "On Leave" is layered in from
 * Phase 3 once the leave module exists.
 */
export async function listForDay(orgId, query = {}) {
  const settings = await orgSettings(orgId);
  const tz = settings.timezone || "Africa/Lagos";
  const key = query.date || toDayKey(new Date(), tz);
  const isToday = key === toDayKey(new Date(), tz);
  const isFuture = key > toDayKey(new Date(), tz);

  const { page, limit, skip } = parsePagination(query);

  const empFilter = { organizationId: oid(orgId), status: "active" };
  if (query.branch) empFilter.branch = oid(query.branch);
  if (query.department) empFilter.department = oid(query.department);
  if (query.search) {
    const rx = new RegExp(escapeRegex(query.search), "i");
    empFilter.$or = [{ firstName: rx }, { lastName: rx }, { employeeId: rx }];
  }

  const [employees, records, leaveSet] = await Promise.all([
    Employee.find(empFilter)
      .select("firstName lastName employeeId position department branch photoUrl")
      .populate("department", "name")
      .populate("branch", "name")
      .sort({ lastName: 1, firstName: 1 }),
    Attendance.find({ organizationId: orgId, dayKey: key }),
    approvedLeaveDayKeys(orgId, key, key, tz),
  ]);

  const byEmp = new Map(records.map((r) => [String(r.employee), r]));
  const isWorkingDay = (settings.workweek || [1, 2, 3, 4, 5]).includes(
    zonedWeekday(dayKeyToDate(key, tz), tz),
  );

  let rows = employees.map((e) => {
    const rec = byEmp.get(String(e._id));
    const onLeave = leaveSet.has(`${e._id}:${key}`);
    let status;
    if (rec) status = rec.status;
    else if (onLeave) status = "On Leave";
    else if (isFuture || !isWorkingDay) status = "—";
    else if (isToday) status = "Not Clocked In";
    else status = "Absent";
    return {
      id: String(e._id),
      employee: {
        id: e._id,
        name: `${e.firstName} ${e.lastName}`,
        employeeId: e.employeeId,
        position: e.position,
        department: e.department?.name || null,
        branch: e.branch?.name || null,
      },
      status,
      clockIn: rec?.clockIn
        ? {
            at: rec.clockIn.at,
            address: rec.clockIn.address,
            latitude: rec.clockIn.latitude,
            longitude: rec.clockIn.longitude,
            withinGeofence: rec.clockIn.withinGeofence,
          }
        : null,
      clockOut: rec?.clockOut
        ? {
            at: rec.clockOut.at,
            address: rec.clockOut.address,
            latitude: rec.clockOut.latitude,
            longitude: rec.clockOut.longitude,
            withinGeofence: rec.clockOut.withinGeofence,
          }
        : null,
      totalHours: rec?.totalHours ?? null,
      lateByMinutes: rec?.lateByMinutes ?? 0,
      geofenceViolation: rec?.geofenceViolation ?? false,
      recordId: rec?._id ?? null,
      notes: rec?.notes ?? null,
    };
  });

  if (query.status) rows = rows.filter((r) => r.status === query.status);

  const summary = rows.reduce(
    (acc, r) => {
      acc.total += 1;
      const k = { Present: "present", Late: "late", Absent: "absent", "On Leave": "onLeave", "Not Clocked In": "notClockedIn" }[r.status];
      if (k) acc[k] += 1;
      if (r.geofenceViolation) acc.geofenceViolations += 1;
      return acc;
    },
    { total: 0, present: 0, late: 0, absent: 0, onLeave: 0, notClockedIn: 0, geofenceViolations: 0 },
  );

  const pageRows = rows.slice(skip, skip + limit);
  return { ...paginated(pageRows, rows.length, { page, limit }), summary, dayKey: key, isWorkingDay };
}

/** Raw attendance records over a date range (audit / employee history tab). */
export async function listRecords(orgId, query = {}) {
  const { page, limit, skip } = parsePagination(query);
  const filter = { organizationId: orgId };
  if (query.employee) filter.employee = query.employee;
  if (query.branch) filter.branch = query.branch;
  if (query.status) filter.status = query.status;
  if (query.from || query.to) {
    filter.dayKey = {};
    if (query.from) filter.dayKey.$gte = query.from;
    if (query.to) filter.dayKey.$lte = query.to;
  }
  if (query.geofenceViolation === "true") filter.geofenceViolation = true;

  const [items, total] = await Promise.all([
    Attendance.find(filter)
      .sort({ dayKey: -1 })
      .skip(skip)
      .limit(limit)
      .populate("employee", "firstName lastName employeeId")
      .populate("branch", "name"),
    Attendance.countDocuments(filter),
  ]);
  return paginated(items, total, { page, limit });
}

/** Monthly per-employee summary grid for "YYYY-MM". */
export async function monthlyReport(orgId, query = {}) {
  const month = query.month || new Date().toISOString().slice(0, 7);
  const keys = monthDayKeys(month);
  const settings = await orgSettings(orgId);
  const tz = settings.timezone || "Africa/Lagos";
  const workweek = settings.workweek || [1, 2, 3, 4, 5];
  const todayKey = toDayKey(new Date(), tz);

  const empFilter = { organizationId: oid(orgId), status: "active" };
  if (query.department) empFilter.department = oid(query.department);
  if (query.branch) empFilter.branch = oid(query.branch);

  const employees = await Employee.find(empFilter)
    .select("firstName lastName employeeId department branch")
    .populate("department", "name")
    .populate("branch", "name")
    .sort({ lastName: 1 });

  const [records, leaveSet] = await Promise.all([
    Attendance.find({
      organizationId: orgId,
      dayKey: { $gte: keys[0], $lte: keys[keys.length - 1] },
      employee: { $in: employees.map((e) => e._id) },
    }),
    approvedLeaveDayKeys(orgId, keys[0], keys[keys.length - 1], tz),
  ]);

  const workingDays = keys.filter(
    (k) => workweek.includes(zonedWeekday(dayKeyToDate(k, tz), tz)) && k <= todayKey,
  );

  const byEmp = new Map();
  for (const r of records) {
    const arr = byEmp.get(String(r.employee)) || [];
    arr.push(r);
    byEmp.set(String(r.employee), arr);
  }

  const rows = employees.map((e) => {
    const recs = byEmp.get(String(e._id)) || [];
    const recByDay = new Map(recs.map((r) => [r.dayKey, r]));
    let present = 0;
    let late = 0;
    let absent = 0;
    let onLeave = 0;
    let hours = 0;
    const days = {};
    for (const k of keys) {
      const rec = recByDay.get(k);
      if (rec) {
        days[k] = rec.status;
        if (rec.status === "Late") late += 1;
        else if (rec.status === "Present") present += 1;
        hours += rec.totalHours || 0;
      } else if (leaveSet.has(`${e._id}:${k}`)) {
        days[k] = "On Leave";
        onLeave += 1;
      } else if (workingDays.includes(k)) {
        days[k] = "Absent";
        absent += 1;
      } else {
        days[k] = "—";
      }
    }
    return {
      id: String(e._id),
      employee: {
        id: e._id,
        name: `${e.firstName} ${e.lastName}`,
        employeeId: e.employeeId,
        department: e.department?.name || null,
        branch: e.branch?.name || null,
      },
      present,
      late,
      absent,
      onLeave,
      totalHours: Math.round(hours * 100) / 100,
      attendanceRate: workingDays.length
        ? Math.round(((present + late) / Math.max(1, workingDays.length - onLeave)) * 100)
        : null,
      days,
    };
  });

  return { month, workingDays: workingDays.length, days: keys, rows };
}

/** HR manual create / adjust (permission: attendance:manage). */
export async function manualUpsert(orgId, actorUserId, input) {
  const employee = await Employee.findOne({ _id: input.employee, organizationId: orgId }).populate(
    "branch",
    "name location geofenceRadiusMeters",
  );
  if (!employee) throw AppError.notFound("Employee not found");
  const settings = await orgSettings(orgId);
  const tz = settings.timezone || "Africa/Lagos";
  const key = input.dayKey;

  const update = {
    organizationId: orgId,
    employee: employee._id,
    branch: employee.branch?._id,
    date: dayKeyToDate(key, tz),
    dayKey: key,
    status: input.status,
    notes: input.notes,
    manualEntry: true,
    recordedBy: actorUserId,
  };

  const mkPunch = (p) =>
    p
      ? {
          at: new Date(p.at),
          latitude: p.latitude ?? employee.branch?.location?.coordinates?.[1] ?? 0,
          longitude: p.longitude ?? employee.branch?.location?.coordinates?.[0] ?? 0,
          address: p.address || "",
          source: "manual",
          geofenceChecked: false,
          withinGeofence: null,
        }
      : undefined;

  if (input.clockIn) update.clockIn = mkPunch(input.clockIn);
  if (input.clockOut) update.clockOut = mkPunch(input.clockOut);
  if (update.clockIn && update.clockOut) {
    update.totalHours = Math.round(((update.clockOut.at - update.clockIn.at) / 3_600_000) * 100) / 100;
  }

  const doc = await Attendance.findOneAndUpdate(
    { organizationId: orgId, employee: employee._id, dayKey: key },
    { $set: update },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
  return doc;
}

function decorate(doc, employee) {
  const json = doc.toJSON();
  json.employee = {
    id: employee._id,
    name: employee.fullName,
    employeeId: employee.employeeId,
    branch: employee.branch ? { id: employee.branch._id, name: employee.branch.name } : null,
  };
  return json;
}

/**
 * Ranks active employees by clock-in punctuality: how often they clock in
 * genuinely before the org's standard start time ("early") vs how often
 * they're marked Late (beyond the grace period). Ranked by (early - late)
 * descending, ties broken by more early days.
 */
export async function punctualityRanking(orgId, actor, query = {}) {
  const settings = await orgSettings(orgId);
  const tz = settings.timezone || "Africa/Lagos";
  const standard = hhmmToMinutes(settings.standardClockIn || "08:00");

  const filter = { organizationId: orgId, "clockIn.at": { $exists: true } };
  if (query.from || query.to) {
    filter.dayKey = {};
    if (query.from) filter.dayKey.$gte = query.from;
    if (query.to) filter.dayKey.$lte = query.to;
  }
  if (query.branch) filter.branch = query.branch;

  const records = await Attendance.find(filter).select("employee clockIn status").lean();

  const byEmp = new Map();
  for (const r of records) {
    const key = String(r.employee);
    if (!byEmp.has(key)) byEmp.set(key, { timesEarly: 0, timesLate: 0, timesOnTime: 0, total: 0 });
    const agg = byEmp.get(key);
    agg.total += 1;
    const clockMinutes = minutesOfDay(r.clockIn.at, tz);
    if (clockMinutes < standard) agg.timesEarly += 1;
    else if (r.status === "Late") agg.timesLate += 1;
    else agg.timesOnTime += 1;
  }

  const empFilter = { organizationId: orgId, status: "active", _id: { $in: [...byEmp.keys()] } };
  if (query.department) empFilter.department = query.department;
  const employees = await Employee.find(empFilter)
    .select("firstName lastName employeeId department branch")
    .populate("department", "name")
    .populate("branch", "name");

  const rows = employees
    .map((e) => {
      const agg = byEmp.get(String(e._id));
      return {
        employee: {
          id: e._id,
          name: e.fullName,
          employeeId: e.employeeId,
          department: e.department?.name || null,
          branch: e.branch?.name || null,
        },
        timesEarly: agg.timesEarly,
        timesLate: agg.timesLate,
        timesOnTime: agg.timesOnTime,
        totalDays: agg.total,
        score: agg.timesEarly - agg.timesLate,
      };
    })
    .sort((a, b) => b.score - a.score || b.timesEarly - a.timesEarly);

  rows.forEach((r, i) => {
    r.rank = i + 1;
  });

  // Without oversight permission, only your own row — rank still reflects
  // your true position in the full org-wide ranking above.
  if (!hasPermission(actor.permissions, "attendance:report")) {
    const me = await Employee.findOne({ organizationId: orgId, user: actor.userId }).select("_id");
    return rows.filter((r) => me && String(r.employee.id) === String(me._id));
  }
  return rows;
}

export default {
  clockIn,
  clockOut,
  myStatus,
  listForDay,
  listRecords,
  monthlyReport,
  manualUpsert,
  punctualityRanking,
};
