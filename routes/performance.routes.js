import { Router } from "express";
import * as ctrl from "../controllers/performance.controller.js";
import { verifyToken } from "../middleware/auth.js";
import { scopeToOrg } from "../middleware/orgScope.js";
import { checkPermission, requireRole } from "../middleware/rbac.js";
import { HR_ADMIN_ROLES } from "../utils/permissions.js";
import { validate } from "../middleware/validate.js";
import {
  kpiSchema,
  createReviewSchema,
  updateReviewSchema,
  reviewActionSchema,
} from "../utils/validators/phase5.validator.js";

const router = Router();
router.use(verifyToken, scopeToOrg);

router.get("/dashboard", checkPermission("performance:read"), ctrl.dashboard);

router.get("/kpis", checkPermission("performance:read"), ctrl.listKpis);
router.post("/kpis", checkPermission("performance:write"), validate(kpiSchema), ctrl.createKpi);
router.patch("/kpis/:id", checkPermission("performance:write"), validate(kpiSchema.partial()), ctrl.updateKpi);
router.delete("/kpis/:id", requireRole(...HR_ADMIN_ROLES), ctrl.deleteKpi);

router.get("/reviews", checkPermission("performance:read"), ctrl.listReviews);
router.get("/reviews/:id", checkPermission("performance:read"), ctrl.getReview);
router.post("/reviews", checkPermission("performance:write"), validate(createReviewSchema), ctrl.createReview);
router.patch("/reviews/:id", checkPermission("performance:read"), validate(updateReviewSchema), ctrl.updateReview);
router.post("/reviews/:id/transition", checkPermission("performance:read"), validate(reviewActionSchema), ctrl.transitionReview);
router.delete("/reviews/:id", requireRole(...HR_ADMIN_ROLES), ctrl.deleteReview);

export default router;
