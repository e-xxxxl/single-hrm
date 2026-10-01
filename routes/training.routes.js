import { Router } from "express";
import * as ctrl from "../controllers/training.controller.js";
import { verifyToken } from "../middleware/auth.js";
import { scopeToOrg } from "../middleware/orgScope.js";
import { checkPermission, requireRole } from "../middleware/rbac.js";
import { HR_ADMIN_ROLES } from "../utils/permissions.js";
import { validate } from "../middleware/validate.js";
import {
  createTrainingSchema,
  updateTrainingSchema,
  trainingActiveSchema,
  recordAttendanceSchema,
} from "../utils/validators/training.validator.js";

const router = Router();
router.use(verifyToken, scopeToOrg);

// Catalog — creating needs training:write; editing/deactivating/deleting an
// existing entry is limited to the HR admin roles (Org Admin, HR Manager).
// Everyone with training:read can browse the catalog.
router.get("/", checkPermission("training:read"), ctrl.list);
router.post("/", checkPermission("training:write"), validate(createTrainingSchema), ctrl.create);
router.patch("/:id", requireRole(...HR_ADMIN_ROLES), validate(updateTrainingSchema), ctrl.update);
router.patch("/:id/active", requireRole(...HR_ADMIN_ROLES), validate(trainingActiveSchema), ctrl.setActive);
router.delete("/:id", requireRole(...HR_ADMIN_ROLES), ctrl.remove);

// Attendance — anyone who can view an employee's profile can see their
// training history; recording/removing it needs the same tier that already
// manages employee records. `/me` is the self-service view.
router.get("/attendance/me", checkPermission("training:read"), ctrl.listOwnAttendance);
router.get("/attendance", checkPermission("employee:read"), ctrl.listAttendance);
router.post("/attendance", checkPermission("employee:write"), validate(recordAttendanceSchema), ctrl.recordAttendance);
router.delete("/attendance/:id", checkPermission("employee:write"), ctrl.deleteAttendance);

export default router;
