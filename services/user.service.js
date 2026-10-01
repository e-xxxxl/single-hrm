import { User } from "../models/hrm/User.js";
import { Employee } from "../models/hrm/Employee.js";
import { AppError } from "../utils/AppError.js";
import { parsePagination, parseSort, paginated, escapeRegex } from "../utils/query.js";
import {
  ORG_ROLES,
  ORG_ADMIN_ROLE,
  ORG_PERMISSIONS,
  ROLE_PERMISSIONS,
  assignableRoles,
  resolvePermissions,
  roleRank,
} from "../utils/permissions.js";
import {
  assertCanAssignRole,
  assertKeepsAnOrgAdmin,
  createAccount,
  resetAccountPassword,
  setAccountStatus,
} from "./account.service.js";
import { invalidateUserState } from "./authState.service.js";

/**
 * Organization user management — every login inside the caller's
 * organization, whether or not it is linked to an employee record (an Org
 * Admin created by the Platform Admin, for example, may not be). Every lookup
 * is by `{ _id, organizationId }`, so an id from another organization is
 * simply "not found".
 */

const SORTABLE = ["name", "email", "role", "status", "lastLoginAt", "createdAt"];

async function findInOrg(orgId, id) {
  const user = await User.findOne({ _id: id, organizationId: orgId }).populate(
    "employee",
    "firstName lastName employeeId position",
  );
  if (!user) throw AppError.notFound("User not found");
  return user;
}

/** An actor may only manage users ranked below them — an Org Admin may manage anyone. */
function assertCanManage(actor, target) {
  if (String(actor.userId) === String(target._id)) {
    throw AppError.forbidden("You cannot change your own role, status or permissions");
  }
  if (actor.role !== ORG_ADMIN_ROLE && roleRank(target.role) <= roleRank(actor.role)) {
    throw AppError.forbidden(`Your role (${actor.role}) cannot manage a ${target.role}`);
  }
}

export async function listUsers(orgId, query = {}) {
  const { page, limit, skip } = parsePagination(query);
  const sort = parseSort(query.sort, SORTABLE, { name: 1 });
  const filter = { organizationId: orgId };
  if (query.role && ORG_ROLES.includes(query.role)) filter.role = query.role;
  if (query.status === "active" || query.status === "suspended") filter.status = query.status;
  if (query.search) {
    const rx = new RegExp(escapeRegex(query.search), "i");
    filter.$or = [{ name: rx }, { email: rx }];
  }
  const [items, total] = await Promise.all([
    User.find(filter)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .populate("employee", "firstName lastName employeeId position"),
    User.countDocuments(filter),
  ]);
  return paginated(items, total, { page, limit });
}

export async function getUser(orgId, id) {
  const user = await findInOrg(orgId, id);
  return {
    user,
    effectivePermissions: resolvePermissions(user.role, {
      grant: user.permissionsGrant,
      revoke: user.permissionsRevoke,
    }),
  };
}

export async function createUser(orgId, actor, input) {
  assertCanAssignRole(actor.role, input.role);

  let employee = null;
  if (input.employee) {
    employee = await Employee.findOne({ _id: input.employee, organizationId: orgId });
    if (!employee) throw AppError.badRequest("Unknown employee for this organization");
    if (employee.user) throw AppError.conflict("That employee already has a login");
  }

  const { user, tempPassword } = await createAccount({
    organizationId: orgId,
    name: input.name,
    email: input.email,
    phone: input.phone,
    role: input.role,
    password: input.password,
    employee: employee?._id,
    createdBy: actor.userId,
  });
  if (employee) {
    employee.user = user._id;
    await employee.save();
  }
  return { user, tempPassword: input.password ? null : tempPassword };
}

export async function updateUser(orgId, actor, id, input) {
  const user = await findInOrg(orgId, id);
  assertCanManage(actor, user);

  if (input.role !== undefined && input.role !== user.role) assertCanAssignRole(actor.role, input.role);
  await assertKeepsAnOrgAdmin(user, { role: input.role, status: input.status });

  if (input.permissionsGrant !== undefined || input.permissionsRevoke !== undefined) {
    if (actor.role !== ORG_ADMIN_ROLE) {
      throw AppError.forbidden("Only an Org Admin can change per-user permission overrides");
    }
    const unknown = [...(input.permissionsGrant || []), ...(input.permissionsRevoke || [])].filter(
      (p) => !ORG_PERMISSIONS.includes(p),
    );
    if (unknown.length) throw AppError.badRequest(`Unknown permission(s): ${unknown.join(", ")}`);
    if (input.permissionsGrant !== undefined) user.permissionsGrant = [...new Set(input.permissionsGrant)];
    if (input.permissionsRevoke !== undefined) user.permissionsRevoke = [...new Set(input.permissionsRevoke)];
  }

  if (input.role !== undefined) user.role = input.role;
  if (input.name !== undefined) user.name = input.name;
  if (input.phone !== undefined) user.phone = input.phone;
  await user.save();
  invalidateUserState(user._id);

  if (input.status !== undefined && input.status !== user.status) {
    await setAccountStatus(user, input.status);
  }
  return getUser(orgId, id);
}

export async function resetPassword(orgId, actor, id, password) {
  const user = await findInOrg(orgId, id);
  assertCanManage(actor, user);
  const { tempPassword } = await resetAccountPassword(user._id, password);
  return { tempPassword: password ? null : tempPassword, user };
}

/** The role catalogue for the Users & Roles screen. */
export function rolesCatalogue(actorRole) {
  return {
    roles: ORG_ROLES.map((role) => ({ role, permissions: ROLE_PERMISSIONS[role] })),
    assignable: assignableRoles(actorRole),
    permissions: ORG_PERMISSIONS,
  };
}

export default { listUsers, getUser, createUser, updateUser, resetPassword, rolesCatalogue };
