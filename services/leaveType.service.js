import { LeaveType } from "../models/hrm/LeaveType.js";
import { LeaveRequest } from "../models/hrm/LeaveRequest.js";
import { LeaveBalance } from "../models/hrm/LeaveBalance.js";
import { AppError } from "../utils/AppError.js";
import { escapeRegex } from "../utils/query.js";

/** Sensible starting set, created on demand when an org has none. */
export const DEFAULT_LEAVE_TYPES = [
  { name: "Annual Leave", code: "ANNUAL", category: "annual", paid: true, defaultDaysPerYear: 20, accrual: "annual", carryOverMaxDays: 5, minNoticeDays: 3 },
  { name: "Casual Leave", code: "CASUAL", category: "casual", paid: true, defaultDaysPerYear: 7, accrual: "annual", minNoticeDays: 1 },
  { name: "Maternity Leave", code: "MATERNITY", category: "maternity", paid: true, defaultDaysPerYear: 112, accrual: "none", genderEligibility: "Female", includeWeekends: true, requiresDocument: true, minNoticeDays: 30 },
];

export async function ensureDefaults(orgId) {
  const count = await LeaveType.countDocuments({ organizationId: orgId });
  if (count > 0) return;
  await LeaveType.insertMany(DEFAULT_LEAVE_TYPES.map((t) => ({ ...t, organizationId: orgId })));
}

export async function listLeaveTypes(orgId, query = {}) {
  await ensureDefaults(orgId);
  const filter = { organizationId: orgId };
  if (query.active === "true") filter.active = true;
  if (query.active === "false") filter.active = false;
  if (query.category) filter.category = query.category;
  if (query.search) {
    const rx = new RegExp(escapeRegex(query.search), "i");
    filter.$or = [{ name: rx }, { code: rx }];
  }
  return LeaveType.find(filter).sort({ name: 1 });
}

export async function getLeaveType(orgId, id) {
  const t = await LeaveType.findOne({ _id: id, organizationId: orgId });
  if (!t) throw AppError.notFound("Leave type not found");
  return t;
}

export async function createLeaveType(orgId, input) {
  const dup = await LeaveType.findOne({
    organizationId: orgId,
    $or: [{ code: input.code?.toUpperCase() }, { name: input.name }],
  });
  if (dup) throw AppError.conflict("A leave type with that name or code already exists");
  return LeaveType.create({ ...input, organizationId: orgId });
}

/**
 * A balance's `entitledDays` is copied from the leave type's
 * `defaultDaysPerYear` once, the first time an employee needs a balance for
 * it (see leave.service.js#getOrCreateBalance) — it's not a live reference.
 * So editing the policy here used to leave every already-created balance for
 * the current year stuck on the old number ("changed to 15, still showing
 * 20"). When the default changes, bring the current year's balances that
 * are still sitting on the *old* default up to the new one — anyone whose
 * balance was individually adjusted away from the default is left alone.
 */
export async function updateLeaveType(orgId, id, input) {
  const before = await LeaveType.findOne({ _id: id, organizationId: orgId });
  if (!before) throw AppError.notFound("Leave type not found");

  const t = await LeaveType.findOneAndUpdate(
    { _id: id, organizationId: orgId },
    { $set: input },
    { new: true, runValidators: true },
  );

  if (input.defaultDaysPerYear !== undefined && input.defaultDaysPerYear !== before.defaultDaysPerYear) {
    await LeaveBalance.updateMany(
      {
        organizationId: orgId,
        leaveType: id,
        year: new Date().getFullYear(),
        entitledDays: before.defaultDaysPerYear,
      },
      { $set: { entitledDays: input.defaultDaysPerYear } },
    );
  }

  return t;
}

export async function setLeaveTypeActive(orgId, id, active) {
  if (!active) {
    const open = await LeaveRequest.countDocuments({
      organizationId: orgId,
      leaveType: id,
      status: { $in: ["Pending", "Manager Approved", "Clarification Requested"] },
    });
    if (open > 0) {
      throw AppError.badRequest(`Cannot deactivate — ${open} open request(s) use this leave type`);
    }
  }
  const t = await LeaveType.findOneAndUpdate(
    { _id: id, organizationId: orgId },
    { $set: { active } },
    { new: true },
  );
  if (!t) throw AppError.notFound("Leave type not found");
  return t;
}

/** Hard-delete a leave type. Blocked if any request — of any status, past or present — used it, to protect history. */
export async function deleteLeaveType(orgId, id) {
  const used = await LeaveRequest.countDocuments({ organizationId: orgId, leaveType: id });
  if (used > 0) {
    throw AppError.badRequest(`Cannot delete — ${used} leave request(s) reference this type. Deactivate it instead.`);
  }
  const t = await LeaveType.findOneAndDelete({ _id: id, organizationId: orgId });
  if (!t) throw AppError.notFound("Leave type not found");
  return { ok: true };
}

export default {
  ensureDefaults,
  listLeaveTypes,
  getLeaveType,
  createLeaveType,
  updateLeaveType,
  setLeaveTypeActive,
  deleteLeaveType,
  DEFAULT_LEAVE_TYPES,
};
