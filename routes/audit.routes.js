import { Router } from "express";
import * as ctrl from "../controllers/audit.controller.js";
import { verifyToken } from "../middleware/auth.js";
import { scopeToOrg } from "../middleware/orgScope.js";
import { checkPermission } from "../middleware/rbac.js";
import { validate } from "../middleware/validate.js";
import { auditQuerySchema } from "../utils/validators/audit.validator.js";

const router = Router();
router.use(verifyToken, scopeToOrg, checkPermission("audit:read"));

router.get("/facets", ctrl.facets);
router.get("/", validate(auditQuerySchema, "query"), ctrl.list);

export default router;
