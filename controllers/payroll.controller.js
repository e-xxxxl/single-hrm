import * as payroll from "../services/payroll.service.js";
import * as structures from "../services/salaryStructure.service.js";
import * as trips from "../services/tripLog.service.js";
import { generatePayslipPdf } from "../services/pdf.service.js";
import { Organization } from "../models/hrm/Organization.js";
import { catchAsync } from "../utils/catchAsync.js";
import { recordAudit } from "../services/audit.service.js";
import { notify } from "../services/notification.service.js";
import { AppError } from "../utils/AppError.js";
import { hasPermission } from "../utils/permissions.js";

/* -------- Salary structures -------- */

export const getStructure = catchAsync(async (req, res) => {
  const [current, history] = await Promise.all([
    structures.getCurrent(req.orgId, req.params.employeeId),
    structures.history(req.orgId, req.params.employeeId),
  ]);
  res.json({ data: { current, history } });
});

export const setStructure = catchAsync(async (req, res) => {
  const structure = await structures.setStructure(
    req.orgId,
    req.params.employeeId,
    req.body,
    req.auth.userId,
  );
  await recordAudit(req, {
    action: "salary_structure.set",
    entityType: "SalaryStructure",
    entityId: structure._id,
    summary: `Updated salary structure for employee ${req.params.employeeId}`,
    metadata: { effectiveFrom: structure.effectiveFrom },
  });
  res.status(201).json({ data: structure });
});

export const deleteStructure = catchAsync(async (req, res) => {
  await structures.deleteStructure(req.orgId, req.params.employeeId, req.params.structureId);
  await recordAudit(req, {
    action: "salary_structure.delete",
    entityType: "SalaryStructure",
    entityId: req.params.structureId,
    summary: `Deleted a salary structure record for employee ${req.params.employeeId}`,
  });
  res.json({ data: { ok: true } });
});

/* -------- Payroll runs -------- */

export const listRuns = catchAsync(async (req, res) => {
  res.json(await payroll.listRuns(req.orgId, req.query));
});

export const getRun = catchAsync(async (req, res) => {
  res.json({ data: await payroll.getRun(req.orgId, req.params.id) });
});

export const createRun = catchAsync(async (req, res) => {
  const run = await payroll.createRun(req.orgId, req.body, req.auth);
  await recordAudit(req, {
    action: "payroll_run.create",
    entityType: "PayrollRun",
    entityId: run._id,
    entityLabel: run.reference,
    summary: `Created payroll run for ${run.periodLabel}`,
  });
  res.status(201).json({ data: run });
});

export const calculateRun = catchAsync(async (req, res) => {
  const result = await payroll.calculateRun(req.orgId, req.params.id, req.auth, req.body);
  await recordAudit(req, {
    action: "payroll_run.calculate",
    entityType: "PayrollRun",
    entityId: result.run._id,
    entityLabel: result.run.reference,
    summary: `Calculated payroll — ${result.run.totals.employeeCount} employees, net ${result.run.totals.netPay}`,
  });
  res.json({ data: result });
});

export const approveRun = catchAsync(async (req, res) => {
  const run = await payroll.approveRun(req.orgId, req.params.id, req.auth);
  await recordAudit(req, {
    action: "payroll_run.approve",
    entityType: "PayrollRun",
    entityId: run._id,
    entityLabel: run.reference,
    summary: `Approved payroll run ${run.reference}`,
  });
  res.json({ data: run });
});

export const finalizeRun = catchAsync(async (req, res) => {
  const run = await payroll.finalizeRun(req.orgId, req.params.id, req.auth);
  await recordAudit(req, {
    action: "payroll_run.finalize",
    entityType: "PayrollRun",
    entityId: run._id,
    entityLabel: run.reference,
    summary: `Finalized payroll run ${run.reference}`,
  });
  // Notify each employee their payslip is available.
  const { payslips } = await payroll.getRun(req.orgId, run._id);
  for (const slip of payslips) {
    await notify(req.orgId, {
      to: { employee: slip.employee._id ?? slip.employee },
      type: "payslip.available",
      title: "Payslip available",
      body: `${run.periodLabel} · net ${slip.netPay.toLocaleString("en-NG")}`,
      link: `/hrm/payroll/payslips/${slip._id}`,
    });
  }
  res.json({ data: run });
});

export const cancelRun = catchAsync(async (req, res) => {
  const run = await payroll.cancelRun(req.orgId, req.params.id);
  await recordAudit(req, {
    action: "payroll_run.cancel",
    entityType: "PayrollRun",
    entityId: run._id,
    entityLabel: run.reference,
    summary: `Cancelled payroll run ${run.reference}`,
  });
  res.json({ data: run });
});

export const reopenRun = catchAsync(async (req, res) => {
  const run = await payroll.reopenRun(req.orgId, req.params.id, req.auth);
  await recordAudit(req, {
    action: "payroll_run.reopen",
    entityType: "PayrollRun",
    entityId: run._id,
    entityLabel: run.reference,
    summary: `Reopened payroll run ${run.reference} for correction`,
  });
  res.json({ data: run });
});

export const deleteRun = catchAsync(async (req, res) => {
  await payroll.deleteRun(req.orgId, req.params.id, req.auth);
  await recordAudit(req, {
    action: "payroll_run.delete",
    entityType: "PayrollRun",
    entityId: req.params.id,
    summary: "Deleted a payroll run",
  });
  res.json({ data: { ok: true } });
});

export const bankExport = catchAsync(async (req, res) => {
  const csv = await payroll.bankExportCsv(req.orgId, req.params.id);
  await recordAudit(req, {
    action: "payroll_run.export",
    entityType: "PayrollRun",
    entityId: req.params.id,
    summary: "Exported payroll bank CSV",
  });
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="payroll-${req.params.id}.csv"`);
  res.send(csv);
});

/* -------- Payslips -------- */

export const listPayslips = catchAsync(async (req, res) => {
  res.json(await payroll.listPayslips(req.orgId, req.query));
});

export const getPayslip = catchAsync(async (req, res) => {
  const slip = await payroll.getPayslip(req.orgId, req.params.id);
  await assertPayslipAccess(req, slip);
  res.json({ data: slip });
});

export const myPayslips = catchAsync(async (req, res) => {
  const { Employee } = await import("../models/hrm/Employee.js");
  const me = await Employee.findOne({ organizationId: req.orgId, user: req.auth.userId }).select("_id");
  if (!me) {
    return res.json({ data: [] });
  }
  res.json({ data: await payroll.employeePayslips(req.orgId, me._id) });
});

export const markPaid = catchAsync(async (req, res) => {
  const slip = await payroll.markPayslipPaid(req.orgId, req.params.id);
  await recordAudit(req, {
    action: "payslip.mark_paid",
    entityType: "Payslip",
    entityId: slip._id,
    summary: `Marked payslip paid — ${slip.employeeSnapshot?.name}`,
  });
  res.json({ data: slip });
});

export const markAllPaid = catchAsync(async (req, res) => {
  const result = await payroll.markAllPaid(req.orgId, req.params.id);
  await recordAudit(req, {
    action: "payroll_run.mark_all_paid",
    entityType: "PayrollRun",
    entityId: req.params.id,
    summary: `Marked ${result.marked} payslip(s) paid`,
  });
  res.json({ data: result });
});

export const payslipPdf = catchAsync(async (req, res) => {
  const slip = await payroll.getPayslip(req.orgId, req.params.id);
  await assertPayslipAccess(req, slip);
  const org = await Organization.findById(req.orgId).select("name address");
  const pdf = await generatePayslipPdf(slip, org);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `inline; filename="payslip-${slip.employeeSnapshot?.employeeId}-${slip.year}-${slip.month}.pdf"`,
  );
  res.send(pdf);
});

/** Employees may only read their own payslip; payroll:read sees all. */
async function assertPayslipAccess(req, slip) {
  if (hasPermission(req.auth.permissions, "payroll:read")) return;
  const { Employee } = await import("../models/hrm/Employee.js");
  const me = await Employee.findOne({ organizationId: req.orgId, user: req.auth.userId }).select("_id");
  if (!me || String(me._id) !== String(slip.employee?._id ?? slip.employee)) {
    throw AppError.forbidden("You can only view your own payslips");
  }
}

/* -------- Trip logs -------- */

export const listTrips = catchAsync(async (req, res) => {
  res.json(await trips.listTrips(req.orgId, req.query));
});
export const createTrip = catchAsync(async (req, res) => {
  const trip = await trips.createTrip(req.orgId, req.body, req.auth.userId);
  res.status(201).json({ data: trip });
});
export const bulkTrips = catchAsync(async (req, res) => {
  const result = await trips.bulkImport(req.orgId, req.body.rows, req.auth.userId);
  await recordAudit(req, { action: "trip_log.import", summary: `Imported ${result.imported} trip log(s)` });
  res.json({ data: result });
});
export const deleteTrip = catchAsync(async (req, res) => {
  res.json({ data: await trips.deleteTrip(req.orgId, req.params.id) });
});

export default {
  getStructure,
  setStructure,
  deleteStructure,
  listRuns,
  getRun,
  createRun,
  calculateRun,
  approveRun,
  finalizeRun,
  cancelRun,
  reopenRun,
  deleteRun,
  bankExport,
  listPayslips,
  getPayslip,
  myPayslips,
  markPaid,
  markAllPaid,
  payslipPdf,
  listTrips,
  createTrip,
  bulkTrips,
  deleteTrip,
};
