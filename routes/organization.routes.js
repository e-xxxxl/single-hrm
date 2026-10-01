import { Router } from "express";
import * as ctrl from "../controllers/organization.controller.js";
import { verifyToken } from "../middleware/auth.js";
import { scopeToOrg } from "../middleware/orgScope.js";
import { checkPermission } from "../middleware/rbac.js";
import { validate } from "../middleware/validate.js";
import { uploadLogo } from "../middleware/upload.js";
import { orgProfileSchema } from "../utils/validators/organization.validator.js";

/**
 * The caller's own organization. There is no `:id` — the organization is
 * always the authenticated user's (req.orgId), so no request can name another.
 */
const router = Router();
router.use(verifyToken);

router.get("/", scopeToOrg, checkPermission("org:read"), ctrl.get);
router.patch("/", scopeToOrg, checkPermission("org:write"), validate(orgProfileSchema), ctrl.update);
router.post("/logo", checkPermission("org:write"), uploadLogo, scopeToOrg, ctrl.uploadLogo);
router.delete("/logo", scopeToOrg, checkPermission("org:write"), ctrl.removeLogo);

export default router;
