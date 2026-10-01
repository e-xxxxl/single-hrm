import mongoose from "mongoose";
import { HrDocument } from "../models/hrm/HrDocument.js";
import { Employee } from "../models/hrm/Employee.js";
import { AppError } from "../utils/AppError.js";
import { parsePagination, paginated, escapeRegex } from "../utils/query.js";
import { deleteFile } from "./file.service.js";
import { hasPermission } from "../utils/permissions.js";

const oid = (id) => new mongoose.Types.ObjectId(String(id));

/**
 * `document:read` alone (held by self-service roles like Staff/Rider) only
 * proves you may see your own file cabinet, not everyone's. Only
 * `document:write` (admin/HR tier) or the wildcard sees the whole org.
 * Returns the caller's own employee id, or `null` if they're privileged
 * (no scoping needed) or have no linked employee record (scoped to nothing).
 */
async function ownScopeFor(orgId, actor) {
  if (!actor || hasPermission(actor.permissions, "document:write")) {
    return null;
  }
  const employee = await Employee.findOne({ organizationId: orgId, user: actor.userId }).select("_id");
  return employee ? employee._id : false;
}

export async function listDocuments(orgId, query = {}, actor) {
  const { page, limit, skip } = parsePagination(query);
  const filter = { organizationId: orgId };
  if (query.employee) filter.employee = query.employee;
  if (query.orgLevel === "true") filter.employee = null;
  if (query.category) filter.category = query.category;
  if (query.status) filter.status = query.status;
  if (query.expiringWithinDays) {
    const n = Number(query.expiringWithinDays);
    filter.expiryDate = { $gte: new Date(), $lte: new Date(Date.now() + n * 86400000) };
  }
  if (query.search) filter.name = new RegExp(escapeRegex(query.search), "i");

  const ownId = await ownScopeFor(orgId, actor);
  if (ownId === false) return paginated([], 0, { page, limit });
  if (ownId) {
    // Self-service viewer — restrict to their own documents plus org-level
    // ones (e.g. a handbook), regardless of what `employee`/`orgLevel` the
    // query string asked for.
    delete filter.employee;
    filter.$or = [{ employee: ownId }, { employee: null }];
  }

  const [items, total] = await Promise.all([
    HrDocument.find(filter)
      .sort({ expiryDate: 1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("employee", "firstName lastName employeeId"),
    HrDocument.countDocuments(filter),
  ]);
  return paginated(items, total, { page, limit });
}

export async function getDocument(orgId, id, actor) {
  const doc = await HrDocument.findOne({ _id: id, organizationId: orgId }).populate(
    "employee",
    "firstName lastName employeeId",
  );
  if (!doc) throw AppError.notFound("Document not found");

  const ownId = await ownScopeFor(orgId, actor);
  if (ownId !== null) {
    const allowed = !doc.employee || (ownId && String(doc.employee._id || doc.employee) === String(ownId));
    if (!allowed) throw AppError.notFound("Document not found");
  }
  return doc;
}

export async function createDocument(orgId, actor, input) {
  if (input.employee) {
    const ok = await Employee.exists({ _id: input.employee, organizationId: orgId });
    if (!ok) throw AppError.badRequest("Unknown employee");
  }
  const doc = new HrDocument({ ...input, organizationId: orgId, uploadedBy: actor.userId });
  doc.refreshStatus();
  await doc.save();
  return doc;
}

/**
 * Self-service upload for an employee without `document:write` — the
 * `employee` link is always forced to the caller's own record, never taken
 * from the request body, so they can't file a document against anyone else.
 */
export async function createOwnDocument(orgId, actor, input) {
  const employee = await Employee.findOne({ organizationId: orgId, user: actor.userId });
  if (!employee) {
    throw AppError.badRequest("Your account is not linked to an employee record in this organization");
  }
  const doc = new HrDocument({
    ...input,
    employee: employee._id,
    organizationId: orgId,
    uploadedBy: actor.userId,
  });
  doc.refreshStatus();
  await doc.save();
  return doc;
}

export async function updateDocument(orgId, id, input) {
  const doc = await HrDocument.findOne({ _id: id, organizationId: orgId });
  if (!doc) throw AppError.notFound("Document not found");
  const fields = ["name", "description", "category", "issueDate", "expiryDate", "fileUrl", "fileName", "fileType", "fileSize"];
  for (const f of fields) if (input[f] !== undefined) doc[f] = input[f];
  if (input.expiryDate !== undefined) doc.alertsSent = [];
  doc.refreshStatus();
  await doc.save();
  return doc;
}

export async function archiveDocument(orgId, id) {
  const doc = await HrDocument.findOneAndUpdate(
    { _id: id, organizationId: orgId },
    { $set: { status: "archived", archivedAt: new Date() } },
    { new: true },
  );
  if (!doc) throw AppError.notFound("Document not found");
  return doc;
}

export async function deleteDocument(orgId, id) {
  const doc = await HrDocument.findOne({ _id: id, organizationId: orgId });
  if (!doc) throw AppError.notFound("Document not found");
  // If the file URL is a managed upload, remove the bytes too.
  const m = /\/hrm\/files\/([a-f\d]{24})/i.exec(doc.fileUrl || "");
  if (m) await deleteFile(orgId, m[1]);
  await doc.deleteOne();
  return { ok: true };
}

export async function expirySummary(orgId, actor) {
  const oidOrg = oid(orgId);
  const now = new Date();
  const ownId = await ownScopeFor(orgId, actor);
  const scopeMatch =
    ownId === false
      ? { _id: null } // no linked employee record — match nothing
      : ownId
        ? { $or: [{ employee: ownId }, { employee: null }] }
        : {};
  const rows = await HrDocument.aggregate([
    { $match: { organizationId: oidOrg, status: { $ne: "archived" }, expiryDate: { $ne: null }, ...scopeMatch } },
    {
      $project: {
        bucket: {
          $switch: {
            branches: [
              { case: { $lt: ["$expiryDate", now] }, then: "expired" },
              { case: { $lte: ["$expiryDate", new Date(now.getTime() + 7 * 86400000)] }, then: "7" },
              { case: { $lte: ["$expiryDate", new Date(now.getTime() + 14 * 86400000)] }, then: "14" },
              { case: { $lte: ["$expiryDate", new Date(now.getTime() + 30 * 86400000)] }, then: "30" },
            ],
            default: "ok",
          },
        },
      },
    },
    { $group: { _id: "$bucket", n: { $sum: 1 } } },
  ]);
  const counts = Object.fromEntries(rows.map((r) => [r._id, r.n]));
  const upcoming = await HrDocument.find({
    organizationId: orgId,
    status: { $ne: "archived" },
    expiryDate: { $gte: now, $lte: new Date(now.getTime() + 30 * 86400000) },
    ...scopeMatch,
  })
    .sort({ expiryDate: 1 })
    .limit(15)
    .populate("employee", "firstName lastName employeeId")
    .select("name category expiryDate employee status");
  return {
    expired: counts.expired || 0,
    within7: counts["7"] || 0,
    within14: counts["14"] || 0,
    within30: counts["30"] || 0,
    upcoming,
  };
}

export default {
  listDocuments,
  getDocument,
  createDocument,
  createOwnDocument,
  updateDocument,
  archiveDocument,
  deleteDocument,
  expirySummary,
};
