import { Training } from "../models/hrm/Training.js";
import { TrainingAttendance } from "../models/hrm/TrainingAttendance.js";
import { Employee } from "../models/hrm/Employee.js";
import { AppError } from "../utils/AppError.js";
import { escapeRegex } from "../utils/query.js";

/* ------------------------------- catalog ------------------------------- */

export async function listTrainings(orgId, query = {}) {
  const filter = { organizationId: orgId };
  if (query.active === "true") filter.active = true;
  if (query.active === "false") filter.active = false;
  if (query.category) filter.category = query.category;
  if (query.search) filter.name = new RegExp(escapeRegex(query.search), "i");
  return Training.find(filter).sort({ name: 1 });
}

export async function createTraining(orgId, actorUserId, input) {
  const dup = await Training.findOne({ organizationId: orgId, name: input.name });
  if (dup) throw AppError.conflict("A training with that name already exists for this organization");
  return Training.create({ ...input, organizationId: orgId, createdBy: actorUserId });
}

export async function updateTraining(orgId, id, input) {
  const t = await Training.findOneAndUpdate({ _id: id, organizationId: orgId }, { $set: input }, { new: true, runValidators: true });
  if (!t) throw AppError.notFound("Training not found");
  return t;
}

export async function setTrainingActive(orgId, id, active) {
  const t = await Training.findOneAndUpdate({ _id: id, organizationId: orgId }, { $set: { active } }, { new: true });
  if (!t) throw AppError.notFound("Training not found");
  return t;
}

/** Hard-delete a catalog training. Blocked if any attendance record references it, to protect history. */
export async function deleteTraining(orgId, id) {
  const used = await TrainingAttendance.countDocuments({ organizationId: orgId, training: id });
  if (used > 0) {
    throw AppError.badRequest(`Cannot delete — ${used} attendance record(s) reference this training. Deactivate it instead.`);
  }
  const t = await Training.findOneAndDelete({ _id: id, organizationId: orgId });
  if (!t) throw AppError.notFound("Training not found");
  return { ok: true };
}

/* ------------------------------ attendance ------------------------------ */

export async function listAttendance(orgId, query = {}) {
  const filter = { organizationId: orgId };
  if (query.employee) filter.employee = query.employee;
  return TrainingAttendance.find(filter).sort({ dateAttended: -1 }).populate("training", "name category");
}

/** For the caller's own employee record — the "Trainings attended" tab, self-view. */
export async function listOwnAttendance(orgId, actor) {
  const employee = await Employee.findOne({ organizationId: orgId, user: actor.userId }).select("_id");
  if (!employee) return [];
  return listAttendance(orgId, { employee: employee._id });
}

export async function recordAttendance(orgId, actorUserId, input) {
  const [employeeOk, training] = await Promise.all([
    Employee.exists({ _id: input.employee, organizationId: orgId }),
    Training.findOne({ _id: input.training, organizationId: orgId }),
  ]);
  if (!employeeOk) throw AppError.badRequest("Unknown employee");
  if (!training) throw AppError.badRequest("Unknown training");

  return TrainingAttendance.create({
    organizationId: orgId,
    employee: input.employee,
    training: training._id,
    trainingName: training.name,
    dateAttended: input.dateAttended,
    certificateUrl: input.certificateUrl,
    notes: input.notes,
    recordedBy: actorUserId,
  });
}

export async function deleteAttendance(orgId, id) {
  const rec = await TrainingAttendance.findOneAndDelete({ _id: id, organizationId: orgId });
  if (!rec) throw AppError.notFound("Attendance record not found");
  return { ok: true };
}

export default {
  listTrainings,
  createTraining,
  updateTraining,
  setTrainingActive,
  deleteTraining,
  listAttendance,
  listOwnAttendance,
  recordAttendance,
  deleteAttendance,
};
