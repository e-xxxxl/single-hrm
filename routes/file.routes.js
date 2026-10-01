import { Router } from "express";
import * as ctrl from "../controllers/file.controller.js";
import { verifyToken } from "../middleware/auth.js";
import { scopeToOrg } from "../middleware/orgScope.js";
import { upload } from "../middleware/upload.js";

const router = Router();
router.use(verifyToken);

// Generic authenticated upload — any signed-in member of the org. The consuming
// module (documents, recruitment, disciplinary) enforces its own write
// permission when it records the returned reference. scopeToOrg runs *after*
// multer so the tenant context wraps the handler (multer resumes the chain
// from a stream callback outside the request's async context).
router.post("/", upload, scopeToOrg, ctrl.upload);
router.get("/:id", scopeToOrg, ctrl.download);

export default router;
