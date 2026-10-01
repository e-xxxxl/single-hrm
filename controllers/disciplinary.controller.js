import * as service from "../services/disciplinary.service.js";
import { catchAsync } from "../utils/catchAsync.js";
import { recordAudit } from "../services/audit.service.js";

/** Every disciplinary read is audit-logged — these records are sensitive. */
const auditRead = (req, record, action) =>
  recordAudit(req, {
    action,
    entityType: "DisciplinaryCase",
    entityId: record._id ?? record.id ?? req.params.id,
    entityLabel: record.reference,
    summary: `${action} disciplinary case ${record.reference || req.params.id}`,
  });

export const list = catchAsync(async (req, res) => {
  const result = await service.listCases(req.orgId, req.query);
  await recordAudit(req, { action: "disciplinary.list", summary: "Viewed disciplinary case list" });
  res.json(result);
});

export const get = catchAsync(async (req, res) => {
  const record = await service.getCase(req.orgId, req.params.id);
  await auditRead(req, record, "disciplinary.view");
  res.json({ data: record });
});

export const create = catchAsync(async (req, res) => {
  const record = await service.createCase(req.orgId, req.auth, req.body);
  await auditRead(req, record, "disciplinary.create");
  res.status(201).json({ data: record });
});

export const update = catchAsync(async (req, res) => {
  const record = await service.updateCase(req.orgId, req.params.id, req.body);
  await auditRead(req, record, "disciplinary.update");
  res.json({ data: record });
});

export const issueQuery = catchAsync(async (req, res) => {
  const record = await service.issueQuery(req.orgId, req.auth, req.params.id, req.body);
  await auditRead(req, record, "disciplinary.issue_query");
  res.json({ data: record });
});

export const queryLetter = catchAsync(async (req, res) => {
  const text = await service.renderQueryLetter(req.orgId, req.params.id);
  await recordAudit(req, { action: "disciplinary.query_letter", entityType: "DisciplinaryCase", entityId: req.params.id, summary: "Generated query letter" });
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="query-letter-${req.params.id}.txt"`);
  res.send(text);
});

export const recordResponse = catchAsync(async (req, res) => {
  const record = await service.recordResponse(req.orgId, req.params.id, req.body);
  await auditRead(req, record, "disciplinary.record_response");
  res.json({ data: record });
});

export const scheduleHearing = catchAsync(async (req, res) => {
  const record = await service.scheduleHearing(req.orgId, req.params.id, req.body);
  await auditRead(req, record, "disciplinary.schedule_hearing");
  res.json({ data: record });
});

export const recordHearing = catchAsync(async (req, res) => {
  const record = await service.recordHearing(req.orgId, req.params.id, req.body);
  await auditRead(req, record, "disciplinary.record_hearing");
  res.json({ data: record });
});

export const recordOutcome = catchAsync(async (req, res) => {
  const record = await service.recordOutcome(req.orgId, req.auth, req.params.id, req.body);
  await auditRead(req, record, "disciplinary.record_outcome");
  res.json({ data: record });
});

export const addNote = catchAsync(async (req, res) => {
  const record = await service.addNote(req.orgId, req.auth, req.params.id, req.body.note);
  res.json({ data: record });
});

export const remove = catchAsync(async (req, res) => {
  await service.deleteCase(req.orgId, req.params.id);
  await recordAudit(req, {
    action: "disciplinary.delete",
    entityType: "DisciplinaryCase",
    entityId: req.params.id,
    summary: `Deleted disciplinary case ${req.params.id}`,
  });
  res.json({ data: { ok: true } });
});

export default {
  list,
  get,
  create,
  update,
  issueQuery,
  queryLetter,
  recordResponse,
  scheduleHearing,
  recordHearing,
  recordOutcome,
  addNote,
  remove,
};
