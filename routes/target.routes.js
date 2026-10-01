import { Router } from "express";
import * as ctrl from "../controllers/target.controller.js";
import { verifyToken } from "../middleware/auth.js";
import { scopeToOrg } from "../middleware/orgScope.js";
import { checkPermission, requireRole } from "../middleware/rbac.js";
import { HR_ADMIN_ROLES } from "../utils/permissions.js";
import { validate } from "../middleware/validate.js";
import { createTargetSchema, updateTargetSchema, progressSchema } from "../utils/validators/phase5.validator.js";

const router = Router();
router.use(verifyToken, scopeToOrg);

router.get("/summary", checkPermission("target:read"), ctrl.summary);
router.get("/", checkPermission("target:read"), ctrl.list);
router.get("/:id", checkPermission("target:read"), ctrl.get);
router.post("/", checkPermission("target:write"), validate(createTargetSchema), ctrl.create);
router.patch("/:id", checkPermission("target:write"), validate(updateTargetSchema), ctrl.update);
router.post("/:id/progress", checkPermission("target:update_progress"), validate(progressSchema), ctrl.addProgress);
router.delete("/:id", requireRole(...HR_ADMIN_ROLES), ctrl.remove);

export default router;
