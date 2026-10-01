import * as service from "../services/recruitment.service.js";
import { createEmployee } from "../services/employee.service.js";
import { catchAsync } from "../utils/catchAsync.js";
import { recordAudit } from "../services/audit.service.js";

export const summary = catchAsync(async (req, res) => {
  res.json({ data: await service.recruitmentSummary(req.orgId) });
});

/* Jobs */
export const listJobs = catchAsync(async (req, res) => {
  res.json(await service.listJobs(req.orgId, req.query));
});
export const getJob = catchAsync(async (req, res) => {
  res.json({ data: await service.getJob(req.orgId, req.params.id) });
});
export const createJob = catchAsync(async (req, res) => {
  const job = await service.createJob(req.orgId, req.auth, req.body);
  await recordAudit(req, { action: "job.create", entityType: "JobPosting", entityId: job._id, entityLabel: job.reference, summary: `Created job posting "${job.title}"` });
  res.status(201).json({ data: job });
});
export const updateJob = catchAsync(async (req, res) => {
  const job = await service.updateJob(req.orgId, req.params.id, req.body);
  await recordAudit(req, { action: "job.update", entityType: "JobPosting", entityId: job._id, entityLabel: job.reference, summary: `Updated job posting "${job.title}" (${job.status})` });
  res.json({ data: job });
});
export const deleteJob = catchAsync(async (req, res) => {
  await service.deleteJob(req.orgId, req.params.id);
  await recordAudit(req, { action: "job.delete", entityType: "JobPosting", entityId: req.params.id, summary: "Deleted a job posting" });
  res.json({ data: { ok: true } });
});

/* Applicants */
export const pipeline = catchAsync(async (req, res) => {
  res.json({ data: await service.pipeline(req.orgId, req.params.jobId) });
});
export const listApplicants = catchAsync(async (req, res) => {
  res.json(await service.listApplicants(req.orgId, req.query));
});
export const getApplicant = catchAsync(async (req, res) => {
  res.json({ data: await service.getApplicant(req.orgId, req.params.id) });
});
export const addApplicant = catchAsync(async (req, res) => {
  const applicant = await service.addApplicant(req.orgId, req.auth, req.body);
  await recordAudit(req, { action: "applicant.create", entityType: "Applicant", entityId: applicant._id, entityLabel: applicant.name, summary: `Added applicant ${applicant.name}` });
  res.status(201).json({ data: applicant });
});
export const moveStage = catchAsync(async (req, res) => {
  const applicant = await service.moveStage(req.orgId, req.auth, req.params.id, req.body);
  await recordAudit(req, { action: "applicant.move_stage", entityType: "Applicant", entityId: applicant._id, entityLabel: applicant.name, summary: `${applicant.name} → ${applicant.stage}` });
  res.json({ data: applicant });
});
export const updateApplicant = catchAsync(async (req, res) => {
  res.json({ data: await service.updateApplicant(req.orgId, req.params.id, req.body) });
});
export const scheduleInterview = catchAsync(async (req, res) => {
  res.json({ data: await service.scheduleInterview(req.orgId, req.params.id, req.body) });
});
export const interviewFeedback = catchAsync(async (req, res) => {
  res.json({
    data: await service.recordInterviewFeedback(req.orgId, req.params.id, Number(req.params.index), req.body),
  });
});
export const addApplicantNote = catchAsync(async (req, res) => {
  res.json({ data: await service.addApplicantNote(req.orgId, req.auth, req.params.id, req.body.note) });
});
export const convert = catchAsync(async (req, res) => {
  const employee = await service.convertToEmployee(req.orgId, req.auth, req.params.id, req.body, createEmployee);
  await recordAudit(req, {
    action: "applicant.convert",
    entityType: "Employee",
    entityId: employee._id,
    entityLabel: employee.fullName,
    summary: `Hired applicant → employee ${employee.employeeId}`,
  });
  res.status(201).json({ data: employee });
});

export const deleteApplicant = catchAsync(async (req, res) => {
  await service.deleteApplicant(req.orgId, req.params.id);
  await recordAudit(req, { action: "applicant.delete", entityType: "Applicant", entityId: req.params.id, summary: "Deleted an applicant" });
  res.json({ data: { ok: true } });
});

export default {
  summary,
  listJobs,
  getJob,
  createJob,
  updateJob,
  deleteJob,
  pipeline,
  listApplicants,
  getApplicant,
  addApplicant,
  moveStage,
  updateApplicant,
  deleteApplicant,
  scheduleInterview,
  interviewFeedback,
  addApplicantNote,
  convert,
};
