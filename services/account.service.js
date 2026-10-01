import crypto from "node:crypto";
import { User } from "../models/hrm/User.js";
import { AppError } from "../utils/AppError.js";
import { withoutTenantScope } from "../utils/tenantContext.js";
import { ORG_ROLES, ORG_ADMIN_ROLE, assignableRoles } from "../utils/permissions.js";
import { invalidateUserState } from "./authState.service.js";

/**
 * Account primitives shared by every place that creates or manages a login:
 * employee logins (employee.service), organization user management
 * (user.service) and the Platform Admin's organization-admin management
 * (platform.service). Callers are responsible for having already established
 * that the target user belongs to the organization they are acting in.
 */

export function generateTempPassword() {
  return crypto.randomBytes(9).toString("base64url");
}

/**
 * Login emails are unique across the whole platform (sign-in has no
 * organization picker), so availability has to be checked across every
 * organization — deliberately outside the request's tenant pinning. Only a
 * yes/no leaves this function.
 */
export async function assertEmailAvailable(email, excludeUserId) {
  const filter = { email: String(email).toLowerCase().trim() };
  if (excludeUserId) filter._id = { $ne: excludeUserId };
  // .exec() inside the callback: a Mongoose Query is lazy, and if returned
  // unexecuted it would run later — back inside the tenant context.
  const taken = await withoutTenantScope(() => User.exists(filter).exec());
  if (taken) {
    throw AppError.conflict("That email address is already registered on the platform — use a different one", {
      code: "EMAIL_TAKEN",
    });
  }
}

/** Throw unless `actorRole` may hand out `role` inside its organization. */
export function assertCanAssignRole(actorRole, role) {
  if (!ORG_ROLES.includes(role)) throw AppError.badRequest(`Unknown role "${role}"`);
  if (!assignableRoles(actorRole).includes(role)) {
    throw AppError.forbidden(`Your role (${actorRole}) cannot grant the ${role} role`);
  }
}

/**
 * Throw if applying `next` (a new role and/or status) to `user` would leave its
 * organization without an active Org Admin — nobody would be able to manage
 * users or settings any more.
 */
export async function assertKeepsAnOrgAdmin(user, next = {}) {
  const wasActiveAdmin = user.role === ORG_ADMIN_ROLE && user.status === "active";
  const staysActiveAdmin = (next.role ?? user.role) === ORG_ADMIN_ROLE && (next.status ?? user.status) === "active";
  if (!wasActiveAdmin || staysActiveAdmin) return;
  const others = await User.countDocuments({
    organizationId: user.organizationId,
    role: ORG_ADMIN_ROLE,
    status: "active",
    _id: { $ne: user._id },
  });
  if (others === 0) {
    throw AppError.badRequest("An organization must keep at least one active Org Admin");
  }
}

/** Create a login inside `organizationId`. Returns the one-time temp password when one was generated. */
export async function createAccount({ organizationId, name, email, phone, role, password, employee, createdBy }) {
  await assertEmailAvailable(email);
  const tempPassword = password || generateTempPassword();
  const user = new User({
    organizationId,
    name,
    email: String(email).toLowerCase().trim(),
    phone,
    role,
    employee,
    createdBy,
  });
  await user.setPassword(tempPassword);
  user.mustChangePassword = true;
  await user.save();
  return { user, tempPassword };
}

/** Kill every session and outstanding access token for `user` (caller saves). */
export function revokeAccess(user) {
  user.sessions = [];
  user.tokenVersion = (user.tokenVersion || 0) + 1;
}

/** Set a new temporary password the user must change at next sign-in, and sign them out everywhere. */
export async function resetAccountPassword(userId, password) {
  const user = await User.findById(userId).select("+passwordHash +sessions");
  if (!user) throw AppError.notFound("User not found");
  const tempPassword = password || generateTempPassword();
  await user.setPassword(tempPassword);
  user.mustChangePassword = true;
  revokeAccess(user);
  await user.save();
  invalidateUserState(user._id);
  return { tempPassword };
}

/** Suspend or reactivate a login. Suspension also ends every live session. */
export async function setAccountStatus(user, status) {
  if (user.status === status) return user;
  user.status = status;
  if (status === "suspended") {
    const withSessions = await User.findById(user._id).select("+sessions");
    revokeAccess(withSessions);
    withSessions.status = status;
    await withSessions.save();
    invalidateUserState(user._id);
    return withSessions;
  }
  await user.save();
  invalidateUserState(user._id);
  return user;
}

export default {
  generateTempPassword,
  assertEmailAvailable,
  assertCanAssignRole,
  assertKeepsAnOrgAdmin,
  createAccount,
  revokeAccess,
  resetAccountPassword,
  setAccountStatus,
};
