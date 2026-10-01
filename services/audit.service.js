import { AuditLog } from "../models/hrm/AuditLog.js";
import { logger } from "../utils/logger.js";
import { parsePagination, paginated, escapeRegex } from "../utils/query.js";

/**
 * Write an audit entry. Never throws into the caller — a failed audit write is
 * logged but must not break the underlying business action.
 *
 *   await recordAudit(req, { action: "employee.create", entityType: "Employee",
 *     entityId: emp._id, entityLabel: emp.fullName, summary: "Created employee" });
 */
export async function recordAudit(req, entry) {
  try {
    await AuditLog.create({
      organizationId: entry.organizationId || req?.orgId || req?.auth?.organizationId,
      actor: req?.auth?.userId,
      actorName: req?.auth?.name,
      actorRole: req?.auth?.role,
      ip: req?.ip,
      userAgent: req?.get?.("user-agent"),
      ...entry,
    });
  } catch (err) {
    logger.error("audit write failed:", err.message);
  }
}

/** Build a { field: { from, to } } diff for changed fields only. */
export function diff(before = {}, after = {}, fields) {
  const keys = fields || [...new Set([...Object.keys(before), ...Object.keys(after)])];
  const changes = {};
  for (const key of keys) {
    const a = before[key];
    const b = after[key];
    if (JSON.stringify(a) !== JSON.stringify(b)) changes[key] = { from: a ?? null, to: b ?? null };
  }
  return Object.keys(changes).length ? changes : undefined;
}

/** Paginated, filtered audit trail for the active organization. */
export async function listAudit(orgId, query = {}) {
  const { page, limit, skip } = parsePagination(query);
  const filter = { organizationId: orgId };

  if (query.action) filter.action = new RegExp(`^${escapeRegex(query.action)}`);
  if (query.entityType) filter.entityType = query.entityType;
  if (query.entityId) filter.entityId = query.entityId;
  if (query.actor) filter.actor = query.actor;
  if (query.from || query.to) {
    filter.createdAt = {};
    if (query.from) filter.createdAt.$gte = new Date(query.from);
    if (query.to) filter.createdAt.$lte = new Date(`${query.to}T23:59:59.999Z`);
  }
  if (query.search) {
    const rx = new RegExp(escapeRegex(query.search), "i");
    filter.$or = [{ summary: rx }, { entityLabel: rx }, { actorName: rx }, { action: rx }];
  }

  const [items, total] = await Promise.all([
    AuditLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    AuditLog.countDocuments(filter),
  ]);
  return paginated(items, total, { page, limit });
}

/** Distinct action prefixes + entity types, for filter dropdowns. */
export async function auditFacets(orgId) {
  const [actions, entityTypes] = await Promise.all([
    AuditLog.distinct("action", { organizationId: orgId }),
    AuditLog.distinct("entityType", { organizationId: orgId }),
  ]);
  const modules = [...new Set(actions.map((a) => a.split(".")[0]))].sort();
  return { modules, entityTypes: entityTypes.filter(Boolean).sort() };
}

export default { recordAudit, diff, listAudit, auditFacets };
