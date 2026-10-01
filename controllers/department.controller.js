import * as service from "../services/department.service.js";
import { catchAsync } from "../utils/catchAsync.js";
import { recordAudit } from "../services/audit.service.js";

export const list = catchAsync(async (req, res) => {
  res.json(await service.listDepartments(req.orgId, req.query));
});

export const get = catchAsync(async (req, res) => {
  res.json({ data: await service.getDepartment(req.orgId, req.params.id) });
});

export const create = catchAsync(async (req, res) => {
  const department = await service.createDepartment(req.orgId, req.body);
  await recordAudit(req, {
    action: "department.create",
    entityType: "Department",
    entityId: department._id,
    entityLabel: department.name,
    summary: `Created department ${department.name}`,
  });
  res.status(201).json({ data: department });
});

export const update = catchAsync(async (req, res) => {
  const department = await service.updateDepartment(req.orgId, req.params.id, req.body);
  await recordAudit(req, {
    action: "department.update",
    entityType: "Department",
    entityId: department._id,
    entityLabel: department.name,
    summary: `Updated department ${department.name}`,
  });
  res.json({ data: department });
});

export const setStatus = catchAsync(async (req, res) => {
  const department = await service.setDepartmentStatus(req.orgId, req.params.id, req.body.status);
  await recordAudit(req, {
    action: "department.status",
    entityType: "Department",
    entityId: department._id,
    entityLabel: department.name,
    summary: `Set department status to ${department.status}`,
  });
  res.json({ data: department });
});

export const remove = catchAsync(async (req, res) => {
  const department = await service.getDepartment(req.orgId, req.params.id);
  await service.deleteDepartment(req.orgId, req.params.id);
  await recordAudit(req, {
    action: "department.delete",
    entityType: "Department",
    entityId: req.params.id,
    entityLabel: department.department.name,
    summary: `Deleted department ${department.department.name}`,
  });
  res.json({ data: { ok: true } });
});

export default { list, get, create, update, setStatus, remove };
