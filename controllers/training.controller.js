import * as service from "../services/training.service.js";
import { catchAsync } from "../utils/catchAsync.js";
import { recordAudit } from "../services/audit.service.js";

export const list = catchAsync(async (req, res) => {
  res.json({ data: await service.listTrainings(req.orgId, req.query) });
});
export const create = catchAsync(async (req, res) => {
  const t = await service.createTraining(req.orgId, req.auth.userId, req.body);
  await recordAudit(req, { action: "training.create", entityType: "Training", entityId: t._id, entityLabel: t.name, summary: `Created training "${t.name}"` });
  res.status(201).json({ data: t });
});
export const update = catchAsync(async (req, res) => {
  res.json({ data: await service.updateTraining(req.orgId, req.params.id, req.body) });
});
export const setActive = catchAsync(async (req, res) => {
  res.json({ data: await service.setTrainingActive(req.orgId, req.params.id, req.body.active) });
});
export const remove = catchAsync(async (req, res) => {
  await service.deleteTraining(req.orgId, req.params.id);
  await recordAudit(req, { action: "training.delete", entityType: "Training", entityId: req.params.id, summary: "Deleted a training" });
  res.json({ data: { ok: true } });
});

export const listAttendance = catchAsync(async (req, res) => {
  res.json({ data: await service.listAttendance(req.orgId, req.query) });
});
export const listOwnAttendance = catchAsync(async (req, res) => {
  res.json({ data: await service.listOwnAttendance(req.orgId, req.auth) });
});
export const recordAttendance = catchAsync(async (req, res) => {
  const rec = await service.recordAttendance(req.orgId, req.auth.userId, req.body);
  await recordAudit(req, { action: "training.attendance", entityType: "TrainingAttendance", entityId: rec._id, summary: `Recorded training attendance: ${rec.trainingName}` });
  res.status(201).json({ data: rec });
});
export const deleteAttendance = catchAsync(async (req, res) => {
  await service.deleteAttendance(req.orgId, req.params.id);
  await recordAudit(req, { action: "training.attendance_delete", entityType: "TrainingAttendance", entityId: req.params.id, summary: "Removed a training attendance record" });
  res.json({ data: { ok: true } });
});

export default { list, create, update, setActive, remove, listAttendance, listOwnAttendance, recordAttendance, deleteAttendance };
