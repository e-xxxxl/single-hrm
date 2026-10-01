import mongoose from "mongoose";
import { JobPosting } from "../models/hrm/JobPosting.js";
import { Applicant, APPLICANT_STAGES, ACTIVE_STAGES } from "../models/hrm/Applicant.js";
import { Employee } from "../models/hrm/Employee.js";
import { nextCode } from "../models/hrm/Counter.js";
import { AppError } from "../utils/AppError.js";
import { parsePagination, paginated, escapeRegex } from "../utils/query.js";

const oid = (id) => new mongoose.Types.ObjectId(String(id));

/* ------------------------------ Job postings ----------------------------- */

export async function listJobs(orgId, query = {}) {
  const { page, limit, skip } = parsePagination(query);
  const filter = { organizationId: orgId };
  if (query.status) filter.status = query.status;
  if (query.department) filter.department = query.department;
  if (query.search) filter.title = new RegExp(escapeRegex(query.search), "i");

  const [items, total] = await Promise.all([
    JobPosting.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("department", "name")
      .populate("branch", "name")
      .populate("hiringManager", "firstName lastName"),
    JobPosting.countDocuments(filter),
  ]);

  const counts = await Applicant.aggregate([
    { $match: { organizationId: oid(orgId), jobPosting: { $in: items.map((j) => j._id) } } },
    { $group: { _id: "$jobPosting", total: { $sum: 1 }, active: { $sum: { $cond: [{ $in: ["$stage", ACTIVE_STAGES] }, 1, 0] } } } },
  ]);
  const map = new Map(counts.map((c) => [String(c._id), c]));
  const rows = items.map((j) => ({
    ...j.toJSON(),
    applicantCount: map.get(String(j._id))?.total || 0,
    activeApplicants: map.get(String(j._id))?.active || 0,
  }));
  return paginated(rows, total, { page, limit });
}

export async function getJob(orgId, id) {
  const job = await JobPosting.findOne({ _id: id, organizationId: orgId })
    .populate("department", "name")
    .populate("branch", "name")
    .populate("hiringManager", "firstName lastName employeeId");
  if (!job) throw AppError.notFound("Job posting not found");
  const stageCounts = await Applicant.aggregate([
    { $match: { organizationId: oid(orgId), jobPosting: oid(id) } },
    { $group: { _id: "$stage", n: { $sum: 1 } } },
  ]);
  return { job, pipeline: Object.fromEntries(stageCounts.map((s) => [s._id, s.n])) };
}

export async function createJob(orgId, actor, input) {
  const reference = await nextCode("JOB", `${orgId}:job`, 4);
  return JobPosting.create({
    ...input,
    organizationId: orgId,
    reference,
    status: input.status || "draft",
    openedAt: input.status === "open" ? new Date() : undefined,
    postedBy: actor.userId,
  });
}

export async function updateJob(orgId, id, input) {
  const job = await JobPosting.findOne({ _id: id, organizationId: orgId });
  if (!job) throw AppError.notFound("Job posting not found");
  const prevStatus = job.status;
  Object.assign(job, input);
  if (prevStatus !== "open" && job.status === "open" && !job.openedAt) job.openedAt = new Date();
  if (job.status === "closed" || job.status === "filled") job.closedAt = job.closedAt || new Date();
  await job.save();
  return job;
}

/* ------------------------------- Applicants ------------------------------ */

export async function pipeline(orgId, jobId) {
  const job = await JobPosting.findOne({ _id: jobId, organizationId: orgId });
  if (!job) throw AppError.notFound("Job posting not found");
  const applicants = await Applicant.find({ organizationId: orgId, jobPosting: jobId })
    .sort({ updatedAt: -1 })
    .populate("assignedRecruiter", "firstName lastName");
  const columns = {};
  for (const stage of APPLICANT_STAGES) columns[stage] = [];
  for (const a of applicants) columns[a.stage].push(a.toJSON());
  return { job, columns };
}

export async function listApplicants(orgId, query = {}) {
  const { page, limit, skip } = parsePagination(query);
  const filter = { organizationId: orgId };
  if (query.jobPosting) filter.jobPosting = query.jobPosting;
  if (query.stage) filter.stage = query.stage;
  if (query.search) {
    const rx = new RegExp(escapeRegex(query.search), "i");
    filter.$or = [{ name: rx }, { email: rx }, { phone: rx }];
  }
  const [items, total] = await Promise.all([
    Applicant.find(filter)
      .sort({ appliedAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("jobPosting", "title reference")
      .populate("assignedRecruiter", "firstName lastName"),
    Applicant.countDocuments(filter),
  ]);
  return paginated(items, total, { page, limit });
}

export async function getApplicant(orgId, id) {
  const applicant = await Applicant.findOne({ _id: id, organizationId: orgId })
    .populate("jobPosting", "title reference department")
    .populate("assignedRecruiter", "firstName lastName employeeId")
    .populate("convertedToEmployee", "firstName lastName employeeId");
  if (!applicant) throw AppError.notFound("Applicant not found");
  return applicant;
}

export async function addApplicant(orgId, actor, input) {
  const job = await JobPosting.findOne({ _id: input.jobPosting, organizationId: orgId });
  if (!job) throw AppError.badRequest("Unknown job posting");
  if (!["open", "draft"].includes(job.status)) {
    throw AppError.badRequest(`Cannot add applicants — the posting is ${job.status}`);
  }
  const dup = await Applicant.findOne({
    organizationId: orgId,
    jobPosting: job._id,
    email: input.email.toLowerCase(),
  });
  if (dup) throw AppError.conflict("An application from that email already exists for this posting");

  return Applicant.create({
    ...input,
    email: input.email.toLowerCase(),
    organizationId: orgId,
    stage: "Applied",
    stageHistory: [{ stage: "Applied", at: new Date(), by: actor.userId, byName: actor.name }],
    appliedAt: new Date(),
  });
}

export async function moveStage(orgId, actor, id, { stage, note, rejectionReason }) {
  if (!APPLICANT_STAGES.includes(stage)) throw AppError.badRequest("Unknown stage");
  const applicant = await Applicant.findOne({ _id: id, organizationId: orgId });
  if (!applicant) throw AppError.notFound("Applicant not found");
  if (applicant.convertedToEmployee) throw AppError.badRequest("This applicant has already been hired");

  applicant.stage = stage;
  if (stage === "Rejected" && rejectionReason) applicant.rejectionReason = rejectionReason;
  applicant.stageHistory.push({ stage, at: new Date(), by: actor.userId, byName: actor.name, note });
  await applicant.save();
  return applicant;
}

export async function updateApplicant(orgId, id, input) {
  const applicant = await Applicant.findOne({ _id: id, organizationId: orgId });
  if (!applicant) throw AppError.notFound("Applicant not found");
  const fields = ["phone", "resumeUrl", "coverLetter", "rating", "assignedRecruiter", "currentEmployer", "expectedSalary", "source"];
  for (const f of fields) if (input[f] !== undefined) applicant[f] = input[f];
  if (input.offer) applicant.offer = { ...applicant.offer?.toObject?.(), ...input.offer };
  await applicant.save();
  return applicant;
}

export async function scheduleInterview(orgId, id, input) {
  const applicant = await Applicant.findOne({ _id: id, organizationId: orgId });
  if (!applicant) throw AppError.notFound("Applicant not found");
  applicant.interviews.push(input);
  if (ACTIVE_STAGES.indexOf(applicant.stage) < ACTIVE_STAGES.indexOf("Interview")) {
    applicant.stage = "Interview";
    applicant.stageHistory.push({ stage: "Interview", at: new Date(), note: "Interview scheduled" });
  }
  await applicant.save();
  return applicant;
}

export async function recordInterviewFeedback(orgId, id, interviewIndex, { feedback, outcome }) {
  const applicant = await Applicant.findOne({ _id: id, organizationId: orgId });
  if (!applicant || !applicant.interviews[interviewIndex]) throw AppError.notFound("Interview not found");
  applicant.interviews[interviewIndex].feedback = feedback;
  if (outcome) applicant.interviews[interviewIndex].outcome = outcome;
  await applicant.save();
  return applicant;
}

export async function addApplicantNote(orgId, actor, id, note) {
  const applicant = await Applicant.findOneAndUpdate(
    { _id: id, organizationId: orgId },
    { $push: { notes: { by: actor.userId, byName: actor.name, note, at: new Date() } } },
    { new: true },
  );
  if (!applicant) throw AppError.notFound("Applicant not found");
  return applicant;
}

/**
 * Convert an accepted applicant into an employee record. Returns the new
 * employee; the caller (controller) provides the extra required employee fields.
 */
export async function convertToEmployee(orgId, actor, id, employeeInput, createEmployeeFn) {
  const applicant = await Applicant.findOne({ _id: id, organizationId: orgId }).populate("jobPosting");
  if (!applicant) throw AppError.notFound("Applicant not found");
  if (applicant.convertedToEmployee) throw AppError.conflict("Already converted to an employee");
  if (applicant.stage !== "Accepted") {
    throw AppError.badRequest("Only an applicant in the Accepted stage can be converted");
  }

  const [firstName, ...rest] = applicant.name.trim().split(/\s+/);
  const { employee } = await createEmployeeFn(
    orgId,
    {
      firstName,
      lastName: rest.join(" ") || firstName,
      email: applicant.email,
      phone: applicant.phone || employeeInput.phone,
      position: applicant.jobPosting?.title || employeeInput.position,
      department: applicant.jobPosting?.department || employeeInput.department,
      branch: applicant.jobPosting?.branch || employeeInput.branch,
      dateJoined: employeeInput.dateJoined || applicant.offer?.startDate || new Date(),
      employmentType: applicant.jobPosting?.employmentType,
      employmentStatus: "Probation",
      ...employeeInput,
    },
    actor,
  );

  applicant.convertedToEmployee = employee._id;
  await applicant.save();

  // Decrement openings / mark filled.
  const job = applicant.jobPosting;
  if (job) {
    const hires = await Applicant.countDocuments({
      organizationId: orgId,
      jobPosting: job._id,
      convertedToEmployee: { $ne: null },
    });
    if (hires >= job.openings) {
      await JobPosting.updateOne({ _id: job._id, organizationId: orgId }, { $set: { status: "filled", closedAt: new Date() } });
    }
  }
  return employee;
}

export async function recruitmentSummary(orgId) {
  const oidOrg = oid(orgId);
  const [jobs, stageCounts] = await Promise.all([
    JobPosting.aggregate([{ $match: { organizationId: oidOrg } }, { $group: { _id: "$status", n: { $sum: 1 } } }]),
    Applicant.aggregate([{ $match: { organizationId: oidOrg } }, { $group: { _id: "$stage", n: { $sum: 1 } } }]),
  ]);
  const stage = Object.fromEntries(stageCounts.map((s) => [s._id, s.n]));
  return {
    jobs: Object.fromEntries(jobs.map((j) => [j._id, j.n])),
    openJobs: jobs.find((j) => j._id === "open")?.n || 0,
    applicantsByStage: stage,
    activeApplicants: ACTIVE_STAGES.reduce((s, k) => s + (stage[k] || 0), 0),
    pendingReview: stage.Applied || 0,
  };
}

/** Delete a job posting. Blocked if it has any applicants, to protect their history. */
export async function deleteJob(orgId, id) {
  const applicants = await Applicant.countDocuments({ organizationId: orgId, jobPosting: id });
  if (applicants > 0) {
    throw AppError.badRequest(`Cannot delete — ${applicants} applicant(s) are attached to this posting. Close or cancel it instead.`);
  }
  const job = await JobPosting.findOneAndDelete({ _id: id, organizationId: orgId });
  if (!job) throw AppError.notFound("Job posting not found");
  return { ok: true };
}

/** Delete an applicant. Blocked once converted to an employee, to protect that record's origin link. */
export async function deleteApplicant(orgId, id) {
  const applicant = await Applicant.findOne({ _id: id, organizationId: orgId });
  if (!applicant) throw AppError.notFound("Applicant not found");
  if (applicant.convertedToEmployee) {
    throw AppError.badRequest("This applicant was already converted to an employee and can no longer be deleted.");
  }
  await applicant.deleteOne();
  return { ok: true };
}

export default {
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
  recordInterviewFeedback,
  addApplicantNote,
  convertToEmployee,
  recruitmentSummary,
};
