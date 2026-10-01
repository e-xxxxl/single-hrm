import mongoose from "mongoose";
import { TripLog } from "../models/hrm/TripLog.js";
import { Employee } from "../models/hrm/Employee.js";
import { AppError } from "../utils/AppError.js";
import { parsePagination, paginated } from "../utils/query.js";
import { dayKey as toDayKey } from "../utils/datetime.js";

export async function listTrips(orgId, query = {}) {
  const { page, limit, skip } = parsePagination(query);
  const filter = { organizationId: orgId };
  if (query.employee) filter.employee = query.employee;
  if (query.from || query.to) {
    filter.dayKey = {};
    if (query.from) filter.dayKey.$gte = query.from;
    if (query.to) filter.dayKey.$lte = query.to;
  }
  if (query.unpaidOnly === "true") filter.payrollRun = null;

  const [items, total, summary] = await Promise.all([
    TripLog.find(filter)
      .sort({ dayKey: -1 })
      .skip(skip)
      .limit(limit)
      .populate("employee", "firstName lastName employeeId"),
    TripLog.countDocuments(filter),
    TripLog.aggregate([
      { $match: matchStage(orgId, query) },
      { $group: { _id: null, count: { $sum: 1 }, overrideTotal: { $sum: { $ifNull: ["$amountOverride", 0] } } } },
    ]),
  ]);
  return { ...paginated(items, total, { page, limit }), summary: summary[0] || { count: 0, overrideTotal: 0 } };
}

function matchStage(orgId, query) {
  const m = { organizationId: new mongoose.Types.ObjectId(String(orgId)) };
  if (query.employee) m.employee = new mongoose.Types.ObjectId(String(query.employee));
  return m;
}

export async function createTrip(orgId, input, actorUserId) {
  const emp = await Employee.findOne({ _id: input.employee, organizationId: orgId });
  if (!emp) throw AppError.notFound("Employee not found");
  const date = new Date(input.date);
  return TripLog.create({
    organizationId: orgId,
    employee: emp._id,
    date,
    dayKey: toDayKey(date),
    reference: input.reference,
    origin: input.origin,
    destination: input.destination,
    amountOverride: input.amountOverride,
    countsForPayroll: input.countsForPayroll ?? true,
    notes: input.notes,
    source: "manual",
    recordedBy: actorUserId,
  });
}

export async function bulkImport(orgId, rows, actorUserId) {
  const employees = await Employee.find({ organizationId: orgId }).select("_id employeeId");
  const byCode = new Map(employees.map((e) => [e.employeeId, e._id]));
  const docs = [];
  const errors = [];
  rows.forEach((row, i) => {
    const empId = byCode.get(String(row.employeeId).toUpperCase());
    if (!empId) {
      errors.push({ row: i + 1, message: `Unknown employee ${row.employeeId}` });
      return;
    }
    const date = new Date(row.date);
    if (Number.isNaN(date.getTime())) {
      errors.push({ row: i + 1, message: `Invalid date ${row.date}` });
      return;
    }
    docs.push({
      organizationId: orgId,
      employee: empId,
      date,
      dayKey: toDayKey(date),
      reference: row.reference,
      origin: row.origin,
      destination: row.destination,
      amountOverride: row.amountOverride ? Number(row.amountOverride) : undefined,
      source: "import",
      recordedBy: actorUserId,
    });
  });
  if (docs.length) await TripLog.insertMany(docs);
  return { imported: docs.length, errors };
}

export async function deleteTrip(orgId, id) {
  const trip = await TripLog.findOne({ _id: id, organizationId: orgId });
  if (!trip) throw AppError.notFound("Trip not found");
  if (trip.payrollRun) throw AppError.badRequest("This trip has already been paid and cannot be deleted");
  await trip.deleteOne();
  return { ok: true };
}

export default { listTrips, createTrip, bulkImport, deleteTrip };
