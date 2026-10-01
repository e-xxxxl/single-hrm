import * as service from "../services/branch.service.js";
import { catchAsync } from "../utils/catchAsync.js";
import { recordAudit } from "../services/audit.service.js";

export const list = catchAsync(async (req, res) => {
  res.json(await service.listBranches(req.orgId, req.query));
});

export const get = catchAsync(async (req, res) => {
  res.json({ data: await service.getBranch(req.orgId, req.params.id) });
});

export const create = catchAsync(async (req, res) => {
  const branch = await service.createBranch(req.orgId, req.body);
  await recordAudit(req, {
    action: "branch.create",
    entityType: "Branch",
    entityId: branch._id,
    entityLabel: branch.name,
    summary: `Created branch ${branch.name}`,
  });
  res.status(201).json({ data: branch });
});

export const update = catchAsync(async (req, res) => {
  const branch = await service.updateBranch(req.orgId, req.params.id, req.body);
  await recordAudit(req, {
    action: "branch.update",
    entityType: "Branch",
    entityId: branch._id,
    entityLabel: branch.name,
    summary: `Updated branch ${branch.name}`,
  });
  res.json({ data: branch });
});

export const setStatus = catchAsync(async (req, res) => {
  const branch = await service.setBranchStatus(req.orgId, req.params.id, req.body.status);
  await recordAudit(req, {
    action: "branch.status",
    entityType: "Branch",
    entityId: branch._id,
    entityLabel: branch.name,
    summary: `Set branch status to ${branch.status}`,
  });
  res.json({ data: branch });
});

export const remove = catchAsync(async (req, res) => {
  const { branch } = await service.getBranch(req.orgId, req.params.id);
  await service.deleteBranch(req.orgId, req.params.id);
  await recordAudit(req, {
    action: "branch.delete",
    entityType: "Branch",
    entityId: req.params.id,
    entityLabel: branch.name,
    summary: `Deleted branch ${branch.name}`,
  });
  res.json({ data: { ok: true } });
});

export default { list, get, create, update, setStatus, remove };
