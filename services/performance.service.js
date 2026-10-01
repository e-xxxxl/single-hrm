import mongoose from "mongoose";
import { PerformanceReview } from "../models/hrm/PerformanceReview.js";
import { Kpi } from "../models/hrm/Kpi.js";
import { Employee } from "../models/hrm/Employee.js";
import { AppError } from "../utils/AppError.js";
import { hasPermission } from "../utils/permissions.js";
import { parsePagination, paginated, escapeRegex } from "../utils/query.js";

const oid = (id) => new mongoose.Types.ObjectId(String(id));

/* ------------------------------- KPI library ------------------------------- */

export async function listKpis(orgId, query = {}) {
  const filter = { organizationId: orgId };
  if (query.active === "true") filter.active = true;
  if (query.active === "false") filter.active = false;
  if (query.department) filter.department = query.department;
  if (query.search) filter.name = new RegExp(escapeRegex(query.search), "i");
  return Kpi.find(filter).sort({ name: 1 }).populate("department", "name");
}

export async function createKpi(orgId, input) {
  const dup = await Kpi.findOne({ organizationId: orgId, name: input.name });
  if (dup) throw AppError.conflict("A KPI with that name already exists");
  return Kpi.create({ ...input, organizationId: orgId });
}

export async function updateKpi(orgId, id, input) {
  const kpi = await Kpi.findOneAndUpdate({ _id: id, organizationId: orgId }, { $set: input }, { new: true });
  if (!kpi) throw AppError.notFound("KPI not found");
  return kpi;
}

/** Hard-delete a KPI. Blocked if any target or review references it, to protect history. */
export async function deleteKpi(orgId, id) {
  const [{ Target }] = await Promise.all([import("../models/hrm/Target.js")]);
  const [usedByTarget, usedByReview] = await Promise.all([
    Target.countDocuments({ organizationId: orgId, kpi: id }),
    PerformanceReview.countDocuments({ organizationId: orgId, "kpis.kpi": id }),
  ]);
  if (usedByTarget > 0 || usedByReview > 0) {
    throw AppError.badRequest("Cannot delete — this KPI is used by an existing target or review. Deactivate it instead.");
  }
  const kpi = await Kpi.findOneAndDelete({ _id: id, organizationId: orgId });
  if (!kpi) throw AppError.notFound("KPI not found");
  return { ok: true };
}

/* --------------------------------- Reviews -------------------------------- */

async function resolveActorEmployee(orgId, userId) {
  return Employee.findOne({ organizationId: orgId, user: userId }).select("_id");
}

export async function listReviews(orgId, actor, query = {}) {
  const { page, limit, skip } = parsePagination(query);
  const filter = { organizationId: orgId };
  if (query.status) filter.status = query.status;
  if (query.cycle) filter.cycle = query.cycle;
  if (query.employee) filter.employee = query.employee;
  if (query.type) filter.type = query.type;

  if (query.scope === "mine" || (!hasPermission(actor.permissions, "performance:review") && !hasPermission(actor.permissions, "performance:write"))) {
    const me = await resolveActorEmployee(orgId, actor.userId);
    filter.employee = me?._id || oid("000000000000000000000000");
  } else if (query.scope === "reviewer") {
    const me = await resolveActorEmployee(orgId, actor.userId);
    filter.reviewer = me?._id || oid("000000000000000000000000");
  }

  const [items, total] = await Promise.all([
    PerformanceReview.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("employee", "firstName lastName employeeId position")
      .populate("reviewer", "firstName lastName")
      .populate("department", "name"),
    PerformanceReview.countDocuments(filter),
  ]);
  return paginated(items, total, { page, limit });
}

export async function getReview(orgId, id) {
  const review = await PerformanceReview.findOne({ _id: id, organizationId: orgId })
    .populate("employee", "firstName lastName employeeId position department")
    .populate("reviewer", "firstName lastName employeeId")
    .populate("department", "name")
    .populate("kpis.kpi", "name unit direction");
  if (!review) throw AppError.notFound("Review not found");
  return review;
}

export async function createReview(orgId, actor, input) {
  const employee = await Employee.findOne({ _id: input.employee, organizationId: orgId }).populate(
    "department reportingManager",
    "name firstName lastName",
  );
  if (!employee) throw AppError.notFound("Employee not found");

  const dup = await PerformanceReview.findOne({
    organizationId: orgId,
    cycle: input.cycle,
    employee: employee._id,
  });
  if (dup) throw AppError.conflict(`${employee.firstName} already has a ${input.cycle} review (${dup.reference || dup._id})`);

  let reviewerId = input.reviewer;
  if (!reviewerId && employee.reportingManager) reviewerId = employee.reportingManager._id;

  const kpis = (input.kpis || []).map((k) => ({
    kpi: k.kpi,
    name: k.name,
    weight: k.weight ?? 1,
    target: k.target,
  }));

  const review = await PerformanceReview.create({
    organizationId: orgId,
    employee: employee._id,
    department: employee.department?._id,
    reviewer: reviewerId,
    cycle: input.cycle,
    type: input.type || "quarterly",
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    dueDate: input.dueDate,
    kpis,
    status: "draft",
    createdBy: actor.userId,
  });
  return getReview(orgId, review._id);
}

export async function updateReview(orgId, actor, id, input) {
  const review = await PerformanceReview.findOne({ _id: id, organizationId: orgId });
  if (!review) throw AppError.notFound("Review not found");
  if (["completed", "acknowledged"].includes(review.status)) {
    throw AppError.badRequest("A completed review can no longer be edited");
  }

  const me = await resolveActorEmployee(orgId, actor.userId);
  const isEmployee = me && String(me._id) === String(review.employee);
  const isReviewer =
    (me && String(me._id) === String(review.reviewer)) || hasPermission(actor.permissions, "performance:review");

  if (input.kpis && isReviewer) {
    review.kpis = input.kpis.map((k) => ({
      kpi: k.kpi,
      name: k.name,
      weight: k.weight ?? 1,
      target: k.target,
      actual: k.actual,
      score: k.score,
      comment: k.comment,
    }));
    review.recomputeScore();
  }
  if (input.managerComments !== undefined && isReviewer) review.managerComments = input.managerComments;
  if (input.developmentPlan !== undefined && isReviewer) review.developmentPlan = input.developmentPlan;
  if (input.employeeComments !== undefined && isEmployee) review.employeeComments = input.employeeComments;
  if (input.dueDate !== undefined && isReviewer) review.dueDate = input.dueDate;

  await review.save();
  return getReview(orgId, review._id);
}

/** Advance the review workflow: draft → self_review → manager_review → completed → acknowledged. */
export async function transitionReview(orgId, actor, id, action) {
  const review = await PerformanceReview.findOne({ _id: id, organizationId: orgId });
  if (!review) throw AppError.notFound("Review not found");
  const me = await resolveActorEmployee(orgId, actor.userId);
  const isEmployee = me && String(me._id) === String(review.employee);
  const isReviewer =
    (me && String(me._id) === String(review.reviewer)) || hasPermission(actor.permissions, "performance:review");

  switch (action) {
    case "open_self_review":
      if (!isReviewer) throw AppError.forbidden("Only the reviewer can start the review");
      review.status = "self_review";
      break;
    case "submit_self_review":
      if (!isEmployee) throw AppError.forbidden("Only the employee can submit their self review");
      review.status = "manager_review";
      review.submittedAt = new Date();
      break;
    case "complete":
      if (!isReviewer) throw AppError.forbidden("Only the reviewer can complete the review");
      review.recomputeScore();
      review.status = "completed";
      review.completedAt = new Date();
      break;
    case "acknowledge":
      if (!isEmployee) throw AppError.forbidden("Only the employee can acknowledge the review");
      review.status = "acknowledged";
      review.acknowledgedAt = new Date();
      break;
    default:
      throw AppError.badRequest("Unknown action");
  }
  await review.save();
  return getReview(orgId, review._id);
}

export async function dashboard(orgId, query = {}) {
  const oidOrg = oid(orgId);
  const cycle = query.cycle;
  const match = { organizationId: oidOrg };
  if (cycle) match.cycle = cycle;

  const [byStatus, scoreAgg, byDept, overdue, upcoming] = await Promise.all([
    PerformanceReview.aggregate([{ $match: match }, { $group: { _id: "$status", n: { $sum: 1 } } }]),
    PerformanceReview.aggregate([
      { $match: { ...match, status: { $in: ["completed", "acknowledged"] }, overallScore: { $gt: 0 } } },
      { $group: { _id: null, avg: { $avg: "$overallScore" }, n: { $sum: 1 } } },
    ]),
    PerformanceReview.aggregate([
      { $match: { ...match, status: { $in: ["completed", "acknowledged"] }, overallScore: { $gt: 0 } } },
      { $group: { _id: "$department", avg: { $avg: "$overallScore" }, n: { $sum: 1 } } },
      { $lookup: { from: "departments", localField: "_id", foreignField: "_id", as: "d" } },
      { $unwind: { path: "$d", preserveNullAndEmptyArrays: true } },
      { $project: { _id: 0, department: { $ifNull: ["$d.name", "Unassigned"] }, avgScore: { $round: ["$avg", 2] }, count: "$n" } },
      { $sort: { avgScore: -1 } },
    ]),
    PerformanceReview.countDocuments({ ...match, status: { $nin: ["completed", "acknowledged"] }, dueDate: { $lt: new Date() } }),
    PerformanceReview.find({ ...match, status: { $nin: ["completed", "acknowledged"] }, dueDate: { $gte: new Date() } })
      .sort({ dueDate: 1 })
      .limit(10)
      .populate("employee", "firstName lastName employeeId")
      .select("cycle type dueDate status employee"),
  ]);

  const counts = Object.fromEntries(byStatus.map((s) => [s._id, s.n]));
  return {
    cycle: cycle || null,
    total: byStatus.reduce((s, x) => s + x.n, 0),
    counts,
    reviewsDue: (counts.draft || 0) + (counts.self_review || 0) + (counts.manager_review || 0),
    reviewsCompleted: (counts.completed || 0) + (counts.acknowledged || 0),
    averageScore: scoreAgg[0] ? Math.round(scoreAgg[0].avg * 100) / 100 : null,
    overdue,
    byDepartment: byDept,
    upcoming,
  };
}

/** Hard-delete a performance review. */
export async function deleteReview(orgId, id) {
  const review = await PerformanceReview.findOneAndDelete({ _id: id, organizationId: orgId });
  if (!review) throw AppError.notFound("Review not found");
  return { ok: true };
}

export default {
  listKpis,
  createKpi,
  updateKpi,
  deleteKpi,
  listReviews,
  getReview,
  createReview,
  updateReview,
  transitionReview,
  deleteReview,
  dashboard,
};
