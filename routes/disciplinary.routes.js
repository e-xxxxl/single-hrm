import { Router } from "express";
import * as ctrl from "../controllers/disciplinary.controller.js";
import { verifyToken } from "../middleware/auth.js";
import { scopeToOrg } from "../middleware/orgScope.js";
import { checkPermission, requireRole } from "../middleware/rbac.js";
import { HR_ADMIN_ROLES } from "../utils/permissions.js";
import { validate } from "../middleware/validate.js";
import {
  createCaseSchema,
  updateCaseSchema,
  issueQuerySchema,
  caseResponseSchema,
  hearingSchema,
  hearingRecordSchema,
  outcomeSchema,
  noteSchema,
} from "../utils/validators/phase5.validator.js";

const router = Router();
router.use(verifyToken, scopeToOrg);

const read = checkPermission("disciplinary:read");
const write = checkPermission("disciplinary:write");

router.get("/", read, ctrl.list);
router.get("/:id", read, ctrl.get);
router.post("/", write, validate(createCaseSchema), ctrl.create);
router.patch("/:id", write, validate(updateCaseSchema), ctrl.update);
router.post("/:id/query", write, validate(issueQuerySchema), ctrl.issueQuery);
router.get("/:id/query-letter", read, ctrl.queryLetter);
router.post("/:id/response", write, validate(caseResponseSchema), ctrl.recordResponse);
router.post("/:id/hearing", write, validate(hearingSchema), ctrl.scheduleHearing);
router.post("/:id/hearing/record", write, validate(hearingRecordSchema), ctrl.recordHearing);
router.post("/:id/outcome", write, validate(outcomeSchema), ctrl.recordOutcome);
router.post("/:id/note", write, validate(noteSchema), ctrl.addNote);
router.delete("/:id", requireRole(...HR_ADMIN_ROLES), ctrl.remove);

export default router;
