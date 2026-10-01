import { Router } from "express";
import { verifyToken } from "../middleware/auth.js";
import { scopeToOrg } from "../middleware/orgScope.js";
import { checkPermission } from "../middleware/rbac.js";
import { catchAsync } from "../utils/catchAsync.js";
import { runDailyHrChecks } from "../services/maintenance.service.js";

const router = Router();
router.use(verifyToken, scopeToOrg);

// Manually trigger the daily HR checks for the caller's organization.
router.post(
  "/run-hr-checks",
  checkPermission("settings:write"),
  catchAsync(async (req, res) => {
    const report = await runDailyHrChecks({ organizationId: req.orgId });
    res.json({ data: report });
  }),
);

export default router;
