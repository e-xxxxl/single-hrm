import { Router } from "express";
import * as ctrl from "../controllers/loan.controller.js";
import { verifyToken } from "../middleware/auth.js";
import { scopeToOrg } from "../middleware/orgScope.js";
import { checkPermission } from "../middleware/rbac.js";
import { validate } from "../middleware/validate.js";
import { applyLoanSchema, decideLoanSchema, loanListQuerySchema } from "../utils/validators/loan.validator.js";

const router = Router();
router.use(verifyToken, scopeToOrg);

const selfService = checkPermission(["payroll:read", "payroll:read_own"], { mode: "any" });
const manage = checkPermission("payroll:configure");

/* Self-service — declared before /:id so "mine" isn't treated as an id */
router.get("/mine", selfService, ctrl.mine);
router.post("/", selfService, validate(applyLoanSchema), ctrl.apply);
router.post("/:id/cancel", selfService, ctrl.cancel);

/* Approval */
router.get("/", manage, validate(loanListQuerySchema, "query"), ctrl.list);
router.get("/:id", manage, ctrl.get);
router.post("/:id/decide", manage, validate(decideLoanSchema), ctrl.decide);

export default router;
