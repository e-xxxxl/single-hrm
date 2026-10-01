import { z } from "zod";
import { EMPLOYMENT_TYPES } from "../../models/hrm/Employee.js";
import { LEAVE_CATEGORIES } from "../../models/hrm/LeaveType.js";
import { DOCUMENT_CATEGORIES } from "../../models/hrm/HrDocument.js";
import { DISCIPLINARY_CATEGORIES, DISCIPLINARY_OUTCOMES } from "../../models/hrm/DisciplinaryCase.js";
import { APPLICANT_STAGES } from "../../models/hrm/Applicant.js";
import { ORG_ROLES } from "../permissions.js";

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "invalid id");
const date = z.coerce.date();

/* ------------------------------- Performance ------------------------------ */

export const kpiSchema = z.object({
  name: z.string().min(2).max(120),
  description: z.string().max(500).optional(),
  category: z.string().max(60).optional(),
  unit: z.string().max(20).optional(),
  direction: z.enum(["higher_better", "lower_better"]).optional(),
  department: objectId.optional(),
  active: z.boolean().optional(),
});

const reviewKpiLine = z.object({
  kpi: objectId.optional(),
  name: z.string().min(1).max(120),
  weight: z.coerce.number().min(0).max(100).optional(),
  target: z.string().max(200).optional(),
  actual: z.string().max(200).optional(),
  score: z.coerce.number().min(1).max(5).optional(),
  comment: z.string().max(1000).optional(),
});

export const createReviewSchema = z.object({
  employee: objectId,
  reviewer: objectId.optional(),
  cycle: z.string().min(2).max(40),
  type: z.enum(["quarterly", "annual", "probation", "project"]).optional(),
  periodStart: date.optional(),
  periodEnd: date.optional(),
  dueDate: date.optional(),
  kpis: z.array(reviewKpiLine).max(30).optional(),
});

export const updateReviewSchema = z.object({
  kpis: z.array(reviewKpiLine).max(30).optional(),
  managerComments: z.string().max(4000).optional(),
  employeeComments: z.string().max(4000).optional(),
  developmentPlan: z.string().max(4000).optional(),
  dueDate: date.optional(),
});

export const reviewActionSchema = z.object({
  action: z.enum(["open_self_review", "submit_self_review", "complete", "acknowledge"]),
});

/* --------------------------------- Targets -------------------------------- */

export const createTargetSchema = z
  .object({
    employee: objectId.optional(),
    department: objectId.optional(),
    title: z.string().min(2).max(160),
    description: z.string().max(1000).optional(),
    kpi: objectId.optional(),
    kpiName: z.string().max(120).optional(),
    metricUnit: z.string().max(20).optional(),
    direction: z.enum(["higher_better", "lower_better"]).optional(),
    baselineValue: z.coerce.number().optional(),
    targetValue: z.coerce.number(),
    currentValue: z.coerce.number().optional(),
    startDate: date,
    deadline: date,
    weight: z.coerce.number().min(0).max(100).optional(),
  })
  .refine((v) => v.deadline >= v.startDate, { message: "Deadline must be after the start date", path: ["deadline"] });

export const updateTargetSchema = z.object({
  title: z.string().min(2).max(160).optional(),
  description: z.string().max(1000).optional(),
  targetValue: z.coerce.number().optional(),
  baselineValue: z.coerce.number().optional(),
  metricUnit: z.string().max(20).optional(),
  direction: z.enum(["higher_better", "lower_better"]).optional(),
  startDate: date.optional(),
  deadline: date.optional(),
  weight: z.coerce.number().min(0).max(100).optional(),
  status: z.enum(["cancelled", "achieved", "missed"]).optional(),
});

export const progressSchema = z.object({
  value: z.coerce.number(),
  note: z.string().max(500).optional(),
});

/* ------------------------------- Recruitment ------------------------------ */

export const createJobSchema = z.object({
  title: z.string().min(2).max(160),
  department: objectId.optional(),
  branch: objectId.optional(),
  employmentType: z.enum(EMPLOYMENT_TYPES).optional(),
  description: z.string().max(6000).optional(),
  responsibilities: z.string().max(6000).optional(),
  requirements: z.string().max(6000).optional(),
  salaryMin: z.coerce.number().min(0).optional(),
  salaryMax: z.coerce.number().min(0).optional(),
  salaryVisible: z.boolean().optional(),
  openings: z.coerce.number().int().min(1).max(500).optional(),
  hiringManager: objectId.optional(),
  status: z.enum(["draft", "open", "closed", "filled", "cancelled"]).optional(),
  closingDate: date.optional(),
});

export const updateJobSchema = createJobSchema.partial();

export const addApplicantSchema = z.object({
  jobPosting: objectId,
  name: z.string().min(2).max(160),
  email: z.string().email(),
  phone: z.string().max(30).optional(),
  resumeUrl: z.string().max(500).optional(),
  coverLetter: z.string().max(6000).optional(),
  source: z.string().max(60).optional(),
  currentEmployer: z.string().max(160).optional(),
  expectedSalary: z.coerce.number().min(0).optional(),
});

export const moveStageSchema = z.object({
  stage: z.enum(APPLICANT_STAGES),
  note: z.string().max(1000).optional(),
  rejectionReason: z.string().max(500).optional(),
});

export const updateApplicantSchema = z.object({
  phone: z.string().max(30).optional(),
  resumeUrl: z.string().max(500).optional(),
  coverLetter: z.string().max(6000).optional(),
  rating: z.coerce.number().min(1).max(5).optional(),
  assignedRecruiter: objectId.optional(),
  currentEmployer: z.string().max(160).optional(),
  expectedSalary: z.coerce.number().min(0).optional(),
  source: z.string().max(60).optional(),
  offer: z
    .object({
      salary: z.coerce.number().min(0).optional(),
      startDate: date.optional(),
      sentAt: date.optional(),
      response: z.enum(["pending", "accepted", "declined"]).optional(),
    })
    .optional(),
});

export const interviewSchema = z.object({
  scheduledFor: date,
  mode: z.enum(["onsite", "phone", "video"]).optional(),
  location: z.string().max(200).optional(),
  interviewers: z.array(z.string().max(120)).max(10).optional(),
});

export const interviewFeedbackSchema = z.object({
  feedback: z.string().max(4000),
  outcome: z.enum(["pending", "pass", "fail", "hold"]).optional(),
});

export const convertApplicantSchema = z.object({
  dateJoined: date.optional(),
  branch: objectId.optional(),
  department: objectId.optional(),
  phone: z.string().max(30).optional(),
  position: z.string().max(120).optional(),
  provisionLogin: z.object({ role: z.enum(ORG_ROLES), password: z.string().min(8).max(128).optional() }).optional(),
});

/* -------------------------------- Documents ------------------------------- */

export const createDocumentSchema = z.object({
  employee: objectId.optional(),
  category: z.enum(DOCUMENT_CATEGORIES),
  name: z.string().min(2).max(200),
  description: z.string().max(1000).optional(),
  fileUrl: z.string().min(1).max(500),
  fileName: z.string().max(300).optional(),
  fileType: z.string().max(120).optional(),
  fileSize: z.coerce.number().optional(),
  issueDate: date.optional(),
  expiryDate: date.optional(),
});

export const updateDocumentSchema = createDocumentSchema.partial();

/* ------------------------------ Disciplinary ----------------------------- */

export const createCaseSchema = z.object({
  employee: objectId,
  incidentDate: date,
  reportedBy: objectId.optional(),
  category: z.enum(DISCIPLINARY_CATEGORIES),
  severity: z.enum(["minor", "major", "gross"]).optional(),
  description: z.string().min(10).max(6000),
  evidenceUrls: z.array(z.string().max(500)).max(20).optional(),
});

export const updateCaseSchema = z.object({
  incidentDate: date.optional(),
  category: z.enum(DISCIPLINARY_CATEGORIES).optional(),
  severity: z.enum(["minor", "major", "gross"]).optional(),
  description: z.string().min(10).max(6000).optional(),
  evidenceUrls: z.array(z.string().max(500)).max(20).optional(),
  reportedBy: objectId.optional(),
});

export const issueQuerySchema = z.object({
  content: z.string().min(10).max(6000),
  responseDueDate: date.optional(),
});

export const caseResponseSchema = z.object({
  text: z.string().min(1).max(6000),
  documentUrl: z.string().max(500).optional(),
});

export const hearingSchema = z.object({
  scheduledFor: date,
  panel: z.array(z.string().max(120)).max(10).optional(),
  location: z.string().max(200).optional(),
});

export const hearingRecordSchema = z.object({ notes: z.string().min(1).max(6000) });

export const outcomeSchema = z.object({
  decision: z.enum(DISCIPLINARY_OUTCOMES),
  details: z.string().max(4000).optional(),
  effectiveDate: date.optional(),
  sanctionEndDate: date.optional(),
});

export const noteSchema = z.object({ note: z.string().min(1).max(2000) });

export default {
  kpiSchema,
  createReviewSchema,
  updateReviewSchema,
  reviewActionSchema,
  createTargetSchema,
  updateTargetSchema,
  progressSchema,
  createJobSchema,
  updateJobSchema,
  addApplicantSchema,
  moveStageSchema,
  updateApplicantSchema,
  interviewSchema,
  interviewFeedbackSchema,
  convertApplicantSchema,
  createDocumentSchema,
  updateDocumentSchema,
  createCaseSchema,
  updateCaseSchema,
  issueQuerySchema,
  caseResponseSchema,
  hearingSchema,
  hearingRecordSchema,
  outcomeSchema,
  noteSchema,
};
