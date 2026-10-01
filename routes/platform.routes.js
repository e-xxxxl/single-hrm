import { Router } from "express";
import * as ctrl from "../controllers/platform.controller.js";
import { verifyToken } from "../middleware/auth.js";
import { requirePlatformAdmin } from "../middleware/orgScope.js";
import { checkPermission } from "../middleware/rbac.js";
import { validate } from "../middleware/validate.js";
import {
  createOrganizationSchema,
  updateOrganizationSchema,
  orgStatusSchema,
  addOrgAdminSchema,
  orgAdminStatusSchema,
  platformSettingsSchema,
} from "../utils/validators/organization.validator.js";

/**
 * Platform administration. Only the Platform Admin reaches these routes; no
 * organization user — not even an Org Admin — can, and nothing here runs
 * inside an organization's tenant context.
 */
const router = Router();
router.use(verifyToken, requirePlatformAdmin);

const read = checkPermission("platform:read");
const write = checkPermission("platform:write");

router.get("/overview", read, ctrl.overview);

router.get("/organizations", read, ctrl.listOrganizations);
router.post("/organizations", write, validate(createOrganizationSchema), ctrl.createOrganization);
router.get("/organizations/:id", read, ctrl.getOrganization);
router.patch("/organizations/:id", write, validate(updateOrganizationSchema), ctrl.updateOrganization);
router.patch("/organizations/:id/status", write, validate(orgStatusSchema), ctrl.setOrganizationStatus);

router.post("/organizations/:id/admins", write, validate(addOrgAdminSchema), ctrl.addOrgAdmin);
router.patch(
  "/organizations/:id/admins/:userId/status",
  write,
  validate(orgAdminStatusSchema),
  ctrl.setOrgAdminStatus,
);
router.post("/organizations/:id/admins/:userId/reset-password", write, ctrl.resetOrgAdminPassword);

router.get("/settings", read, ctrl.getSettings);
router.patch("/settings", write, validate(platformSettingsSchema), ctrl.updateSettings);

router.get("/audit", read, ctrl.audit);

export default router;
