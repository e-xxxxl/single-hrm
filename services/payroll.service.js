import mongoose from "mongoose";
import { PayrollRun } from "../models/hrm/PayrollRun.js";
import { Payslip } from "../models/hrm/Payslip.js";
import { SalaryStructure } from "../models/hrm/SalaryStructure.js";
import { TripLog } from "../models/hrm/TripLog.js";
import { LeaveRequest } from "../models/hrm/LeaveRequest.js";
import { LeaveType } from "../models/hrm/LeaveType.js";
import { Employee } from "../models/hrm/Employee.js";
import { Organization } from "../models/hrm/Organization.js";
import { nextCode } from "../models/hrm/Counter.js";
import { AppError } from "../utils/AppError.js";
import { ORG_ADMIN_ROLE } from "../utils/permissions.js";
import { parsePagination, paginated } from "../utils/query.js";
import { monthDayKeys, dayKeyToDate, zonedWeekday, eachDayKey } from "../utils/datetime.js";
import { calculatePayslip } from "./payroll.engine.js";
import { roundMoney } from "../utils/payroll/tax.js";
import { Loan } from "../models/hrm/Loan.js";
import { applyInstallment, reverseInstallment } from "./loan.service.js";

const oid = (id) => new mongoose.Types.ObjectId(String(id));
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

async function loadOrg(orgId) {
  const org = await Organization.findById(orgId);
  if (!org) throw AppError.badRequest("Unknown organization");
  return org;
}

/* ------------------------------- runs -------------------------------- */

export async function listRuns(orgId, query = {}) {
  const { page, limit, skip } = parsePagination(query);
  const filter = { organizationId: orgId };
  if (query.status) filter.status = query.status;
  if (query.year) filter.year = Number(query.year);
  const [items, total] = await Promise.all([
    PayrollRun.find(filter).sort({ year: -1, month: -1 }).skip(skip).limit(limit),
    PayrollRun.countDocuments(filter),
  ]);
  return paginated(items, total, { page, limit });
}

export async function getRun(orgId, id, { withPayslips = true } = {}) {
  const run = await PayrollRun.findOne({ _id: id, organizationId: orgId });
  if (!run) throw AppError.notFound("Payroll run not found");
  if (!withPayslips) return { run };
  const payslips = await Payslip.find({ organizationId: orgId, payrollRun: id })
    .populate("employee", "firstName lastName employeeId")
    .sort({ "employeeSnapshot.name": 1 });
  return { run, payslips };
}

export async function createRun(orgId, { year, month, payDate, notes }, actor) {
  const org = await loadOrg(orgId);
  const existing = await PayrollRun.findOne({ organizationId: orgId, year, month });
  if (existing) {
    throw AppError.conflict(`A payroll run for ${MONTHS[month - 1]} ${year} already exists (${existing.reference})`);
  }
  const reference = await nextCode("PR", `${orgId}:payrollrun`, 4);
  return PayrollRun.create({
    organizationId: orgId,
    reference,
    strategy: org.payrollStrategy,
    year,
    month,
    periodLabel: `${MONTHS[month - 1]} ${year}`,
    payDate: payDate ? new Date(payDate) : org.settings?.payDayOfMonth
      ? new Date(year, month - 1, Math.min(org.settings.payDayOfMonth, 28))
      : undefined,
    notes,
    status: "draft",
    createdBy: actor.userId,
  });
}

/**
 * Compute (or recompute) every payslip in the run. Idempotent while the run is
 * draft/calculated — existing payslips are replaced.
 */
export async function calculateRun(orgId, id, actor, { excludeEmployees = [] } = {}) {
  const org = await loadOrg(orgId);
  const run = await PayrollRun.findOne({ _id: id, organizationId: orgId });
  if (!run) throw AppError.notFound("Payroll run not found");
  if (!["draft", "calculated"].includes(run.status)) {
    throw AppError.badRequest(`Cannot recalculate a run that is ${run.status}`);
  }

  const tz = org.settings?.timezone || "Africa/Lagos";
  const workweek = org.settings?.workweek || [1, 2, 3, 4, 5];
  const monthKey = `${run.year}-${String(run.month).padStart(2, "0")}`;
  const keys = monthDayKeys(monthKey);
  const workingDaysInMonth = keys.filter((k) =>
    workweek.includes(zonedWeekday(dayKeyToDate(k, tz), tz)),
  ).length;

  const excludeSet = new Set(excludeEmployees.map(String));
  const monthStart = new Date(run.year, run.month - 1, 1);
  const monthEnd = new Date(run.year, run.month, 0, 23, 59, 59);

  const employees = await Employee.find({ organizationId: orgId, status: "active" })
    .populate("department", "name")
    .populate("branch", "name");

  const structures = await SalaryStructure.find({
    organizationId: orgId,
    isCurrent: true,
    employee: { $in: employees.map((e) => e._id) },
  });
  const structureByEmp = new Map(structures.map((s) => [String(s.employee), s]));

  // Unpaid leave days per employee this month.
  const unpaidType = await LeaveType.find({ organizationId: orgId, category: "unpaid" }).select("_id");
  const unpaidTypeIds = unpaidType.map((t) => String(t._id));
  const approvedLeave = await LeaveRequest.find({
    organizationId: orgId,
    status: "Approved",
    startDate: { $lte: monthEnd },
    endDate: { $gte: monthStart },
  }).select("employee leaveType startDate endDate");
  const unpaidDaysByEmp = new Map();
  for (const lr of approvedLeave) {
    if (!unpaidTypeIds.includes(String(lr.leaveType))) continue;
    const days = eachDayKey(lr.startDate, lr.endDate, tz).filter(
      (k) => k >= keys[0] && k <= keys[keys.length - 1] &&
        workweek.includes(zonedWeekday(dayKeyToDate(k, tz), tz)),
    ).length;
    unpaidDaysByEmp.set(String(lr.employee), (unpaidDaysByEmp.get(String(lr.employee)) || 0) + days);
  }

  // Trip counts (hybrid).
  let tripsByEmp = new Map();
  if (org.payrollStrategy === "hybrid") {
    const trips = await TripLog.aggregate([
      {
        $match: {
          organizationId: oid(orgId),
          countsForPayroll: true,
          payrollRun: null,
          dayKey: { $gte: keys[0], $lte: keys[keys.length - 1] },
        },
      },
      {
        $group: {
          _id: "$employee",
          count: { $sum: 1 },
          overrideTotal: { $sum: { $ifNull: ["$amountOverride", 0] } },
          overrideCount: { $sum: { $cond: [{ $ifNull: ["$amountOverride", false] }, 1, 0] } },
        },
      },
    ]);
    tripsByEmp = new Map(trips.map((t) => [String(t._id), t]));
  }

  // Active loans with a balance still owed — this run's installment is
  // min(monthlyDeduction, balanceRemaining) so the last payment doesn't
  // overshoot. Only actually deducted from the balance at finalizeRun.
  const loans = await Loan.find({
    organizationId: orgId,
    employee: { $in: employees.map((e) => e._id) },
    status: "approved",
    balanceRemaining: { $gt: 0 },
  });
  const loanByEmp = new Map(loans.map((l) => [String(l.employee), l]));

  await Payslip.deleteMany({ organizationId: orgId, payrollRun: id });

  const totals = {
    grossEarnings: 0, commission: 0, paye: 0, payeEmployer: 0, pensionEmployee: 0, pensionEmployer: 0,
    nhf: 0, otherDeductions: 0, totalDeductions: 0, netPay: 0, employeeCount: 0,
  };
  const docs = [];
  let excluded = 0;

  for (const emp of employees) {
    if (excludeSet.has(String(emp._id))) {
      excluded += 1;
      continue;
    }
    const structure = structureByEmp.get(String(emp._id));
    if (!structure) {
      excluded += 1;
      continue;
    }

    const tripAgg = tripsByEmp.get(String(emp._id));
    const tripCount = tripAgg?.count || 0;
    // Mix flat-rate trips with per-trip overrides.
    const tripAmountTotal = tripAgg
      ? tripAgg.overrideTotal + (tripAgg.count - tripAgg.overrideCount) * (structure.commissionPerTrip || 0)
      : null;

    const loan = loanByEmp.get(String(emp._id));
    const loanDeduction = loan ? roundMoney(Math.min(loan.monthlyDeduction, loan.balanceRemaining)) : 0;

    const calc = calculatePayslip({
      strategy: org.payrollStrategy,
      structure,
      tripCount,
      tripAmountTotal: org.payrollStrategy === "hybrid" ? tripAmountTotal : null,
      unpaidLeaveDays: unpaidDaysByEmp.get(String(emp._id)) || 0,
      workingDaysInMonth,
      loanDeduction,
    });

    docs.push({
      organizationId: orgId,
      payrollRun: id,
      employee: emp._id,
      year: run.year,
      month: run.month,
      periodLabel: run.periodLabel,
      currency: structure.currency || "NGN",
      strategy: org.payrollStrategy,
      employeeSnapshot: {
        name: emp.fullName,
        employeeId: emp.employeeId,
        position: emp.position,
        department: emp.department?.name,
        branch: emp.branch?.name,
        taxState: emp.taxState,
        pfaName: emp.pension?.pfaName,
        bank: {
          bankName: emp.bank?.bankName,
          accountNumber: emp.bank?.accountNumber,
          accountName: emp.bank?.accountName,
        },
      },
      earnings: calc.earnings,
      grossEarnings: calc.grossEarnings,
      tripCount: calc.tripCount,
      commission: calc.commission,
      deductions: calc.deductions,
      paye: calc.paye,
      payeEmployer: calc.payeEmployer,
      pensionEmployee: calc.pensionEmployee,
      pensionEmployer: calc.pensionEmployer,
      nhf: calc.nhf,
      loan: loan?._id,
      loanDeduction,
      totalDeductions: calc.totalDeductions,
      netPay: calc.netPay,
      taxDetail: calc.taxDetail,
      status: "pending",
    });

    totals.grossEarnings += calc.grossEarnings;
    totals.commission += calc.commission;
    totals.paye += calc.paye;
    totals.payeEmployer += calc.payeEmployer;
    totals.pensionEmployee += calc.pensionEmployee;
    totals.pensionEmployer += calc.pensionEmployer;
    totals.nhf += calc.nhf;
    totals.totalDeductions += calc.totalDeductions;
    totals.netPay += calc.netPay;
    totals.employeeCount += 1;
  }

  if (docs.length) await Payslip.insertMany(docs);

  for (const k of Object.keys(totals)) totals[k] = roundMoney(totals[k]);
  run.totals = totals;
  run.excludedEmployeeCount = excluded;
  run.status = "calculated";
  run.calculatedAt = new Date();
  await run.save();

  return getRun(orgId, id);
}

export async function approveRun(orgId, id, actor) {
  const run = await PayrollRun.findOne({ _id: id, organizationId: orgId });
  if (!run) throw AppError.notFound("Payroll run not found");
  if (run.status !== "calculated") throw AppError.badRequest(`Run must be calculated first (currently ${run.status})`);
  if (run.totals.employeeCount === 0) throw AppError.badRequest("Nothing to approve — the run has no payslips");
  run.status = "approved";
  run.approvedBy = actor.userId;
  run.approvedAt = new Date();
  await run.save();
  return run;
}

export async function finalizeRun(orgId, id, actor) {
  const run = await PayrollRun.findOne({ _id: id, organizationId: orgId });
  if (!run) throw AppError.notFound("Payroll run not found");
  if (run.status !== "approved") throw AppError.badRequest(`Run must be approved first (currently ${run.status})`);

  run.status = "finalized";
  run.finalizedBy = actor.userId;
  run.finalizedAt = new Date();
  await run.save();

  // Attach consumed trip logs so they aren't paid twice.
  if (run.strategy === "hybrid") {
    const monthKey = `${run.year}-${String(run.month).padStart(2, "0")}`;
    const keys = monthDayKeys(monthKey);
    await TripLog.updateMany(
      { organizationId: orgId, payrollRun: null, dayKey: { $gte: keys[0], $lte: keys[keys.length - 1] } },
      { $set: { payrollRun: id } },
    );
  }

  // Take this run's loan installments off each borrower's balance now that
  // pay is actually locked in — not at calculate time, so recalculating a
  // still-draft run doesn't double-deduct.
  const withLoans = await Payslip.find({ organizationId: orgId, payrollRun: id, loanDeduction: { $gt: 0 } }).select("loan loanDeduction");
  for (const slip of withLoans) {
    if (slip.loan) await applyInstallment(orgId, slip.loan, slip.loanDeduction);
  }

  return run;
}

export async function cancelRun(orgId, id) {
  const run = await PayrollRun.findOne({ _id: id, organizationId: orgId });
  if (!run) throw AppError.notFound("Payroll run not found");
  if (run.status === "finalized") throw AppError.badRequest("A finalized run cannot be cancelled");
  run.status = "cancelled";
  await run.save();
  await Payslip.deleteMany({ organizationId: orgId, payrollRun: id });
  return run;
}

/** Release the hybrid-strategy trip logs a run had claimed, back to unconsumed. */
async function releaseRunTrips(orgId, run) {
  if (run.strategy !== "hybrid") return;
  await TripLog.updateMany({ organizationId: orgId, payrollRun: run._id }, { $set: { payrollRun: null } });
}

/**
 * Reopen an approved/finalized run for correction — Org Admin only. Drops
 * it back to "calculated" (clearing approval/finalization) so calculateRun
 * can recompute it, and releases any trip logs it had claimed so they're
 * counted again rather than silently dropped. Refuses once any payslip in
 * the run has actually been marked paid — money has moved at that point, and
 * reopening should not quietly rewrite what was paid; correct those
 * individually instead.
 */
export async function reopenRun(orgId, id, actor) {
  if (actor?.role !== ORG_ADMIN_ROLE) {
    throw AppError.forbidden("Only an Org Admin can reopen a payroll run");
  }
  const run = await PayrollRun.findOne({ _id: id, organizationId: orgId });
  if (!run) throw AppError.notFound("Payroll run not found");
  if (!["approved", "finalized"].includes(run.status)) {
    throw AppError.badRequest(`Only an approved or finalized run can be reopened (currently ${run.status})`);
  }
  const paidCount = await Payslip.countDocuments({ organizationId: orgId, payrollRun: id, status: "paid" });
  if (paidCount > 0) {
    throw AppError.badRequest(
      `Cannot reopen — ${paidCount} payslip(s) in this run are already marked paid. Correct those individually.`,
    );
  }

  await releaseRunTrips(orgId, run);

  // Finalizing had already taken this run's loan installments off borrowers'
  // balances — put them back so recalculation doesn't understate what's owed.
  if (run.status === "finalized") {
    const withLoans = await Payslip.find({ organizationId: orgId, payrollRun: id, loanDeduction: { $gt: 0 } }).select("loan loanDeduction");
    for (const slip of withLoans) {
      if (slip.loan) await reverseInstallment(orgId, slip.loan, slip.loanDeduction);
    }
  }

  run.status = "calculated";
  run.approvedBy = undefined;
  run.approvedAt = undefined;
  run.finalizedBy = undefined;
  run.finalizedAt = undefined;
  await run.save();
  return run;
}

/**
 * Permanently delete a payroll run and its payslips — Org Admin only.
 * Refuses once any payslip has been marked paid, for the same reason
 * reopenRun does: that's a real financial record, not a draft to discard.
 * Use cancelRun (still-draft/calculated/approved) or reopenRun+cancelRun for
 * anything already paid.
 */
export async function deleteRun(orgId, id, actor) {
  if (actor?.role !== ORG_ADMIN_ROLE) {
    throw AppError.forbidden("Only an Org Admin can delete a payroll run");
  }
  const run = await PayrollRun.findOne({ _id: id, organizationId: orgId });
  if (!run) throw AppError.notFound("Payroll run not found");
  const paidCount = await Payslip.countDocuments({ organizationId: orgId, payrollRun: id, status: "paid" });
  if (paidCount > 0) {
    throw AppError.badRequest(`Cannot delete — ${paidCount} payslip(s) in this run are already marked paid.`);
  }

  await releaseRunTrips(orgId, run);

  if (run.status === "finalized") {
    const withLoans = await Payslip.find({ organizationId: orgId, payrollRun: id, loanDeduction: { $gt: 0 } }).select("loan loanDeduction");
    for (const slip of withLoans) {
      if (slip.loan) await reverseInstallment(orgId, slip.loan, slip.loanDeduction);
    }
  }

  await Payslip.deleteMany({ organizationId: orgId, payrollRun: id });
  await run.deleteOne();
  return { ok: true };
}

/** Mark every still-pending payslip in a finalized run as paid, in one action. */
export async function markAllPaid(orgId, runId) {
  const run = await PayrollRun.findOne({ _id: runId, organizationId: orgId });
  if (!run) throw AppError.notFound("Payroll run not found");
  if (run.status !== "finalized") {
    throw AppError.badRequest("The payroll run must be finalized before marking payslips paid");
  }
  const result = await Payslip.updateMany(
    { organizationId: orgId, payrollRun: runId, status: { $ne: "paid" } },
    { $set: { status: "paid", paidAt: new Date() } },
  );
  return { marked: result.modifiedCount ?? result.nModified ?? 0 };
}

/* ------------------------------ payslips ----------------------------- */

export async function listPayslips(orgId, query = {}) {
  const { page, limit, skip } = parsePagination(query);
  const filter = { organizationId: orgId };
  if (query.payrollRun) filter.payrollRun = query.payrollRun;
  if (query.employee) filter.employee = query.employee;
  if (query.status) filter.status = query.status;
  if (query.year) filter.year = Number(query.year);
  if (query.month) filter.month = Number(query.month);

  const [items, total] = await Promise.all([
    Payslip.find(filter)
      .sort({ year: -1, month: -1, "employeeSnapshot.name": 1 })
      .skip(skip)
      .limit(limit)
      .populate("employee", "firstName lastName employeeId"),
    Payslip.countDocuments(filter),
  ]);
  return paginated(items, total, { page, limit });
}

export async function getPayslip(orgId, id) {
  const slip = await Payslip.findOne({ _id: id, organizationId: orgId }).populate(
    "payrollRun",
    "reference status periodLabel payDate",
  );
  if (!slip) throw AppError.notFound("Payslip not found");
  return slip;
}

export async function employeePayslips(orgId, employeeId) {
  return Payslip.find({ organizationId: orgId, employee: employeeId })
    .sort({ year: -1, month: -1 })
    .populate("payrollRun", "reference status");
}

export async function markPayslipPaid(orgId, id) {
  const slip = await Payslip.findOne({ _id: id, organizationId: orgId }).populate("payrollRun", "status");
  if (!slip) throw AppError.notFound("Payslip not found");
  if (slip.payrollRun?.status !== "finalized") {
    throw AppError.badRequest("The payroll run must be finalized before marking payslips paid");
  }
  slip.status = "paid";
  slip.paidAt = new Date();
  await slip.save();
  return slip;
}

/** Bank-upload CSV for a finalized (or approved) run. */
export async function bankExportCsv(orgId, runId) {
  const { run, payslips } = await getRun(orgId, runId);
  if (!["approved", "finalized"].includes(run.status)) {
    throw AppError.badRequest("Export is available once the run is approved");
  }
  const header = ["Account Number", "Account Name", "Bank", "Amount", "Narration", "Employee ID"];
  const rows = payslips.map((p) => [
    p.employeeSnapshot?.bank?.accountNumber || "",
    csv(p.employeeSnapshot?.bank?.accountName || p.employeeSnapshot?.name || ""),
    csv(p.employeeSnapshot?.bank?.bankName || ""),
    p.netPay.toFixed(2),
    csv(`Salary ${run.periodLabel}`),
    p.employeeSnapshot?.employeeId || "",
  ]);
  return [header, ...rows].map((r) => r.join(",")).join("\r\n");
}

function csv(value) {
  const s = String(value ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export default {
  listRuns,
  getRun,
  createRun,
  calculateRun,
  approveRun,
  finalizeRun,
  cancelRun,
  reopenRun,
  deleteRun,
  listPayslips,
  getPayslip,
  employeePayslips,
  markPayslipPaid,
  markAllPaid,
  bankExportCsv,
};
