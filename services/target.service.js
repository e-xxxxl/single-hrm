import mongoose from "mongoose";
import { Target } from "../models/hrm/Target.js";
import { Kpi } from "../models/hrm/Kpi.js";
import { Employee } from "../models/hrm/Employee.js";
import { nextCode } from "../models/hrm/Counter.js";
import { AppError } from "../utils/AppError.js";
import { hasPermission } from "../utils/permissions.js";
import { parsePagination, paginated } from "../utils/query.js";

const oid = (id) => new mongoose.Types.ObjectId(String(id));

export async function listTargets(orgId, actor, query = {}) {
  const { page, limit, skip } = parsePagination(query);
  const filter = { organizationId: orgId };
  if (query.status) filter.status = query.status;
  if (query.employee) filter.employee = query.employee;
  if (query.department) filter.department = query.department;

  const canManage = hasPermission(actor.permissions, "target:write");
  if (query.scope === "mine" || !canManage) {
    const me = await Employee.findOne({ organizationId: orgId, user: actor.userId }).select("_id department");
    if (query.scope === "mine" || !hasPermission(actor.permissions, "target:read") || !canManage) {
      filter.$or = [
        { employee: me?._id || oid("000000000000000000000000") },
        { department: me?.department, employee: null },
      ];
    }
  }

  const [items, total] = await Promise.all([
    Target.find(filter)
      .sort({ deadline: 1 })
      .skip(skip)
      .limit(limit)
      .populate("employee", "firstName lastName employeeId")
      .populate("department", "name")
      .populate("kpi", "name unit"),
    Target.countDocuments(filter),
  ]);
  return paginated(items.map((t) => t.toJSON()), total, { page, limit });
}

export async function getTarget(orgId, id) {
  const target = await Target.findOne({ _id: id, organizationId: orgId })
    .populate("employee", "firstName lastName employeeId position")
    .populate("department", "name")
    .populate("kpi", "name unit direction");
  if (!target) throw AppError.notFound("Target not found");
  return target.toJSON();
}

export async function createTarget(orgId, actor, input) {
  if (!input.employee && !input.department) {
    throw AppError.badRequest("A target must be assigned to an employee or a department");
  }
  if (input.employee) {
    const ok = await Employee.exists({ _id: input.employee, organizationId: orgId });
    if (!ok) throw AppError.badRequest("Unknown employee");
  }
  let kpiName = input.kpiName;
  if (input.kpi) {
    const kpi = await Kpi.findOne({ _id: input.kpi, organizationId: orgId });
    if (!kpi) throw AppError.badRequest("Unknown KPI");
    kpiName = kpi.name;
  }

  const reference = await nextCode("TG", `${orgId}:target`, 4);
  const target = new Target({
    ...input,
    organizationId: orgId,
    reference,
    kpiName,
    currentValue: input.currentValue ?? input.baselineValue ?? 0,
    assignedBy: actor.userId,
  });
  target.refreshStatus();
  await target.save();
  return getTarget(orgId, target._id);
}

export async function updateTarget(orgId, id, input) {
  const target = await Target.findOne({ _id: id, organizationId: orgId });
  if (!target) throw AppError.notFound("Target not found");
  const editable = ["title", "description", "targetValue", "baselineValue", "metricUnit", "direction", "startDate", "deadline", "weight"];
  for (const key of editable) if (input[key] !== undefined) target[key] = input[key];
  if (input.status && ["cancelled", "achieved", "missed"].includes(input.status)) {
    target.status = input.status;
    if (input.status === "achieved") target.completedAt = new Date();
  } else {
    target.refreshStatus();
  }
  await target.save();
  return getTarget(orgId, target._id);
}

export async function addProgress(orgId, actor, id, { value, note }) {
  const target = await Target.findOne({ _id: id, organizationId: orgId });
  if (!target) throw AppError.notFound("Target not found");
  if (["cancelled"].includes(target.status)) throw AppError.badRequest("This target is cancelled");

  if (!hasPermission(actor.permissions, "target:write")) {
    const me = await Employee.findOne({ organizationId: orgId, user: actor.userId }).select("_id");
    if (!me || String(target.employee) !== String(me._id)) {
      throw AppError.forbidden("You can only update progress on your own targets");
    }
  }

  target.currentValue = value;
  target.progressUpdates.push({ value, note, by: actor.userId, byName: actor.name, at: new Date() });
  target.refreshStatus();
  await target.save();
  return getTarget(orgId, target._id);
}

export async function summary(orgId) {
  const rows = await Target.aggregate([
    { $match: { organizationId: oid(orgId) } },
    { $group: { _id: "$status", n: { $sum: 1 } } },
  ]);
  const counts = Object.fromEntries(rows.map((r) => [r._id, r.n]));
  const dueSoon = await Target.find({
    organizationId: orgId,
    status: { $in: ["not_started", "in_progress", "at_risk"] },
    deadline: { $gte: new Date(), $lte: new Date(Date.now() + 14 * 86400000) },
  })
    .sort({ deadline: 1 })
    .limit(10)
    .populate("employee", "firstName lastName")
    .select("title deadline status employee");
  return { counts, total: rows.reduce((s, r) => s + r.n, 0), dueSoon };
}

export async function deleteTarget(orgId, id) {
  const target = await Target.findOneAndDelete({ _id: id, organizationId: orgId });
  if (!target) throw AppError.notFound("Target not found");
  return { ok: true };
}

export default { listTargets, getTarget, createTarget, updateTarget, addProgress, deleteTarget, summary };
