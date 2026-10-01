import { Router } from "express";
import * as ctrl from "../controllers/referral.controller.js";
import { verifyToken } from "../middleware/auth.js";
import { scopeToOrg } from "../middleware/orgScope.js";
import { checkPermission } from "../middleware/rbac.js";
import { validate } from "../middleware/validate.js";
import { createReferralSchema, updateReferralSchema } from "../utils/validators/referral.validator.js";

const router = Router();
router.use(verifyToken, scopeToOrg);

router.get("/", checkPermission("performance:read"), ctrl.list);
router.post("/", checkPermission("performance:write"), validate(createReferralSchema), ctrl.create);
router.patch("/:id", checkPermission("performance:write"), validate(updateReferralSchema), ctrl.update);
router.delete("/:id", checkPermission("performance:write"), ctrl.remove);

export default router;
