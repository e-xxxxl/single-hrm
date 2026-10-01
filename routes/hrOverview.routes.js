import { Router } from "express";
import { verifyToken } from "../middleware/auth.js";
import { scopeToOrg } from "../middleware/orgScope.js";
import { checkPermission } from "../middleware/rbac.js";
import { catchAsync } from "../utils/catchAsync.js";
import { getOverview } from "../services/hrOverview.service.js";

const router = Router();
router.use(verifyToken, scopeToOrg);

router.get(
  "/",
  checkPermission(["employee:read", "report:hr"], { mode: "any" }),
  catchAsync(async (req, res) => {
    res.json({ data: await getOverview(req.orgId) });
  }),
);

export default router;
