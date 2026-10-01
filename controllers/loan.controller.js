import * as service from "../services/loan.service.js";
import { catchAsync } from "../utils/catchAsync.js";
import { recordAudit } from "../services/audit.service.js";
import { notify } from "../services/notification.service.js";

export const apply = catchAsync(async (req, res) => {
  const loan = await service.applyForLoan(req.orgId, req.auth, req.body);
  await recordAudit(req, {
    action: "loan.apply",
    entityType: "Loan",
    entityId: loan._id,
    summary: `Applied for a loan of ${loan.amount}`,
  });
  res.status(201).json({ data: loan });
});

export const mine = catchAsync(async (req, res) => {
  res.json({ data: await service.myLoans(req.orgId, req.auth) });
});

export const cancel = catchAsync(async (req, res) => {
  const loan = await service.cancelLoan(req.orgId, req.auth, req.params.id);
  res.json({ data: loan });
});

export const list = catchAsync(async (req, res) => {
  res.json({ data: await service.listLoans(req.orgId, req.query) });
});

export const get = catchAsync(async (req, res) => {
  res.json({ data: await service.getLoan(req.orgId, req.params.id) });
});

export const decide = catchAsync(async (req, res) => {
  const loan = await service.decideLoan(req.orgId, req.params.id, req.auth, req.body);
  await recordAudit(req, {
    action: "loan.decide",
    entityType: "Loan",
    entityId: loan._id,
    summary: `${loan.status === "approved" ? "Approved" : "Rejected"} a loan request`,
  });
  if (loan.status === "approved") {
    await notify(req.orgId, {
      to: { employee: loan.employee },
      type: "loan.approved",
      title: "Loan approved",
      body: `Your loan of ${loan.amount.toLocaleString("en-NG")} was approved — ${loan.monthlyDeduction.toLocaleString("en-NG")}/month for ${loan.repaymentMonths} month(s).`,
    });
  } else {
    await notify(req.orgId, {
      to: { employee: loan.employee },
      type: "loan.rejected",
      title: "Loan request declined",
      body: loan.decisionNote || "Your loan request was not approved.",
    });
  }
  res.json({ data: loan });
});

export default { apply, mine, cancel, list, get, decide };
