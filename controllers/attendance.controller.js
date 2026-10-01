import * as service from "../services/attendance.service.js";
import { catchAsync } from "../utils/catchAsync.js";
import { recordAudit } from "../services/audit.service.js";

const ctx = (req) => ({ ip: req.ip, userAgent: req.get("user-agent") || "" });

export const clockIn = catchAsync(async (req, res) => {
  const record = await service.clockIn(req.orgId, req.auth.userId, req.body, ctx(req));
  await recordAudit(req, {
    action: "attendance.clock_in",
    entityType: "Attendance",
    entityId: record.id,
    entityLabel: record.employee?.name,
    summary: `Clocked in${record.status === "Late" ? ` (late ${record.lateByMinutes}m)` : ""}${
      record.geofenceViolation ? " — outside branch geofence" : ""
    }`,
  });
  res.status(201).json({ data: record });
});

export const clockOut = catchAsync(async (req, res) => {
  const record = await service.clockOut(req.orgId, req.auth.userId, req.body, ctx(req));
  await recordAudit(req, {
    action: "attendance.clock_out",
    entityType: "Attendance",
    entityId: record.id,
    entityLabel: record.employee?.name,
    summary: `Clocked out — ${record.totalHours ?? 0}h`,
  });
  res.json({ data: record });
});

export const myStatus = catchAsync(async (req, res) => {
  res.json({ data: await service.myStatus(req.orgId, req.auth.userId) });
});

export const today = catchAsync(async (req, res) => {
  res.json(await service.listForDay(req.orgId, req.query));
});

export const records = catchAsync(async (req, res) => {
  res.json(await service.listRecords(req.orgId, req.query));
});

export const monthly = catchAsync(async (req, res) => {
  res.json({ data: await service.monthlyReport(req.orgId, req.query) });
});

export const punctuality = catchAsync(async (req, res) => {
  res.json({ data: await service.punctualityRanking(req.orgId, req.auth, req.query) });
});

export const manualEntry = catchAsync(async (req, res) => {
  const record = await service.manualUpsert(req.orgId, req.auth.userId, req.body);
  await recordAudit(req, {
    action: "attendance.manual_entry",
    entityType: "Attendance",
    entityId: record._id,
    summary: `Manual attendance entry (${req.body.status}) for ${req.body.dayKey}`,
    metadata: { employee: req.body.employee, dayKey: req.body.dayKey },
  });
  res.status(201).json({ data: record });
});

export default { clockIn, clockOut, myStatus, today, records, monthly, manualEntry };
