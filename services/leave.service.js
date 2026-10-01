import mongoose from "mongoose";
import { LeaveRequest } from "../models/hrm/LeaveRequest.js";
import { LeaveType } from "../models/hrm/LeaveType.js";
import { LeaveBalance } from "../models/hrm/LeaveBalance.js";
import { Employee } from "../models/hrm/Employee.js";
import { Organization } from "../models/hrm/Organization.js";
import { nextCode } from "../models/hrm/Counter.js";
import { AppError } from "../utils/AppError.js";
import { hasPermission } from "../utils/permissions.js";
import { parsePagination, paginated } from "../utils/query.js";
import { countLeaveDays, eachDayKey, dayKey as toDayKey } from "../utils/datetime.js";
import { holidaysInRange } from "./holiday.service.js";

const oid = (id) => new mongoose.Types.ObjectId(String(id));
const OPEN = ["Pending", "Manager Approved", "Clarification Requested"];
const RESERVING = ["Pending", "Manager Approved", "Clarification Requested"]; // hold pendingDays

async function settingsFor(orgId) {
  const org = await Organization.findById(orgId).select("settings");
  if (!org) throw AppError.badRequest("Unknown organization");
  return org.settings || {};
}

async function selfEmployee(orgId, userId) {
  const e = await Employee.findOne({ organizationId: orgId, user: userId })
    .populate("reportingManager", "firstName lastName")
    .populate("branch", "name")
    .populate("department", "name");
  if (!e) {
    throw AppError.badRequest(
      "Your account is not linked to an employee record in this organization. Ask HR to complete your onboarding.",
    );
  }
  return e;
}

function monthsBetween(from, to) {
  return (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
}

/* ------------------------------- balances -------------------------------- */

export async function getOrCreateBalance(orgId, employeeId, leaveType, year) {
  let balance = await LeaveBalance.findOne({
    organizationId: orgId,
    employee: employeeId,
    leaveType: leaveType._id,
    year,
  });
  if (!balance) {
    balance = await LeaveBalance.create({
      organizationId: orgId,
      employee: employeeId,
      leaveType: leaveType._id,
      year,
      entitledDays: leaveType.accrual === "none" ? leaveType.defaultDaysPerYear : leaveType.defaultDaysPerYear,
    });
  }
  return balance;
}

export async function listBalances(orgId, employeeId, year = new Date().getFullYear()) {
  const types = await LeaveType.find({ organizationId: orgId, active: true });
  const balances = [];
  for (const t of types) {
    const b = await getOrCreateBalance(orgId, employeeId, t, year);
    balances.push({
      leaveType: { id: t._id, name: t.name, code: t.code, category: t.category, paid: t.paid },
      year,
      entitledDays: b.entitledDays,
      carriedOverDays: b.carriedOverDays,
      accruedAdjustment: b.accruedAdjustment,
      usedDays: b.usedDays,
      pendingDays: b.pendingDays,
      availableDays: b.availableDays,
    });
  }
  return balances;
}

export async function adjustBalance(orgId, input) {
  const { employee, leaveType, year, entitledDays, carriedOverDays, accruedAdjustment, notes } = input;
  const type = await LeaveType.findOne({ _id: leaveType, organizationId: orgId });
  if (!type) throw AppError.badRequest("Unknown leave type");
  const emp = await Employee.exists({ _id: employee, organizationId: orgId });
  if (!emp) throw AppError.notFound("Employee not found");

  const balance = await getOrCreateBalance(orgId, employee, type, year);
  if (entitledDays !== undefined) balance.entitledDays = entitledDays;
  if (carriedOverDays !== undefined) balance.carriedOverDays = carriedOverDays;
  if (accruedAdjustment !== undefined) balance.accruedAdjustment = accruedAdjustment;
  if (notes !== undefined) balance.notes = notes;
  await balance.save();
  return balance;
}

/* --------------------------- request lifecycle -------------------------- */

async function validateEligibility(type, employee, days, startDate, settings) {
  if (!type.active) throw AppError.badRequest("That leave type is not currently available");

  if (type.genderEligibility !== "any" && employee.gender && employee.gender !== type.genderEligibility) {
    throw AppError.badRequest(`${type.name} is only available to ${type.genderEligibility} employees`);
  }
  if (type.minTenureMonths > 0) {
    const tenure = monthsBetween(new Date(employee.dateJoined), new Date());
    if (tenure < type.minTenureMonths) {
      throw AppError.badRequest(
        `${type.name} requires at least ${type.minTenureMonths} months of service`,
      );
    }
  }
  if (type.minNoticeDays > 0) {
    const noticeDays = (new Date(startDate) - Date.now()) / 86400000;
    if (noticeDays < type.minNoticeDays) {
      throw AppError.badRequest(`${type.name} needs at least ${type.minNoticeDays} days notice`);
    }
  }
  if (type.maxConsecutiveDays > 0 && days > type.maxConsecutiveDays) {
    throw AppError.badRequest(`${type.name} is limited to ${type.maxConsecutiveDays} consecutive days`);
  }
}

async function assertNoOverlap(orgId, employeeId, startDate, endDate, excludeId) {
  const clash = await LeaveRequest.findOne({
    organizationId: orgId,
    employee: employeeId,
    _id: { $ne: excludeId || null },
    status: { $in: ["Pending", "Manager Approved", "Approved", "Clarification Requested"] },
    startDate: { $lte: endDate },
    endDate: { $gte: startDate },
  });
  if (clash) {
    throw AppError.conflict(
      `You already have a ${clash.status.toLowerCase()} request (${clash.reference}) overlapping those dates`,
    );
  }
}

export async function createRequest(orgId, actor, input, { onBehalf = false } = {}) {
  const settings = await settingsFor(orgId);
  const tz = settings.timezone || "Africa/Lagos";

  let employee;
  if (onBehalf && input.employee) {
    employee = await Employee.findOne({ _id: input.employee, organizationId: orgId })
      .populate("reportingManager", "firstName lastName")
      .populate("branch", "name")
      .populate("department", "name");
    if (!employee) throw AppError.notFound("Employee not found");
  } else {
    employee = await selfEmployee(orgId, actor.userId);
  }

  const type = await LeaveType.findOne({ _id: input.leaveType, organizationId: orgId });
  if (!type) throw AppError.badRequest("Unknown leave type");

  const startDate = new Date(input.startDate);
  const endDate = new Date(input.endDate);
  if (endDate < startDate) throw AppError.badRequest("End date cannot be before start date");
  if ((input.halfDayStart || input.halfDayEnd) && !type.allowHalfDay) {
    throw AppError.badRequest(`${type.name} cannot be taken as a half day`);
  }

  const days = countLeaveDays(startDate, endDate, {
    workweek: settings.workweek || [1, 2, 3, 4, 5],
    includeWeekends: type.includeWeekends,
    halfDayStart: input.halfDayStart,
    halfDayEnd: input.halfDayEnd,
    timeZone: tz,
  });
  if (days <= 0) {
    throw AppError.badRequest("The selected dates contain no working days");
  }

  await validateEligibility(type, employee, days, startDate, settings);
  await assertNoOverlap(orgId, employee._id, startDate, endDate);

  const year = new Date(startDate).getFullYear();
  const balance = await getOrCreateBalance(orgId, employee._id, type, year);
  const isUnpaidPool = type.category === "unpaid" || (type.defaultDaysPerYear === 0 && type.accrual === "none");
  if (!isUnpaidPool && balance.availableDays < days) {
    throw AppError.badRequest(
      `Insufficient ${type.name} balance — ${balance.availableDays} day(s) available, ${days} requested`,
    );
  }

  const reference = await nextCode("LV", `${orgId}:leave`, 5);

  const request = await LeaveRequest.create({
    organizationId: orgId,
    reference,
    employee: employee._id,
    branch: employee.branch?._id,
    department: employee.department?._id,
    leaveType: type._id,
    startDate,
    endDate,
    halfDayStart: !!input.halfDayStart,
    halfDayEnd: !!input.halfDayEnd,
    days,
    year,
    reason: input.reason,
    supportingDocumentUrl: input.supportingDocumentUrl,
    contactWhileAway: input.contactWhileAway,
    lineManager: employee.reportingManager?._id,
    // Always starts awaiting a real decision — no line manager on record just
    // means HR (who can act on any request regardless of assigned manager,
    // see managerDecision below) has to clear the manager stage themselves.
    status: "Pending",
    decisions: [],
    createdBy: actor.userId,
  });

  // Reserve the days.
  balance.pendingDays += days;
  await balance.save();

  return decorate(request, employee, type);
}

export async function updateRequest(orgId, actor, id, input) {
  const request = await LeaveRequest.findOne({ organizationId: orgId, _id: id });
  if (!request) throw AppError.notFound("Leave request not found");

  const employee = await Employee.findById(request.employee);
  const isOwner = employee?.user && String(employee.user) === String(actor.userId);
  if (!isOwner) throw AppError.forbidden("Only the requester can edit this request");
  if (!["Pending", "Clarification Requested"].includes(request.status)) {
    throw AppError.badRequest("This request can no longer be edited");
  }

  const settings = await settingsFor(orgId);
  const tz = settings.timezone || "Africa/Lagos";
  const type = await LeaveType.findById(request.leaveType);

  const startDate = input.startDate ? new Date(input.startDate) : request.startDate;
  const endDate = input.endDate ? new Date(input.endDate) : request.endDate;
  if (endDate < startDate) throw AppError.badRequest("End date cannot be before start date");

  const halfDayStart = input.halfDayStart ?? request.halfDayStart;
  const halfDayEnd = input.halfDayEnd ?? request.halfDayEnd;
  const newDays = countLeaveDays(startDate, endDate, {
    workweek: settings.workweek || [1, 2, 3, 4, 5],
    includeWeekends: type.includeWeekends,
    halfDayStart,
    halfDayEnd,
    timeZone: tz,
  });
  if (newDays <= 0) throw AppError.badRequest("The selected dates contain no working days");

  await assertNoOverlap(orgId, request.employee, startDate, endDate, request._id);

  // Re-reserve against balance.
  const year = new Date(startDate).getFullYear();
  const balance = await getOrCreateBalance(orgId, request.employee, type, year);
  const isUnpaidPool = type.category === "unpaid";
  balance.pendingDays += newDays - request.days;
  if (!isUnpaidPool && balance.availableDays < 0) {
    balance.pendingDays -= newDays - request.days;
    throw AppError.badRequest("That change would exceed your available balance");
  }
  await balance.save();

  request.startDate = startDate;
  request.endDate = endDate;
  request.halfDayStart = halfDayStart;
  request.halfDayEnd = halfDayEnd;
  request.days = newDays;
  request.year = year;
  if (input.reason !== undefined) request.reason = input.reason;
  if (input.supportingDocumentUrl !== undefined) request.supportingDocumentUrl = input.supportingDocumentUrl;
  if (input.contactWhileAway !== undefined) request.contactWhileAway = input.contactWhileAway;
  if (request.status === "Clarification Requested") request.status = "Pending";
  await request.save();

  return getRequest(orgId, request._id);
}

export async function managerDecision(orgId, actor, id, { action, comment }) {
  const request = await LeaveRequest.findOne({ organizationId: orgId, _id: id });
  if (!request) throw AppError.notFound("Leave request not found");

  const canHr = hasPermission(actor.permissions, "leave:approve_hr");
  if (request.status !== "Pending" && request.status !== "Clarification Requested") {
    throw AppError.badRequest(`Request is ${request.status} — no manager action possible`);
  }

  // Must be the assigned line manager (unless HR is acting).
  if (!canHr) {
    const actorEmployee = await Employee.findOne({ organizationId: orgId, user: actor.userId });
    if (!actorEmployee || !request.lineManager || String(request.lineManager) !== String(actorEmployee._id)) {
      throw AppError.forbidden("You are not the line manager for this request");
    }
  }

  request.decisions.push({ stage: "manager", action: normalizeAction(action), by: actor.userId, byName: actor.name, comment, at: new Date() });

  if (action === "approve") {
    request.status = "Manager Approved";
  } else if (action === "reject") {
    request.status = "Rejected";
    request.decidedAt = new Date();
    await releaseReserved(orgId, request);
  } else if (action === "clarification") {
    request.status = "Clarification Requested";
  }
  await request.save();
  return getRequest(orgId, request._id);
}

export async function hrDecision(orgId, actor, id, { action, comment, coverageOverride }) {
  const request = await LeaveRequest.findOne({ organizationId: orgId, _id: id });
  if (!request) throw AppError.notFound("Leave request not found");
  if (request.status !== "Manager Approved") {
    throw AppError.badRequest(
      request.status === "Pending"
        ? "The line manager has not approved this request yet"
        : `Request is ${request.status} — no HR action possible`,
    );
  }

  if (action === "approve") {
    const coverage = await checkCoverage(orgId, request);
    if (coverage.violated && !coverageOverride) {
      throw AppError.conflict("Approving this leave would drop branch coverage below the minimum", {
        code: "COVERAGE_FLOOR",
        details: coverage,
      });
    }
    if (coverage.violated && coverageOverride) {
      if (!hasPermission(actor.permissions, "leave:configure")) {
        throw AppError.forbidden("You are not allowed to override the branch-coverage floor");
      }
      request.coverageOverride = true;
      request.coverageWarning = coverage.message;
      request.decisions.push({ stage: "hr", action: "override", by: actor.userId, byName: actor.name, comment: coverage.message, at: new Date() });
    }

    request.decisions.push({ stage: "hr", action: "approved", by: actor.userId, byName: actor.name, comment, at: new Date() });
    request.status = "Approved";
    request.decidedAt = new Date();

    // pending -> used
    const type = await LeaveType.findById(request.leaveType);
    const balance = await getOrCreateBalance(orgId, request.employee, type, request.year);
    balance.pendingDays = Math.max(0, balance.pendingDays - request.days);
    balance.usedDays += request.days;
    await balance.save();
  } else if (action === "reject") {
    request.decisions.push({ stage: "hr", action: "rejected", by: actor.userId, byName: actor.name, comment, at: new Date() });
    request.status = "Rejected";
    request.decidedAt = new Date();
    await releaseReserved(orgId, request);
  } else if (action === "clarification") {
    request.decisions.push({ stage: "hr", action: "clarification", by: actor.userId, byName: actor.name, comment, at: new Date() });
    request.status = "Clarification Requested";
  }

  await request.save();
  return getRequest(orgId, request._id);
}

export async function cancelRequest(orgId, actor, id) {
  const request = await LeaveRequest.findOne({ organizationId: orgId, _id: id });
  if (!request) throw AppError.notFound("Leave request not found");

  const employee = await Employee.findById(request.employee);
  const isOwner = employee?.user && String(employee.user) === String(actor.userId);
  const isHr = hasPermission(actor.permissions, "leave:approve_hr");
  if (!isOwner && !isHr) throw AppError.forbidden("You cannot cancel this request");

  if (["Cancelled", "Rejected"].includes(request.status)) {
    throw AppError.badRequest(`Request is already ${request.status}`);
  }
  if (request.status === "Approved" && new Date(request.startDate) <= new Date() && !isHr) {
    throw AppError.badRequest("Leave has already started — contact HR to cancel");
  }

  const wasApproved = request.status === "Approved";
  request.decisions.push({ stage: isHr ? "hr" : "manager", action: "rejected", by: actor.userId, byName: actor.name, comment: "Cancelled", at: new Date() });
  request.status = "Cancelled";
  request.decidedAt = new Date();
  await request.save();

  const type = await LeaveType.findById(request.leaveType);
  const balance = await getOrCreateBalance(orgId, request.employee, type, request.year);
  if (wasApproved) balance.usedDays = Math.max(0, balance.usedDays - request.days);
  else balance.pendingDays = Math.max(0, balance.pendingDays - request.days);
  await balance.save();

  return getRequest(orgId, request._id);
}

export async function addNote(orgId, actor, id, note) {
  const request = await LeaveRequest.findOneAndUpdate(
    { organizationId: orgId, _id: id },
    { $push: { notes: { by: actor.userId, byName: actor.name, note, at: new Date() } } },
    { new: true },
  );
  if (!request) throw AppError.notFound("Leave request not found");
  return getRequest(orgId, request._id);
}

async function releaseReserved(orgId, request) {
  const type = await LeaveType.findById(request.leaveType);
  const balance = await getOrCreateBalance(orgId, request.employee, type, request.year);
  balance.pendingDays = Math.max(0, balance.pendingDays - request.days);
  await balance.save();
}

function normalizeAction(a) {
  return { approve: "approved", reject: "rejected", clarification: "clarification" }[a] || a;
}

/* ---------------------------- coverage check --------------------------- */

export async function checkCoverage(orgId, request) {
  const settings = await settingsFor(orgId);
  const floor = settings.minBranchCoverage ?? 1;
  if (!request.branch || floor <= 0) {
    return { violated: false, floor, branchHeadcount: null, overlapping: 0, message: "" };
  }

  const branchHeadcount = await Employee.countDocuments({
    organizationId: orgId,
    branch: request.branch,
    status: "active",
  });

  const overlappingRequests = await LeaveRequest.find({
    organizationId: orgId,
    branch: request.branch,
    _id: { $ne: request._id },
    status: "Approved",
    startDate: { $lte: request.endDate },
    endDate: { $gte: request.startDate },
  }).populate("leaveType", "countsTowardCoverage");

  const overlapping = overlappingRequests.filter(
    (r) => r.leaveType?.countsTowardCoverage !== false,
  ).length;

  const remaining = branchHeadcount - overlapping - 1; // minus this request
  const violated = remaining < floor;
  return {
    violated,
    floor,
    branchHeadcount,
    overlapping,
    remainingIfApproved: remaining,
    message: violated
      ? `Branch would have ${remaining} staff available on those dates (minimum is ${floor}).`
      : "",
  };
}

/* ------------------------------- queries ------------------------------- */

function baseFilter(orgId, query) {
  const filter = { organizationId: orgId };
  if (query.status) filter.status = query.status;
  if (query.employee) filter.employee = query.employee;
  if (query.leaveType) filter.leaveType = query.leaveType;
  if (query.branch) filter.branch = query.branch;
  if (query.department) filter.department = query.department;
  if (query.from || query.to) {
    filter.startDate = filter.startDate || {};
    if (query.to) filter.startDate.$lte = new Date(query.to);
    if (query.from) filter.endDate = { $gte: new Date(query.from) };
  }
  return filter;
}

export async function listRequests(orgId, actor, query = {}) {
  const { page, limit, skip } = parsePagination(query);
  const filter = baseFilter(orgId, query);

  if (query.scope === "mine") {
    const me = await Employee.findOne({ organizationId: orgId, user: actor.userId }).select("_id");
    filter.employee = me?._id || oid("000000000000000000000000");
  } else if (query.scope === "team") {
    const me = await Employee.findOne({ organizationId: orgId, user: actor.userId }).select("_id");
    filter.lineManager = me?._id || oid("000000000000000000000000");
  } else if (!hasPermission(actor.permissions, "leave:approve_hr") && !hasPermission(actor.permissions, "leave:approve_manager")) {
    // No oversight permission → only own requests.
    const me = await Employee.findOne({ organizationId: orgId, user: actor.userId }).select("_id");
    filter.employee = me?._id || oid("000000000000000000000000");
  }

  const [items, total] = await Promise.all([
    LeaveRequest.find(filter)
      .sort({ submittedAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("employee", "firstName lastName employeeId")
      .populate("leaveType", "name code paid category")
      .populate("branch", "name")
      .populate("department", "name")
      .populate("lineManager", "firstName lastName"),
    LeaveRequest.countDocuments(filter),
  ]);
  return paginated(items, total, { page, limit });
}

export async function getRequest(orgId, id) {
  const request = await LeaveRequest.findOne({ organizationId: orgId, _id: id })
    .populate("employee", "firstName lastName employeeId position gender dateJoined")
    .populate("leaveType", "name code paid category requiresDocument")
    .populate("branch", "name")
    .populate("department", "name")
    .populate("lineManager", "firstName lastName employeeId");
  if (!request) throw AppError.notFound("Leave request not found");

  const balances = await listBalances(orgId, request.employee._id, request.year);
  const balance = balances.find((b) => String(b.leaveType.id) === String(request.leaveType._id));
  return { ...request.toJSON(), balanceSnapshot: balance || null };
}

export async function getMyLeave(orgId, actor) {
  const employee = await selfEmployee(orgId, actor.userId);
  const year = new Date().getFullYear();
  const [balances, requests] = await Promise.all([
    listBalances(orgId, employee._id, year),
    LeaveRequest.find({ organizationId: orgId, employee: employee._id })
      .sort({ submittedAt: -1 })
      .limit(50)
      .populate("leaveType", "name code paid category")
      .populate("lineManager", "firstName lastName"),
  ]);
  return {
    employee: { id: employee._id, name: employee.fullName, employeeId: employee.employeeId },
    balances,
    requests: requests.map((r) => r.toJSON()),
  };
}

/** Approved + pending leave overlapping a window, shaped for a calendar. */
export async function calendar(orgId, query = {}) {
  const from = query.from ? new Date(query.from) : startOfMonth(new Date());
  const to = query.to ? new Date(query.to) : endOfMonth(new Date());
  const filter = {
    organizationId: orgId,
    status: { $in: ["Approved", "Manager Approved", "Pending"] },
    startDate: { $lte: to },
    endDate: { $gte: from },
  };
  if (query.branch) filter.branch = query.branch;
  if (query.department) filter.department = query.department;

  const [rows, holidays] = await Promise.all([
    LeaveRequest.find(filter)
      .populate("employee", "firstName lastName employeeId")
      .populate("leaveType", "name code category")
      .populate("branch", "name")
      .sort({ startDate: 1 }),
    holidaysInRange(orgId, from, to),
  ]);

  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    items: [
      ...rows.map((r) => ({
        id: r._id,
        kind: "leave",
        reference: r.reference,
        employee: `${r.employee.firstName} ${r.employee.lastName}`,
        employeeId: r.employee.employeeId,
        leaveType: r.leaveType.name,
        category: r.leaveType.category,
        branch: r.branch?.name || null,
        startDate: r.startDate.toISOString().slice(0, 10),
        endDate: r.endDate.toISOString().slice(0, 10),
        days: r.days,
        status: r.status,
      })),
      ...holidays,
    ],
  };
}

/**
 * For attendance integration: set of `${employeeId}:${dayKey}` on APPROVED leave
 * within the given day-key range.
 */
export async function approvedLeaveDayKeys(orgId, fromKey, toKey, tz = "Africa/Lagos") {
  const rows = await LeaveRequest.find({
    organizationId: orgId,
    status: "Approved",
    startDate: { $lte: new Date(`${toKey}T23:59:59Z`) },
    endDate: { $gte: new Date(`${fromKey}T00:00:00Z`) },
  }).select("employee startDate endDate");

  const set = new Set();
  for (const r of rows) {
    for (const key of eachDayKey(r.startDate, r.endDate, tz)) {
      if (key >= fromKey && key <= toKey) set.add(`${r.employee}:${key}`);
    }
  }
  return set;
}

/* ------------------------------- helpers ------------------------------- */

function decorate(request, employee, type) {
  const json = request.toJSON();
  json.employee = { id: employee._id, name: employee.fullName, employeeId: employee.employeeId };
  json.leaveType = { id: type._id, name: type.name, code: type.code, category: type.category };
  return json;
}

function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function endOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59);
}

export default {
  getOrCreateBalance,
  listBalances,
  adjustBalance,
  createRequest,
  updateRequest,
  managerDecision,
  hrDecision,
  cancelRequest,
  addNote,
  checkCoverage,
  listRequests,
  getRequest,
  getMyLeave,
  calendar,
  approvedLeaveDayKeys,
};
