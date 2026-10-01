import { Router } from "express";
import * as ctrl from "../controllers/branch.controller.js";
import { verifyToken } from "../middleware/auth.js";
import { scopeToOrg } from "../middleware/orgScope.js";
import { checkPermission, requireRole } from "../middleware/rbac.js";
import { HR_ADMIN_ROLES } from "../utils/permissions.js";
import { validate } from "../middleware/validate.js";
import {
  createBranchSchema,
  updateBranchSchema,
  branchStatusSchema,
} from "../utils/validators/branch.validator.js";

const router = Router();
router.use(verifyToken, scopeToOrg);

router.get("/", checkPermission("branch:read"), ctrl.list);
router.get("/:id", checkPermission("branch:read"), ctrl.get);
router.post("/", checkPermission("branch:write"), validate(createBranchSchema), ctrl.create);
router.patch("/:id", checkPermission("branch:write"), validate(updateBranchSchema), ctrl.update);
router.patch("/:id/status", checkPermission("branch:write"), validate(branchStatusSchema), ctrl.setStatus);
router.delete("/:id", requireRole(...HR_ADMIN_ROLES), ctrl.remove);

export default router;
