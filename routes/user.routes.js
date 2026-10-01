import { Router } from "express";
import { z } from "zod";
import * as ctrl from "../controllers/user.controller.js";
import { verifyToken } from "../middleware/auth.js";
import { scopeToOrg } from "../middleware/orgScope.js";
import { checkPermission } from "../middleware/rbac.js";
import { validate } from "../middleware/validate.js";
import { ORG_ROLES } from "../utils/permissions.js";
import { password } from "../utils/validators/auth.validator.js";

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "invalid id");

const createUserSchema = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email().transform((s) => s.toLowerCase().trim()),
  phone: z.string().max(30).optional(),
  role: z.enum(ORG_ROLES),
  password: password.optional(),
  employee: objectId.optional(),
});

const updateUserSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  phone: z.string().max(30).optional(),
  role: z.enum(ORG_ROLES).optional(),
  status: z.enum(["active", "suspended"]).optional(),
  permissionsGrant: z.array(z.string().max(60)).max(80).optional(),
  permissionsRevoke: z.array(z.string().max(60)).max(80).optional(),
});

const resetSchema = z.object({ password: password.optional() });

const router = Router();
router.use(verifyToken, scopeToOrg);

router.get("/", checkPermission("user:read"), ctrl.list);
router.get("/roles", checkPermission("user:read"), ctrl.roles);
router.get("/:id", checkPermission("user:read"), ctrl.get);
router.post("/", checkPermission("user:write"), validate(createUserSchema), ctrl.create);
router.patch("/:id", checkPermission("user:write"), validate(updateUserSchema), ctrl.update);
router.post("/:id/reset-password", checkPermission("user:write"), validate(resetSchema), ctrl.resetPassword);

export default router;
