import { Router } from "express";
import * as ctrl from "../controllers/leave.controller.js";
import { verifyToken } from "../middleware/auth.js";
import { scopeToOrg } from "../middleware/orgScope.js";
import { checkPermission, requireRole } from "../middleware/rbac.js";
import { HR_ADMIN_ROLES } from "../utils/permissions.js";
import { validate } from "../middleware/validate.js";
import {
  createLeaveTypeSchema,
  updateLeaveTypeSchema,
  leaveTypeActiveSchema,
  createLeaveRequestSchema,
  updateLeaveRequestSchema,
  decisionSchema,
  noteSchema,
  balanceAdjustSchema,
  listRequestsQuerySchema,
  calendarQuerySchema,
} from "../utils/validators/leave.validator.js";

const router = Router();
router.use(verifyToken, scopeToOrg);

/* ---- Leave types (config) ---- */
router.get("/types", checkPermission("leave:read"), ctrl.listTypes);
router.get("/types/:id", checkPermission("leave:read"), ctrl.getType);
router.post("/types", checkPermission("leave:configure"), validate(createLeaveTypeSchema), ctrl.createType);
router.patch("/types/:id", checkPermission("leave:configure"), validate(updateLeaveTypeSchema), ctrl.updateType);
router.patch("/types/:id/active", checkPermission("leave:configure"), validate(leaveTypeActiveSchema), ctrl.setTypeActive);
router.delete("/types/:id", requireRole(...HR_ADMIN_ROLES), ctrl.deleteType);

/* ---- Balances ---- */
router.get("/me", checkPermission("leave:read"), ctrl.myLeave);
router.get("/balances/:employeeId", checkPermission("leave:read"), ctrl.employeeBalances);
router.post("/balances/adjust", checkPermission("leave:configure"), validate(balanceAdjustSchema), ctrl.adjustBalance);

/* ---- Calendar ---- */
router.get("/calendar", checkPermission("leave:read"), validate(calendarQuerySchema, "query"), ctrl.calendar);

/* ---- Requests ---- */
router.get("/requests", checkPermission("leave:read"), validate(listRequestsQuerySchema, "query"), ctrl.listRequests);
router.get("/requests/:id", checkPermission("leave:read"), ctrl.getRequest);
router.post("/requests", checkPermission("leave:request"), validate(createLeaveRequestSchema), ctrl.createRequest);
router.patch("/requests/:id", checkPermission("leave:request"), validate(updateLeaveRequestSchema), ctrl.updateRequest);
router.post("/requests/:id/cancel", checkPermission("leave:request"), ctrl.cancelRequest);
router.post(
  "/requests/:id/note",
  checkPermission(["leave:approve_manager", "leave:approve_hr"], { mode: "any" }),
  validate(noteSchema),
  ctrl.addNote,
);
router.post(
  "/requests/:id/manager-decision",
  checkPermission(["leave:approve_manager", "leave:approve_hr"], { mode: "any" }),
  validate(decisionSchema),
  ctrl.managerDecision,
);
router.post(
  "/requests/:id/hr-decision",
  checkPermission("leave:approve_hr"),
  validate(decisionSchema),
  ctrl.hrDecision,
);

export default router;
