import { Router } from "express";
import { verifyToken } from "../middleware/auth.js";
import { scopeToOrg } from "../middleware/orgScope.js";
import { checkPermission } from "../middleware/rbac.js";
import { catchAsync } from "../utils/catchAsync.js";
import { hrReport } from "../services/reports.service.js";

const router = Router();
router.use(verifyToken, scopeToOrg);

/* HRM consolidated report — always for the caller's own organization. */
router.get(
  "/hr",
  checkPermission("report:hr"),
  catchAsync(async (req, res) => {
    res.json({ data: await hrReport(req.orgId, { month: req.query.month }) });
  }),
);

export default router;
