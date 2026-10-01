import { Router } from "express";
import * as ctrl from "../controllers/recruitment.controller.js";
import { verifyToken } from "../middleware/auth.js";
import { scopeToOrg } from "../middleware/orgScope.js";
import { checkPermission, requireRole } from "../middleware/rbac.js";
import { HR_ADMIN_ROLES } from "../utils/permissions.js";
import { validate } from "../middleware/validate.js";
import {
  createJobSchema,
  updateJobSchema,
  addApplicantSchema,
  moveStageSchema,
  updateApplicantSchema,
  interviewSchema,
  interviewFeedbackSchema,
  convertApplicantSchema,
  noteSchema,
} from "../utils/validators/phase5.validator.js";

const router = Router();
router.use(verifyToken, scopeToOrg);

const read = checkPermission("recruitment:read");
const write = checkPermission("recruitment:write");
const move = checkPermission(["recruitment:move_stage", "recruitment:write"], { mode: "any" });

router.get("/summary", read, ctrl.summary);

router.get("/jobs", read, ctrl.listJobs);
router.get("/jobs/:id", read, ctrl.getJob);
router.post("/jobs", write, validate(createJobSchema), ctrl.createJob);
router.patch("/jobs/:id", write, validate(updateJobSchema), ctrl.updateJob);
router.delete("/jobs/:id", requireRole(...HR_ADMIN_ROLES), ctrl.deleteJob);
router.get("/jobs/:jobId/pipeline", read, ctrl.pipeline);

router.get("/applicants", read, ctrl.listApplicants);
router.get("/applicants/:id", read, ctrl.getApplicant);
router.post("/applicants", write, validate(addApplicantSchema), ctrl.addApplicant);
router.patch("/applicants/:id", write, validate(updateApplicantSchema), ctrl.updateApplicant);
router.post("/applicants/:id/stage", move, validate(moveStageSchema), ctrl.moveStage);
router.post("/applicants/:id/interviews", write, validate(interviewSchema), ctrl.scheduleInterview);
router.post("/applicants/:id/interviews/:index/feedback", write, validate(interviewFeedbackSchema), ctrl.interviewFeedback);
router.post("/applicants/:id/note", read, validate(noteSchema), ctrl.addApplicantNote);
router.post("/applicants/:id/convert", checkPermission(["recruitment:write", "employee:write"]), validate(convertApplicantSchema), ctrl.convert);
router.delete("/applicants/:id", requireRole(...HR_ADMIN_ROLES), ctrl.deleteApplicant);

export default router;
