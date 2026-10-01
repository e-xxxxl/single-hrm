import * as service from "../services/target.service.js";
import { catchAsync } from "../utils/catchAsync.js";
import { recordAudit } from "../services/audit.service.js";
import { notify } from "../services/notification.service.js";
import { hasPermission } from "../utils/permissions.js";
import { AppError } from "../utils/AppError.js";
import { Employee } from "../models/hrm/Employee.js";

export const summary = catchAsync(async (req, res) => {
  res.json({ data: await service.summary(req.orgId) });
});

export const list = catchAsync(async (req, res) => {
  res.json(await service.listTargets(req.orgId, req.auth, req.query));
});

export const get = catchAsync(async (req, res) => {
  const target = await service.getTarget(req.orgId, req.params.id);
  if (!hasPermission(req.auth.permissions, "target:write")) {
    // Same visibility as the list: your own targets and your department's.
    const me = await Employee.findOne({ organizationId: req.orgId, user: req.auth.userId }).select("_id department");
    const own = me && target.employee && String(target.employee.id ?? target.employee) === String(me._id);
    const dept =
      me && !target.employee && target.department && String(target.department.id ?? target.department) === String(me.department);
    if (!own && !dept) throw AppError.notFound("Target not found");
  }
  res.json({ data: target });
});

export const create = catchAsync(async (req, res) => {
  const target = await service.createTarget(req.orgId, req.auth, req.body);
  await recordAudit(req, {
    action: "target.create",
    entityType: "Target",
    entityId: target.id,
    entityLabel: target.reference,
    summary: `Created target "${target.title}"`,
  });
  if (target.employee?.id) {
    await notify(req.orgId, {
      to: { employee: target.employee.id },
      type: "target.deadline",
      title: "A new target has been assigned to you",
      body: `${target.title} — due ${new Date(target.deadline).toLocaleDateString("en-NG")}`,
      link: `/hrm/targets/${target.id}`,
    });
  }
  res.status(201).json({ data: target });
});

export const update = catchAsync(async (req, res) => {
  res.json({ data: await service.updateTarget(req.orgId, req.params.id, req.body) });
});

export const addProgress = catchAsync(async (req, res) => {
  const target = await service.addProgress(req.orgId, req.auth, req.params.id, req.body);
  await recordAudit(req, {
    action: "target.progress",
    entityType: "Target",
    entityId: target.id,
    summary: `Progress on "${target.title}" → ${target.currentValue} (${target.progressPercent}%)`,
  });
  res.json({ data: target });
});

export const remove = catchAsync(async (req, res) => {
  const target = await service.getTarget(req.orgId, req.params.id);
  await service.deleteTarget(req.orgId, req.params.id);
  await recordAudit(req, {
    action: "target.delete",
    entityType: "Target",
    entityId: req.params.id,
    entityLabel: target.title,
    summary: `Deleted target "${target.title}"`,
  });
  res.json({ data: { ok: true } });
});

export default { summary, list, get, create, update, addProgress, remove };
