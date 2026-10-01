import { Loan } from "../models/hrm/Loan.js";
import { Employee } from "../models/hrm/Employee.js";
import { AppError } from "../utils/AppError.js";
import { getCurrent as getCurrentStructure } from "./salaryStructure.service.js";
import { roundMoney } from "../utils/payroll/tax.js";

const ACTIVE_STATUSES = ["pending", "approved"];

/** The employee record for the caller's own login, or null if unlinked. */
async function selfEmployee(orgId, actor) {
  return Employee.findOne({ organizationId: orgId, user: actor.userId });
}

/**
 * Self-service application, capped at 50% of the employee's current monthly
 * gross. Only one pending/approved loan may be open at a time — apply again
 * once the current one is resolved.
 */
export async function applyForLoan(orgId, actor, input) {
  const employee = await selfEmployee(orgId, actor);
  if (!employee) {
    throw AppError.badRequest("Your login isn't linked to an employee record in this organization");
  }

  const existing = await Loan.findOne({ organizationId: orgId, employee: employee._id, status: { $in: ACTIVE_STATUSES } });
  if (existing) {
    throw AppError.conflict(`You already have a ${existing.status} loan request. Wait for it to be resolved before applying again.`);
  }

  const structure = await getCurrentStructure(orgId, employee._id);
  if (!structure) {
    throw AppError.badRequest("You need a salary structure on file before you can apply for a loan");
  }
  const monthlyGross = structure.grossMonthly || structure.fixedGross || 0;
  const maxAmount = roundMoney(monthlyGross * 0.5);
  const amount = Number(input.amount);
  if (!(amount > 0)) throw AppError.badRequest("Enter a loan amount");
  if (amount > maxAmount) {
    throw AppError.badRequest(`Loans are capped at 50% of your monthly gross (${maxAmount.toLocaleString("en-NG")}).`);
  }

  const repaymentMonths = Math.max(1, Math.min(24, Number(input.repaymentMonths) || 1));
  const monthlyDeduction = roundMoney(amount / repaymentMonths);

  return Loan.create({
    organizationId: orgId,
    employee: employee._id,
    amount,
    reason: input.reason,
    repaymentMonths,
    monthlyDeduction,
    balanceRemaining: amount,
    status: "pending",
    requestedAt: new Date(),
    createdBy: actor.userId,
  });
}

/** The caller's own loan history. */
export async function myLoans(orgId, actor) {
  const employee = await selfEmployee(orgId, actor);
  if (!employee) return [];
  return Loan.find({ organizationId: orgId, employee: employee._id }).sort({ createdAt: -1 });
}

/** Withdraw a loan request that hasn't been decided yet. */
export async function cancelLoan(orgId, actor, id) {
  const employee = await selfEmployee(orgId, actor);
  const loan = await Loan.findOne({ _id: id, organizationId: orgId, employee: employee?._id });
  if (!loan) throw AppError.notFound("Loan request not found");
  if (loan.status !== "pending") throw AppError.badRequest("Only a pending request can be withdrawn");
  loan.status = "cancelled";
  await loan.save();
  return loan;
}

export async function listLoans(orgId, query = {}) {
  const filter = { organizationId: orgId };
  if (query.status) filter.status = query.status;
  if (query.employee) filter.employee = query.employee;
  return Loan.find(filter)
    .sort({ createdAt: -1 })
    .populate("employee", "firstName lastName employeeId");
}

export async function getLoan(orgId, id) {
  const loan = await Loan.findOne({ _id: id, organizationId: orgId }).populate("employee", "firstName lastName employeeId");
  if (!loan) throw AppError.notFound("Loan request not found");
  return loan;
}

/** Approve or reject a pending request. */
export async function decideLoan(orgId, id, actor, { status, note }) {
  if (!["approved", "rejected"].includes(status)) throw AppError.badRequest("status must be approved or rejected");
  const loan = await Loan.findOne({ _id: id, organizationId: orgId });
  if (!loan) throw AppError.notFound("Loan request not found");
  if (loan.status !== "pending") throw AppError.badRequest(`This request is already ${loan.status}`);

  loan.status = status;
  loan.decidedBy = actor.userId;
  loan.decidedAt = new Date();
  loan.decisionNote = note;
  await loan.save();
  return loan;
}

/** The employee's active approved loan with a balance still owed, if any — used by payroll.service.js. */
export async function activeLoanFor(orgId, employeeId) {
  return Loan.findOne({ organizationId: orgId, employee: employeeId, status: "approved", balanceRemaining: { $gt: 0 } });
}

/** Take this period's installment off the balance; mark completed once it hits 0. Idempotent per call. */
export async function applyInstallment(orgId, loanId, amount) {
  const loan = await Loan.findOne({ _id: loanId, organizationId: orgId });
  if (!loan) return;
  loan.balanceRemaining = roundMoney(Math.max(0, loan.balanceRemaining - amount));
  if (loan.balanceRemaining <= 0) loan.status = "completed";
  await loan.save();
}

/** Undo a previously-applied installment — used when a finalized run with loan deductions is reopened. */
export async function reverseInstallment(orgId, loanId, amount) {
  const loan = await Loan.findOne({ _id: loanId, organizationId: orgId });
  if (!loan) return;
  loan.balanceRemaining = roundMoney(loan.balanceRemaining + amount);
  if (loan.status === "completed") loan.status = "approved";
  await loan.save();
}

export default {
  applyForLoan,
  myLoans,
  cancelLoan,
  listLoans,
  getLoan,
  decideLoan,
  activeLoanFor,
  applyInstallment,
  reverseInstallment,
};
