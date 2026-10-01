import mongoose from "mongoose";
import { Organization } from "../models/hrm/Organization.js";
import { User } from "../models/hrm/User.js";
import { Employee } from "../models/hrm/Employee.js";
import { Department } from "../models/hrm/Department.js";
import { Branch } from "../models/hrm/Branch.js";
import { AuditLog } from "../models/hrm/AuditLog.js";
import { getPlatformSettings } from "../models/hrm/PlatformSetting.js";
import { AppError } from "../utils/AppError.js";
import { parsePagination, parseSort, paginated, escapeRegex } from "../utils/query.js";
import { ORG_ADMIN_ROLE, PLATFORM_ROLE } from "../utils/permissions.js";
import { ensureDefaults as ensureDefaultLeaveTypes } from "./leaveType.service.js";
import {
  assertKeepsAnOrgAdmin,
  createAccount,
  resetAccountPassword,
  setAccountStatus,
} from "./account.service.js";
import { invalidateOrgState } from "./authState.service.js";

/**
 * Platform administration — runs only for the Platform Admin (routes are
 * gated by requirePlatformAdmin) and never inside an organization's tenant
 * context, so every query here names its organization explicitly.
 *
 * What the platform can see about an organization is deliberately limited to
 * its profile, head-counts and its administrators. It never reads HR records
 * (employees' details, payroll, leave, …) — those stay inside the tenant.
 */

const SORTABLE = ["name", "code", "createdAt", "status"];
const oid = (id) => new mongoose.Types.ObjectId(String(id));

async function findOrg(id) {
  if (!mongoose.isValidObjectId(id)) throw AppError.notFound("Organization not found");
  const org = await Organization.findById(id);
  if (!org) throw AppError.notFound("Organization not found");
  return org;
}

async function countsByOrg(Model, ids, extra = {}) {
  const rows = await Model.aggregate([
    { $match: { organizationId: { $in: ids }, ...extra } },
    { $group: { _id: "$organizationId", n: { $sum: 1 } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), r.n]));
}

export async function platformOverview() {
  const [orgStatus, users, employees, recent] = await Promise.all([
    Organization.aggregate([{ $group: { _id: "$status", n: { $sum: 1 } } }]),
    User.countDocuments({ role: { $ne: PLATFORM_ROLE } }),
    Employee.countDocuments({ status: "active" }),
    Organization.find().sort({ createdAt: -1 }).limit(5).select("name code status createdAt industry"),
  ]);
  const byStatus = Object.fromEntries(orgStatus.map((r) => [r._id, r.n]));
  return {
    organizations: {
      total: (byStatus.active || 0) + (byStatus.inactive || 0),
      active: byStatus.active || 0,
      inactive: byStatus.inactive || 0,
    },
    users,
    activeEmployees: employees,
    recentOrganizations: recent,
  };
}

export async function listOrganizations(query = {}) {
  const { page, limit, skip } = parsePagination(query);
  const sort = parseSort(query.sort, SORTABLE, { name: 1 });
  const filter = {};
  if (query.status === "active" || query.status === "inactive") filter.status = query.status;
  if (query.search) {
    const rx = new RegExp(escapeRegex(query.search), "i");
    filter.$or = [{ name: rx }, { code: rx }, { legalName: rx }, { email: rx }];
  }

  const [orgs, total] = await Promise.all([
    Organization.find(filter).sort(sort).skip(skip).limit(limit),
    Organization.countDocuments(filter),
  ]);
  const ids = orgs.map((o) => o._id);
  const [employees, users] = await Promise.all([
    countsByOrg(Employee, ids, { status: "active" }),
    countsByOrg(User, ids),
  ]);
  const items = orgs.map((o) => ({
    ...o.toJSON(),
    stats: { activeEmployees: employees.get(String(o._id)) || 0, users: users.get(String(o._id)) || 0 },
  }));
  return paginated(items, total, { page, limit });
}

export async function getOrganization(id) {
  const org = await findOrg(id);
  const [activeEmployees, totalEmployees, users, departments, branches, admins] = await Promise.all([
    Employee.countDocuments({ organizationId: org._id, status: "active" }),
    Employee.countDocuments({ organizationId: org._id }),
    User.countDocuments({ organizationId: org._id }),
    Department.countDocuments({ organizationId: org._id }),
    Branch.countDocuments({ organizationId: org._id }),
    listOrgAdmins(org._id),
  ]);
  return {
    organization: org,
    stats: { activeEmployees, totalEmployees, users, departments, branches },
    admins,
  };
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/**
 * Create an organization together with its first Org Admin. Leave types are
 * seeded with the standard defaults so the tenant is usable immediately. If
 * the admin account can't be created (e.g. email taken) the organization is
 * rolled back so no admin-less tenant is left behind.
 */
export async function createOrganization(actor, input) {
  const { admin, ...orgInput } = input;
  const slug = orgInput.slug || slugify(orgInput.name);
  const code = orgInput.code.toUpperCase();

  const exists = await Organization.exists({ $or: [{ slug }, { code }] });
  if (exists) throw AppError.conflict("An organization with that slug or code already exists");

  const platform = await getPlatformSettings();
  const org = await Organization.create({
    country: platform.defaults?.country,
    payrollStrategy: platform.defaults?.payrollStrategy,
    ...orgInput,
    slug,
    code,
    settings: {
      timezone: platform.defaults?.timezone,
      currency: platform.defaults?.currency,
      ...(orgInput.settings || {}),
    },
    status: "active",
    createdBy: actor.userId,
  });

  let account;
  try {
    account = await createAccount({
      organizationId: org._id,
      name: admin.name,
      email: admin.email,
      phone: admin.phone,
      role: ORG_ADMIN_ROLE,
      password: admin.password,
      createdBy: actor.userId,
    });
  } catch (err) {
    await Organization.deleteOne({ _id: org._id });
    throw err;
  }

  await ensureDefaultLeaveTypes(org._id);
  return { organization: org, admin: account.user, tempPassword: admin.password ? null : account.tempPassword };
}

export async function updateOrganization(id, input) {
  const org = await findOrg(id);
  if (input.code && input.code.toUpperCase() !== org.code) {
    const clash = await Organization.exists({ code: input.code.toUpperCase(), _id: { $ne: org._id } });
    if (clash) throw AppError.conflict("Another organization already uses that code");
  }
  if (input.slug && input.slug !== org.slug) {
    const clash = await Organization.exists({ slug: input.slug, _id: { $ne: org._id } });
    if (clash) throw AppError.conflict("Another organization already uses that slug");
  }
  const { settings, ...rest } = input;
  org.set(rest);
  if (settings) {
    for (const [key, value] of Object.entries(settings)) org.settings[key] = value;
    org.markModified("settings");
  }
  await org.save();
  invalidateOrgState(org._id);
  return org;
}

/**
 * Activate / deactivate. Deactivation takes effect within the auth cache TTL
 * for tokens already issued (every request re-checks organization status) and
 * immediately for sign-in and token refresh. Data is untouched.
 */
export async function setOrganizationStatus(id, status, reason) {
  const org = await findOrg(id);
  org.status = status;
  org.statusReason = reason || undefined;
  org.statusChangedAt = new Date();
  await org.save();
  invalidateOrgState(org._id);
  return org;
}

/* --------------------------- organization admins --------------------------- */

export async function listOrgAdmins(orgId) {
  return User.find({ organizationId: oid(orgId), role: ORG_ADMIN_ROLE })
    .sort({ name: 1 })
    .select("name email phone status lastLoginAt mustChangePassword createdAt");
}

async function findOrgAdmin(orgId, userId) {
  if (!mongoose.isValidObjectId(userId)) throw AppError.notFound("Administrator not found");
  const user = await User.findOne({ _id: userId, organizationId: oid(orgId), role: ORG_ADMIN_ROLE });
  if (!user) throw AppError.notFound("Administrator not found");
  return user;
}

export async function addOrgAdmin(actor, orgId, input) {
  const org = await findOrg(orgId);
  const { user, tempPassword } = await createAccount({
    organizationId: org._id,
    name: input.name,
    email: input.email,
    phone: input.phone,
    role: ORG_ADMIN_ROLE,
    password: input.password,
    createdBy: actor.userId,
  });
  return { organization: org, admin: user, tempPassword: input.password ? null : tempPassword };
}

export async function setOrgAdminStatus(orgId, userId, status) {
  const org = await findOrg(orgId);
  const user = await findOrgAdmin(org._id, userId);
  await assertKeepsAnOrgAdmin(user, { status });
  const updated = await setAccountStatus(user, status);
  return { organization: org, admin: updated };
}

export async function resetOrgAdminPassword(orgId, userId) {
  const org = await findOrg(orgId);
  const user = await findOrgAdmin(org._id, userId);
  const { tempPassword } = await resetAccountPassword(user._id);
  return { organization: org, admin: user, tempPassword };
}

/* ------------------------------ settings / audit ------------------------------ */

export async function getSettings() {
  return getPlatformSettings();
}

export async function updateSettings(actor, input) {
  const settings = await getPlatformSettings();
  const { defaults, ...rest } = input;
  settings.set(rest);
  if (defaults) {
    for (const [key, value] of Object.entries(defaults)) settings.defaults[key] = value;
    settings.markModified("defaults");
  }
  settings.updatedBy = actor.userId;
  await settings.save();
  return settings;
}

/** Actions taken by Platform Admins — platform-scoped entries and actions on organizations. */
export async function listPlatformAudit(query = {}) {
  const { page, limit, skip } = parsePagination(query);
  const filter = { actorRole: PLATFORM_ROLE };
  if (query.organization && mongoose.isValidObjectId(query.organization)) filter.organizationId = oid(query.organization);
  const [items, total] = await Promise.all([
    AuditLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    AuditLog.countDocuments(filter),
  ]);
  return paginated(items, total, { page, limit });
}

export default {
  platformOverview,
  listOrganizations,
  getOrganization,
  createOrganization,
  updateOrganization,
  setOrganizationStatus,
  listOrgAdmins,
  addOrgAdmin,
  setOrgAdminStatus,
  resetOrgAdminPassword,
  getSettings,
  updateSettings,
  listPlatformAudit,
};
