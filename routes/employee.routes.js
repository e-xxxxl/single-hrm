import { Router } from "express";
import * as ctrl from "../controllers/employee.controller.js";
import { verifyToken } from "../middleware/auth.js";
import { scopeToOrg } from "../middleware/orgScope.js";
import { checkPermission, requireRole } from "../middleware/rbac.js";
import { validate } from "../middleware/validate.js";
import { z } from "zod";
import { ORG_ROLES, ORG_ADMIN_ROLE, HR_ADMIN_ROLES } from "../utils/permissions.js";
import {
  createEmployeeSchema,
  updateEmployeeSchema,
  employeeStatusSchema,
} from "../utils/validators/employee.validator.js";

const provisionLoginSchema = z.object({
  role: z.enum(ORG_ROLES),
  password: z.string().min(8).max(128).optional(),
});

const updateLoginSchema = z.object({
  email: z.string().email().optional(),
  role: z.enum(ORG_ROLES).optional(),
  status: z.enum(["active", "suspended"]).optional(),
});

const resetPasswordSchema = z.object({
  password: z.string().min(8).max(128).optional(),
});

const router = Router();
router.use(verifyToken, scopeToOrg);

router.get("/", checkPermission("employee:read"), ctrl.list);
router.get("/:id", checkPermission("employee:read"), ctrl.get);
router.post("/", checkPermission("employee:write"), validate(createEmployeeSchema), ctrl.create);
router.patch("/:id", checkPermission("employee:write"), validate(updateEmployeeSchema), ctrl.update);
router.post(
  "/:id/login",
  checkPermission(["employee:write", "user:write"]),
  validate(provisionLoginSchema),
  ctrl.provisionLogin,
);
router.patch(
  "/:id/status",
  checkPermission("employee:deactivate"),
  validate(employeeStatusSchema),
  ctrl.setStatus,
);
// Delete cascades through every record about the employee — Org Admin only
// (employee.service.js deleteEmployee double-checks this). HR Managers can
// still edit and deactivate (see above).
router.delete("/:id", requireRole(ORG_ADMIN_ROLE), ctrl.remove);

// View/edit/reset an employee's login — HR admin roles; the service further
// restricts which roles each may grant (utils/permissions.js assignableRoles).
router.get("/:id/login", requireRole(...HR_ADMIN_ROLES), ctrl.getLogin);
router.patch("/:id/login", requireRole(...HR_ADMIN_ROLES), validate(updateLoginSchema), ctrl.updateLogin);
router.post(
  "/:id/login/reset-password",
  requireRole(...HR_ADMIN_ROLES),
  validate(resetPasswordSchema),
  ctrl.resetLoginPassword,
);

export default router;
