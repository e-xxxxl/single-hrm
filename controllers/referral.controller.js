import * as service from "../services/referral.service.js";
import { catchAsync } from "../utils/catchAsync.js";
import { recordAudit } from "../services/audit.service.js";
import { hasPermission } from "../utils/permissions.js";
import { actorEmployeeId } from "../services/access.service.js";

export const list = catchAsync(async (req, res) => {
  const query = { ...req.query };
  // Without performance:write you only see the referrals credited to you.
  if (!hasPermission(req.auth.permissions, "performance:write")) {
    query.employee = (await actorEmployeeId(req.orgId, req.auth)) || "000000000000000000000000";
  }
  res.json({ data: await service.listReferrals(req.orgId, query) });
});
export const create = catchAsync(async (req, res) => {
  const r = await service.createReferral(req.orgId, req.auth.userId, req.body);
  await recordAudit(req, { action: "referral.create", entityType: "Referral", entityId: r._id, summary: `Logged referral of "${r.referredName}"` });
  res.status(201).json({ data: r });
});
export const update = catchAsync(async (req, res) => {
  res.json({ data: await service.updateReferral(req.orgId, req.params.id, req.body) });
});
export const remove = catchAsync(async (req, res) => {
  await service.deleteReferral(req.orgId, req.params.id);
  await recordAudit(req, { action: "referral.delete", entityType: "Referral", entityId: req.params.id, summary: "Removed a referral" });
  res.json({ data: { ok: true } });
});

export default { list, create, update, remove };
