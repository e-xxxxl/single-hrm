import { Router } from "express";
import * as ctrl from "../controllers/attendance.controller.js";
import { verifyToken } from "../middleware/auth.js";
import { scopeToOrg } from "../middleware/orgScope.js";
import { checkPermission } from "../middleware/rbac.js";
import { validate } from "../middleware/validate.js";
import {
  clockInSchema,
  clockOutSchema,
  dayQuerySchema,
  recordsQuerySchema,
  monthlyQuerySchema,
  manualEntrySchema,
} from "../utils/validators/attendance.validator.js";

const router = Router();
router.use(verifyToken, scopeToOrg);

// Self-service — any authenticated employee.
router.get("/me", checkPermission("attendance:read"), ctrl.myStatus);
router.post("/clock-in", checkPermission("attendance:clock"), validate(clockInSchema), ctrl.clockIn);
router.post("/clock-out", checkPermission("attendance:clock"), validate(clockOutSchema), ctrl.clockOut);

// Oversight — HR / managers only (roster of other employees).
const oversight = checkPermission(["attendance:manage", "attendance:report"], { mode: "any" });
router.get("/today", oversight, validate(dayQuerySchema, "query"), ctrl.today);
router.get("/records", oversight, validate(recordsQuerySchema, "query"), ctrl.records);
router.get(
  "/reports/monthly",
  checkPermission("attendance:report"),
  validate(monthlyQuerySchema, "query"),
  ctrl.monthly,
);
router.get("/reports/punctuality", checkPermission("attendance:read"), ctrl.punctuality);
router.post("/manual", checkPermission("attendance:manage"), validate(manualEntrySchema), ctrl.manualEntry);

export default router;
