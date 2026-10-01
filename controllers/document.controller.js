import * as service from "../services/document.service.js";
import { catchAsync } from "../utils/catchAsync.js";
import { recordAudit } from "../services/audit.service.js";

export const summary = catchAsync(async (req, res) => {
  res.json({ data: await service.expirySummary(req.orgId, req.auth) });
});
export const list = catchAsync(async (req, res) => {
  res.json(await service.listDocuments(req.orgId, req.query, req.auth));
});
export const get = catchAsync(async (req, res) => {
  res.json({ data: await service.getDocument(req.orgId, req.params.id, req.auth) });
});
export const create = catchAsync(async (req, res) => {
  const doc = await service.createDocument(req.orgId, req.auth, req.body);
  await recordAudit(req, {
    action: "document.create",
    entityType: "HrDocument",
    entityId: doc._id,
    entityLabel: doc.name,
    summary: `Uploaded document "${doc.name}"`,
  });
  res.status(201).json({ data: doc });
});
export const createOwn = catchAsync(async (req, res) => {
  const doc = await service.createOwnDocument(req.orgId, req.auth, req.body);
  await recordAudit(req, {
    action: "document.create",
    entityType: "HrDocument",
    entityId: doc._id,
    entityLabel: doc.name,
    summary: `Uploaded own document "${doc.name}"`,
  });
  res.status(201).json({ data: doc });
});
export const update = catchAsync(async (req, res) => {
  const doc = await service.updateDocument(req.orgId, req.params.id, req.body);
  await recordAudit(req, { action: "document.update", entityType: "HrDocument", entityId: doc._id, entityLabel: doc.name, summary: `Updated document "${doc.name}"` });
  res.json({ data: doc });
});
export const archive = catchAsync(async (req, res) => {
  const doc = await service.archiveDocument(req.orgId, req.params.id);
  await recordAudit(req, { action: "document.archive", entityType: "HrDocument", entityId: doc._id, entityLabel: doc.name, summary: `Archived document "${doc.name}"` });
  res.json({ data: doc });
});
export const remove = catchAsync(async (req, res) => {
  await service.deleteDocument(req.orgId, req.params.id);
  await recordAudit(req, { action: "document.delete", entityType: "HrDocument", entityId: req.params.id, summary: "Deleted a document" });
  res.json({ data: { ok: true } });
});

export default { summary, list, get, create, createOwn, update, archive, remove };
