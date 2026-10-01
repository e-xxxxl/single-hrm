import { Employee } from "../models/hrm/Employee.js";
import { AppError } from "../utils/AppError.js";
import { hasPermission } from "../utils/permissions.js";

/**
 * Record-level access inside an organization ("may this user see *this*
 * employee's record?"). Cross-organization access is already impossible by
 * the time these run (every lookup is org-scoped); these close the
 * within-organization gap where a self-service permission such as
 * `leave:read` would otherwise let an employee open a colleague's record by
 * changing an id in the URL.
 *
 * Denials are reported as 404 so an id that exists but isn't yours looks the
 * same as one that doesn't exist.
 */

/** The caller's own employee id in this organization, or null. */
export async function actorEmployeeId(orgId, actor) {
  const me = await Employee.findOne({ organizationId: orgId, user: actor.userId }).select("_id");
  return me ? String(me._id) : null;
}

/**
 * Allow when the caller holds any `oversight` permission, is the employee
 * themselves, or is one of the `related` employees (line manager, reviewer…).
 */
export async function assertEmployeeRecordAccess(orgId, actor, employeeId, { oversight = [], related = [] } = {}) {
  if (oversight.some((p) => hasPermission(actor.permissions, p))) return;
  const me = await actorEmployeeId(orgId, actor);
  // Accept raw ids, populated documents or toJSON() output (`id` instead of `_id`).
  const allowed = [employeeId, ...related].filter(Boolean).map((x) => String(x?._id ?? x?.id ?? x));
  if (me && allowed.includes(me)) return;
  throw AppError.notFound();
}

export default { actorEmployeeId, assertEmployeeRecordAccess };
