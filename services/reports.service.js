import mongoose from "mongoose";
import { Employee } from "../models/hrm/Employee.js";
import { Attendance } from "../models/hrm/Attendance.js";
import { LeaveRequest } from "../models/hrm/LeaveRequest.js";
import { LeaveType } from "../models/hrm/LeaveType.js";
import { PayrollRun } from "../models/hrm/PayrollRun.js";
import { Organization } from "../models/hrm/Organization.js";
import { monthDayKeys, dayKeyToDate, zonedWeekday } from "../utils/datetime.js";

const oid = (id) => new mongoose.Types.ObjectId(String(id));

/** Consolidated HR report for a month ("YYYY-MM"). */
export async function hrReport(orgId, { month } = {}) {
  const org = await Organization.findById(orgId).select("settings name payrollStrategy");
  const tz = org?.settings?.timezone || "Africa/Lagos";
  const workweek = org?.settings?.workweek || [1, 2, 3, 4, 5];
  const period = month || new Date().toISOString().slice(0, 7);
  const keys = monthDayKeys(period);
  const workingDays = keys.filter((k) => workweek.includes(zonedWeekday(dayKeyToDate(k, tz), tz))).length;
  const oidOrg = oid(orgId);

  const [
    headcountByStatus,
    byDepartment,
    byBranch,
    byType,
    attendanceAgg,
    leaveByType,
    leaveByStatus,
    latestRun,
  ] = await Promise.all([
    Employee.aggregate([{ $match: { organizationId: oidOrg } }, { $group: { _id: "$status", n: { $sum: 1 } } }]),
    Employee.aggregate([
      { $match: { organizationId: oidOrg, status: "active" } },
      { $group: { _id: "$department", n: { $sum: 1 } } },
      { $lookup: { from: "departments", localField: "_id", foreignField: "_id", as: "d" } },
      { $unwind: { path: "$d", preserveNullAndEmptyArrays: true } },
      { $project: { _id: 0, name: { $ifNull: ["$d.name", "Unassigned"] }, count: "$n" } },
      { $sort: { count: -1 } },
    ]),
    Employee.aggregate([
      { $match: { organizationId: oidOrg, status: "active" } },
      { $group: { _id: "$branch", n: { $sum: 1 } } },
      { $lookup: { from: "branches", localField: "_id", foreignField: "_id", as: "b" } },
      { $unwind: { path: "$b", preserveNullAndEmptyArrays: true } },
      { $project: { _id: 0, name: { $ifNull: ["$b.name", "Unassigned"] }, count: "$n" } },
      { $sort: { count: -1 } },
    ]),
    Employee.aggregate([
      { $match: { organizationId: oidOrg, status: "active" } },
      { $group: { _id: "$employmentType", n: { $sum: 1 } } },
    ]),
    Attendance.aggregate([
      { $match: { organizationId: oidOrg, dayKey: { $gte: keys[0], $lte: keys[keys.length - 1] } } },
      { $group: { _id: "$status", n: { $sum: 1 }, hours: { $sum: { $ifNull: ["$totalHours", 0] } } } },
    ]),
    LeaveRequest.aggregate([
      { $match: { organizationId: oidOrg, status: "Approved", year: Number(period.slice(0, 4)) } },
      { $group: { _id: "$leaveType", days: { $sum: "$days" }, count: { $sum: 1 } } },
      { $lookup: { from: "leavetypes", localField: "_id", foreignField: "_id", as: "t" } },
      { $unwind: "$t" },
      { $project: { _id: 0, name: "$t.name", days: 1, count: 1 } },
      { $sort: { days: -1 } },
    ]),
    LeaveRequest.aggregate([
      { $match: { organizationId: oidOrg } },
      { $group: { _id: "$status", n: { $sum: 1 } } },
    ]),
    PayrollRun.findOne({ organizationId: orgId, status: { $in: ["approved", "finalized"] } }).sort({ year: -1, month: -1 }),
  ]);

  const hc = Object.fromEntries(headcountByStatus.map((r) => [r._id, r.n]));
  const att = Object.fromEntries(attendanceAgg.map((r) => [r._id, r]));
  const activeCount = hc.active || 0;
  const presentRecords = (att.Present?.n || 0) + (att.Late?.n || 0);
  const expectedRecords = activeCount * workingDays;

  return {
    period,
    workingDays,
    organization: org?.name,
    workforce: {
      total: (hc.active || 0) + (hc.inactive || 0),
      active: hc.active || 0,
      inactive: hc.inactive || 0,
      byDepartment,
      byBranch,
      byType: Object.fromEntries(byType.map((r) => [r._id || "Unspecified", r.n])),
    },
    attendance: {
      present: att.Present?.n || 0,
      late: att.Late?.n || 0,
      absent: att.Absent?.n || 0,
      onLeave: att["On Leave"]?.n || 0,
      totalHours: Math.round(Object.values(att).reduce((s, r) => s + (r.hours || 0), 0) * 10) / 10,
      attendanceRate: expectedRecords ? Math.round((presentRecords / expectedRecords) * 100) : null,
      lateRate: presentRecords ? Math.round(((att.Late?.n || 0) / presentRecords) * 100) : null,
    },
    leave: {
      byType: leaveByType,
      byStatus: Object.fromEntries(leaveByStatus.map((r) => [r._id, r.n])),
      pendingApprovals: leaveByStatus.find((r) => r._id === "Pending")?.n || 0,
      totalApprovedDays: leaveByType.reduce((s, r) => s + r.days, 0),
    },
    payroll: latestRun
      ? {
          period: latestRun.periodLabel,
          status: latestRun.status,
          employees: latestRun.totals.employeeCount,
          gross: latestRun.totals.grossEarnings,
          paye: latestRun.totals.paye,
          pension: latestRun.totals.pensionEmployee,
          deductions: latestRun.totals.totalDeductions,
          net: latestRun.totals.netPay,
        }
      : null,
  };
}

export default { hrReport };
