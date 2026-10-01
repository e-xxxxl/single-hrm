import * as service from "../services/user.service.js";
import { catchAsync } from "../utils/catchAsync.js";
import { recordAudit } from "../services/audit.service.js";

export const list = catchAsync(async (req, res) => {
  res.json(await service.listUsers(req.orgId, req.query));
});

export const roles = catchAsync(async (req, res) => {
  res.json({ data: service.rolesCatalogue(req.auth.role) });
});

export const get = catchAsync(async (req, res) => {
  res.json({ data: await service.getUser(req.orgId, req.params.id) });
});

export const create = catchAsync(async (req, res) => {
  const { user, tempPassword } = await service.createUser(req.orgId, req.auth, req.body);
  await recordAudit(req, {
    action: "user.create",
    entityType: "User",
    entityId: user._id,
    entityLabel: user.email,
    summary: `Created a ${user.role} login for ${user.name} (${user.email})`,
  });
  res.status(201).json({ data: user, meta: tempPassword ? { tempPassword } : undefined });
});

export const update = catchAsync(async (req, res) => {
  const result = await service.updateUser(req.orgId, req.auth, req.params.id, req.body);
  await recordAudit(req, {
    action: "user.update",
    entityType: "User",
    entityId: result.user._id,
    entityLabel: result.user.email,
    summary: `Updated login ${result.user.email} (${Object.keys(req.body).join(", ")})`,
    metadata: req.body,
  });
  res.json({ data: result });
});

export const resetPassword = catchAsync(async (req, res) => {
  const { tempPassword, user } = await service.resetPassword(req.orgId, req.auth, req.params.id, req.body.password);
  await recordAudit(req, {
    action: "user.reset_password",
    entityType: "User",
    entityId: user._id,
    entityLabel: user.email,
    summary: `Reset the password for ${user.email}`,
  });
  res.json({ data: { tempPassword } });
});

export default { list, roles, get, create, update, resetPassword };
