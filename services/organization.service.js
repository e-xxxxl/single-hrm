import mongoose from "mongoose";
import { Organization } from "../models/hrm/Organization.js";
import { Employee } from "../models/hrm/Employee.js";
import { Branch } from "../models/hrm/Branch.js";
import { Department } from "../models/hrm/Department.js";
import { User } from "../models/hrm/User.js";
import { StoredFile } from "../models/hrm/StoredFile.js";
import { AppError } from "../utils/AppError.js";
import { saveUpload, openForDownload, deleteFile } from "./file.service.js";
import { invalidateOrgState } from "./authState.service.js";

/**
 * The caller's own organization — profile and branding. Every function takes
 * the organization id from `req.orgId` (the authenticated user's organization);
 * there is no way to address a different organization through these routes.
 * Creating, deactivating and re-coding organizations is platform-only
 * (platform.service.js).
 */

export async function getOwnOrganization(orgId) {
  const org = await Organization.findById(orgId);
  if (!org) throw AppError.notFound("Organization not found");
  const [employees, branches, departments, users] = await Promise.all([
    Employee.countDocuments({ organizationId: org._id, status: "active" }),
    Branch.countDocuments({ organizationId: org._id }),
    Department.countDocuments({ organizationId: org._id }),
    User.countDocuments({ organizationId: org._id }),
  ]);
  return { organization: org, stats: { employees, branches, departments, users } };
}

/** Profile fields only — validated by orgProfileSchema (no code, status or payroll strategy). */
export async function updateOwnOrganization(orgId, input) {
  const org = await Organization.findById(orgId);
  if (!org) throw AppError.notFound("Organization not found");
  org.set(input);
  await org.save();
  invalidateOrgState(org._id);
  return org;
}

export function publicLogoUrl(orgId) {
  return `/api/public/organizations/${orgId}/logo?v=${Date.now()}`;
}

export async function setLogo(orgId, file, userId) {
  const org = await Organization.findById(orgId);
  if (!org) throw AppError.notFound("Organization not found");
  const stored = await saveUpload(orgId, file, { purpose: "org-logo", userId });
  const previous = org.logoFile;
  org.logoFile = stored._id;
  org.logoUrl = publicLogoUrl(org._id);
  await org.save();
  if (previous) await deleteFile(orgId, previous);
  invalidateOrgState(org._id);
  return org;
}

export async function removeLogo(orgId) {
  const org = await Organization.findById(orgId);
  if (!org) throw AppError.notFound("Organization not found");
  if (org.logoFile) await deleteFile(orgId, org.logoFile);
  org.logoFile = undefined;
  org.logoUrl = undefined;
  await org.save();
  invalidateOrgState(org._id);
  return org;
}

/**
 * Logo bytes for the unauthenticated public route. Only ever serves the file
 * currently set as that organization's logo — never any other upload.
 */
export async function openLogo(orgId) {
  if (!mongoose.isValidObjectId(orgId)) throw AppError.notFound();
  const org = await Organization.findById(orgId).select("logoFile status");
  if (!org?.logoFile) throw AppError.notFound();
  const record = await StoredFile.findOne({ _id: org.logoFile, organizationId: org._id, purpose: "org-logo" });
  if (!record) throw AppError.notFound();
  return openForDownload(org._id, record._id);
}

export default { getOwnOrganization, updateOwnOrganization, setLogo, removeLogo, openLogo, publicLogoUrl };
