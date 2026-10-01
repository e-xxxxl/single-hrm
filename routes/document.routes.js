import { Router } from "express";
import * as ctrl from "../controllers/document.controller.js";
import * as fileCtrl from "../controllers/file.controller.js";
import { verifyToken } from "../middleware/auth.js";
import { scopeToOrg } from "../middleware/orgScope.js";
import { checkPermission } from "../middleware/rbac.js";
import { validate } from "../middleware/validate.js";
import { upload } from "../middleware/upload.js";
import { createDocumentSchema, updateDocumentSchema } from "../utils/validators/phase5.validator.js";

const router = Router();
router.use(verifyToken, scopeToOrg);

router.get("/summary", checkPermission("document:read"), ctrl.summary);
router.get("/", checkPermission("document:read"), ctrl.list);
router.get("/:id", checkPermission("document:read"), ctrl.get);
router.post("/", checkPermission("document:write"), validate(createDocumentSchema), ctrl.create);
router.post("/me", checkPermission("document:write_own"), validate(createDocumentSchema), ctrl.createOwn);
router.post(
  "/upload",
  checkPermission(["document:write", "document:write_own"], { mode: "any" }),
  upload,
  fileCtrl.upload,
);
router.patch("/:id", checkPermission("document:write"), validate(updateDocumentSchema), ctrl.update);
router.post("/:id/archive", checkPermission("document:write"), ctrl.archive);
router.delete("/:id", checkPermission("document:delete"), ctrl.remove);

export default router;
