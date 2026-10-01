import { Router } from "express";
import { z } from "zod";
import * as ctrl from "../controllers/settings.controller.js";
import { verifyToken } from "../middleware/auth.js";
import { scopeToOrg } from "../middleware/orgScope.js";
import { checkPermission } from "../middleware/rbac.js";
import { validate } from "../middleware/validate.js";

const updateSchema = z.object({
  workweek: z.array(z.number().int().min(0).max(6)).min(1).max(7).optional(),
  standardClockIn: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  lateGraceMinutes: z.coerce.number().int().min(0).max(240).optional(),
  standardWorkHours: z.coerce.number().min(1).max(24).optional(),
  minBranchCoverage: z.coerce.number().int().min(0).max(1000).optional(),
  payDayOfMonth: z.coerce.number().int().min(1).max(31).optional(),
  probationMonths: z.coerce.number().int().min(0).max(24).optional(),
  contractAlertDays: z.array(z.number().int().min(1).max(365)).max(6).optional(),
  reviewCyclesPerYear: z.coerce.number().int().min(1).max(12).optional(),
  documentTypes: z.array(z.string().min(1).max(80)).max(40).optional(),
  notifications: z
    .object({
      leaveWorkflow: z.boolean().optional(),
      payslipReady: z.boolean().optional(),
      contractExpiry: z.boolean().optional(),
      reviewDue: z.boolean().optional(),
      targetDeadline: z.boolean().optional(),
    })
    .optional(),
});

const router = Router();
router.use(verifyToken, scopeToOrg);

router.get("/", checkPermission("settings:read"), ctrl.get);
router.patch("/", checkPermission("settings:write"), validate(updateSchema), ctrl.update);

export default router;
