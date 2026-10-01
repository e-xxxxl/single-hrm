import mongoose from "mongoose";
import { Employee } from "../models/hrm/Employee.js";
import { Department } from "../models/hrm/Department.js";
import { Branch } from "../models/hrm/Branch.js";
import { AuditLog } from "../models/hrm/AuditLog.js";
import { Organization } from "../models/hrm/Organization.js";
import { Attendance } from "../models/hrm/Attendance.js";
import { LeaveRequest } from "../models/hrm/LeaveRequest.js";
import { Applicant, ACTIVE_STAGES } from "../models/hrm/Applicant.js";
import { PerformanceReview } from "../models/hrm/PerformanceReview.js";
import { PayrollRun } from "../models/hrm/PayrollRun.js";
import { dayKey, zonedWeekday } from "../utils/datetime.js";

/**
 * Live "needs attention" counts for the overview tiles, all for this
 * organization: who hasn't clocked in today (excluding people on approved
 * leave, and only on a working day), open leave requests, active applicants,
 * reviews due within 14 days, and the latest payroll run's status.
 */
async function pendingCounts(orgId) {
  const org = await Organization.findById(orgId).select("settings");
  const tz = org?.settings?.timezone || "Africa/Lagos";
  const workweek = org?.settings?.workweek || [1, 2, 3, 4, 5];
  const today = dayKey(new Date(), tz);
  const isWorkingDay = workweek.includes(zonedWeekday(new Date(), tz));

  const [active, clockedIn, onLeave, pendingLeaveRequests, pendingApplications, upcomingReviews, lastRun] =
    await Promise.all([
      Employee.countDocuments({ organizationId: orgId, status: "active" }),
      Attendance.countDocuments({ organizationId: orgId, dayKey: today, status: { $in: ["Present", "Late"] } }),
      LeaveRequest.distinct("employee", {
        organizationId: orgId,
        status: "Approved",
        startDate: { $lte: new Date() },
        endDate: { $gte: new Date(Date.now() - 86400000) },
      }),
      LeaveRequest.countDocuments({ organizationId: orgId, status: { $in: ["Pending", "Manager Approved", "Clarification Requested"] } }),
      Applicant.countDocuments({ organizationId: orgId, stage: { $in: ACTIVE_STAGES } }),
      PerformanceReview.countDocuments({
        organizationId: orgId,
        status: { $nin: ["completed", "acknowledged"] },
        dueDate: { $lte: new Date(Date.now() + 14 * 86400000) },
      }),
      PayrollRun.findOne({ organizationId: orgId }).sort({ year: -1, month: -1 }).select("periodLabel status"),
    ]);

  return {
    attendanceToday: isWorkingDay ? Math.max(0, active - clockedIn - onLeave.length) : 0,
    pendingLeaveRequests,
    pendingApplications,
    upcomingReviews,
    payrollStatus: lastRun ? { period: lastRun.periodLabel, status: lastRun.status } : null,
  };
}

/** HR overview aggregates for one organization. */
export async function getOverview(orgId) {
  const oid = new mongoose.Types.ObjectId(String(orgId));
  const now = new Date();
  const in60 = new Date(now.getTime() + 60 * 86400000);

  const [
    headcount,
    byEmploymentStatus,
    byType,
    byDepartment,
    byBranch,
    recentHires,
    upcomingContractEnds,
    recentActivity,
    birthdays,
  ] = await Promise.all([
    Employee.aggregate([
      { $match: { organizationId: oid } },
      { $group: { _id: "$status", n: { $sum: 1 } } },
    ]),
    Employee.aggregate([
      { $match: { organizationId: oid, status: "active" } },
      { $group: { _id: "$employmentStatus", n: { $sum: 1 } } },
    ]),
    Employee.aggregate([
      { $match: { organizationId: oid, status: "active" } },
      { $group: { _id: "$employmentType", n: { $sum: 1 } } },
    ]),
    Employee.aggregate([
      { $match: { organizationId: oid, status: "active", department: { $ne: null } } },
      { $group: { _id: "$department", n: { $sum: 1 } } },
      { $lookup: { from: "departments", localField: "_id", foreignField: "_id", as: "d" } },
      { $unwind: "$d" },
      { $project: { _id: 0, id: "$_id", name: "$d.name", count: "$n" } },
      { $sort: { count: -1 } },
    ]),
    Employee.aggregate([
      { $match: { organizationId: oid, status: "active", branch: { $ne: null } } },
      { $group: { _id: "$branch", n: { $sum: 1 } } },
      { $lookup: { from: "branches", localField: "_id", foreignField: "_id", as: "b" } },
      { $unwind: "$b" },
      { $project: { _id: 0, id: "$_id", name: "$b.name", count: "$n" } },
      { $sort: { count: -1 } },
    ]),
    Employee.find({ organizationId: oid, status: "active" })
      .sort({ dateJoined: -1 })
      .limit(5)
      .select("firstName lastName employeeId position dateJoined")
      .populate("department", "name"),
    Employee.find({
      organizationId: oid,
      status: "active",
      contractEndDate: { $gte: now, $lte: in60 },
    })
      .sort({ contractEndDate: 1 })
      .limit(10)
      .select("firstName lastName employeeId position contractEndDate"),
    AuditLog.find({ organizationId: oid }).sort({ createdAt: -1 }).limit(10),
    Employee.find({ organizationId: oid, status: "active", dateOfBirth: { $ne: null } })
      .select("firstName lastName employeeId dateOfBirth position")
      .lean(),
  ]);

  const countMap = (rows) => Object.fromEntries(rows.map((r) => [r._id || "unknown", r.n]));
  const hc = countMap(headcount);

  // Birthdays in the next 30 days.
  const soon = birthdays
    .map((e) => {
      const dob = new Date(e.dateOfBirth);
      let next = new Date(now.getFullYear(), dob.getMonth(), dob.getDate());
      if (next < new Date(now.getFullYear(), now.getMonth(), now.getDate())) {
        next = new Date(now.getFullYear() + 1, dob.getMonth(), dob.getDate());
      }
      return { ...e, nextBirthday: next };
    })
    .filter((e) => e.nextBirthday <= new Date(now.getTime() + 30 * 86400000))
    .sort((a, b) => a.nextBirthday - b.nextBirthday)
    .slice(0, 8);

  return {
    headcount: {
      total: (hc.active || 0) + (hc.inactive || 0),
      active: hc.active || 0,
      inactive: hc.inactive || 0,
    },
    byEmploymentStatus: countMap(byEmploymentStatus),
    byEmploymentType: countMap(byType),
    byDepartment,
    byBranch,
    structure: {
      departments: await Department.countDocuments({ organizationId: oid, status: "active" }),
      branches: await Branch.countDocuments({ organizationId: oid, status: "active" }),
    },
    recentHires,
    upcomingContractEnds,
    upcomingBirthdays: soon,
    recentActivity,
    pending: await pendingCounts(orgId),
  };
}

export default { getOverview };
