import { Referral } from "../models/hrm/Referral.js";
import { Employee } from "../models/hrm/Employee.js";
import { AppError } from "../utils/AppError.js";

export async function listReferrals(orgId, query = {}) {
  const filter = { organizationId: orgId };
  if (query.employee) filter.employee = query.employee;
  return Referral.find(filter).sort({ dateReferred: -1 }).populate("employee", "firstName lastName employeeId");
}

export async function createReferral(orgId, actorUserId, input) {
  const ok = await Employee.exists({ _id: input.employee, organizationId: orgId });
  if (!ok) throw AppError.badRequest("Unknown employee");
  return Referral.create({ ...input, organizationId: orgId, recordedBy: actorUserId });
}

export async function updateReferral(orgId, id, input) {
  const r = await Referral.findOneAndUpdate({ _id: id, organizationId: orgId }, { $set: input }, { new: true, runValidators: true });
  if (!r) throw AppError.notFound("Referral not found");
  return r;
}

export async function deleteReferral(orgId, id) {
  const r = await Referral.findOneAndDelete({ _id: id, organizationId: orgId });
  if (!r) throw AppError.notFound("Referral not found");
  return { ok: true };
}

export default { listReferrals, createReferral, updateReferral, deleteReferral };
