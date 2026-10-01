import { Notification } from "../models/hrm/Notification.js";
import { Employee } from "../models/hrm/Employee.js";
import { User } from "../models/hrm/User.js";
import { AppError } from "../utils/AppError.js";
import { parsePagination, paginated } from "../utils/query.js";
import { logger } from "../utils/logger.js";

/**
 * Create an in-app notification. `to` is one of:
 *   { user: <userId> }        — deliver to that user directly
 *   { employee: <employeeId> } — resolve to the employee's linked user
 *   { users: [<userId>, …] }  — fan out
 *   { role: "HR Manager" }    — every active user with that role in this org
 *   { roles: [...] }          — same, for several roles
 * Recipients are always resolved inside `orgId` — a user id from another
 * organization is dropped, never notified.
 * Never throws into the caller — a failed notification must not break the
 * business action that triggered it.
 */
export async function notify(orgId, { to, type = "general", title, body = "", link, metadata }) {
  try {
    const recipients = await resolveRecipients(orgId, to);
    if (recipients.length === 0) return [];
    const docs = await Notification.insertMany(
      recipients.map((r) => ({
        organizationId: orgId,
        recipient: r.user,
        recipientEmployee: r.employee,
        type,
        title,
        body,
        link,
        metadata,
      })),
    );
    return docs;
  } catch (err) {
    logger.error("notify failed:", err.message);
    return [];
  }
}

async function resolveRecipients(orgId, to) {
  if (!to) return [];
  if (to.user || Array.isArray(to.users)) {
    const ids = to.user ? [to.user] : to.users;
    const users = await User.find({ _id: { $in: ids }, organizationId: orgId }).select("_id");
    return users.map((u) => ({ user: u._id }));
  }
  if (to.employee) {
    const emp = await Employee.findOne({ _id: to.employee, organizationId: orgId }).select("user");
    if (emp?.user) return [{ user: emp.user, employee: emp._id }];
    return [];
  }
  if (to.role || Array.isArray(to.roles)) {
    const roles = to.role ? [to.role] : to.roles;
    const users = await User.find({ organizationId: orgId, role: { $in: roles }, status: "active" }).select("_id");
    return users.map((u) => ({ user: u._id }));
  }
  return [];
}

export async function listForUser(orgId, userId, query = {}) {
  const { page, limit, skip } = parsePagination(query);
  const filter = { organizationId: orgId, recipient: userId };
  if (query.unread === "true") filter.read = false;
  if (query.type) filter.type = query.type;

  const [items, total, unread] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Notification.countDocuments(filter),
    Notification.countDocuments({ organizationId: orgId, recipient: userId, read: false }),
  ]);
  return { ...paginated(items, total, { page, limit }), unread };
}

export async function unreadCount(orgId, userId) {
  return Notification.countDocuments({ organizationId: orgId, recipient: userId, read: false });
}

export async function markRead(orgId, userId, id) {
  const n = await Notification.findOneAndUpdate(
    { _id: id, organizationId: orgId, recipient: userId },
    { $set: { read: true, readAt: new Date() } },
    { new: true },
  );
  if (!n) throw AppError.notFound("Notification not found");
  return n;
}

export async function markAllRead(orgId, userId) {
  const result = await Notification.updateMany(
    { organizationId: orgId, recipient: userId, read: false },
    { $set: { read: true, readAt: new Date() } },
  );
  return { updated: result.modifiedCount };
}

export default { notify, listForUser, unreadCount, markRead, markAllRead };
