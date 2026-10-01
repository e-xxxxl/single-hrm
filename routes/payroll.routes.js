import { Router } from "express";
import * as ctrl from "../controllers/payroll.controller.js";
import { verifyToken } from "../middleware/auth.js";
import { scopeToOrg } from "../middleware/orgScope.js";
import { checkPermission, requireRole } from "../middleware/rbac.js";
import { HR_ADMIN_ROLES, ORG_ADMIN_ROLE } from "../utils/permissions.js";
import { validate } from "../middleware/validate.js";
import {
  salaryStructureSchema,
  createRunSchema,
  calculateRunSchema,
  runListQuerySchema,
  payslipListQuerySchema,
  createTripSchema,
  bulkTripSchema,
  tripListQuerySchema,
} from "../utils/validators/payroll.validator.js";

const router = Router();
router.use(verifyToken, scopeToOrg);

/* Salary structures */
router.get("/structures/:employeeId", checkPermission("payroll:read"), ctrl.getStructure);
router.put(
  "/structures/:employeeId",
  checkPermission("payroll:configure"),
  validate(salaryStructureSchema),
  ctrl.setStructure,
);
router.delete(
  "/structures/:employeeId/:structureId",
  requireRole(...HR_ADMIN_ROLES),
  ctrl.deleteStructure,
);

/* Runs */
router.get("/runs", checkPermission("payroll:read"), validate(runListQuerySchema, "query"), ctrl.listRuns);
router.get("/runs/:id", checkPermission("payroll:read"), ctrl.getRun);
router.post("/runs", checkPermission("payroll:run"), validate(createRunSchema), ctrl.createRun);
router.post("/runs/:id/calculate", checkPermission("payroll:run"), validate(calculateRunSchema), ctrl.calculateRun);
router.post("/runs/:id/approve", checkPermission("payroll:approve"), ctrl.approveRun);
router.post("/runs/:id/finalize", checkPermission("payroll:approve"), ctrl.finalizeRun);
router.post("/runs/:id/cancel", checkPermission("payroll:run"), ctrl.cancelRun);
// Reopening/deleting a run that's already gone through approval touches
// finalized financial records — restricted to the Org Admin.
router.post("/runs/:id/reopen", requireRole(ORG_ADMIN_ROLE), ctrl.reopenRun);
router.delete("/runs/:id", requireRole(ORG_ADMIN_ROLE), ctrl.deleteRun);
router.get("/runs/:id/bank-export", checkPermission("payroll:export"), ctrl.bankExport);

/* Payslips */
router.get("/payslips", checkPermission("payroll:read"), validate(payslipListQuerySchema, "query"), ctrl.listPayslips);
router.get("/payslips/mine", checkPermission("payroll:read_own"), ctrl.myPayslips);
router.get("/payslips/:id", checkPermission(["payroll:read", "payroll:read_own"], { mode: "any" }), ctrl.getPayslip);
router.get("/payslips/:id/pdf", checkPermission(["payroll:read", "payroll:read_own"], { mode: "any" }), ctrl.payslipPdf);
router.post("/payslips/:id/mark-paid", checkPermission("payroll:approve"), ctrl.markPaid);
router.post("/runs/:id/mark-all-paid", checkPermission("payroll:approve"), ctrl.markAllPaid);

/* Trip logs (hybrid payroll input) */
router.get("/trips", checkPermission("payroll:read"), validate(tripListQuerySchema, "query"), ctrl.listTrips);
router.post("/trips", checkPermission("payroll:configure"), validate(createTripSchema), ctrl.createTrip);
router.post("/trips/bulk", checkPermission("payroll:configure"), validate(bulkTripSchema), ctrl.bulkTrips);
router.delete("/trips/:id", checkPermission("payroll:configure"), ctrl.deleteTrip);

export default router;
