import * as service from "../services/platform.service.js";
import { catchAsync } from "../utils/catchAsync.js";
import { recordAudit } from "../services/audit.service.js";

export const overview = catchAsync(async (_req, res) => {
  res.json({ data: await service.platformOverview() });
});

export const listOrganizations = catchAsync(async (req, res) => {
  res.json(await service.listOrganizations(req.query));
});

export const getOrganization = catchAsync(async (req, res) => {
  res.json({ data: await service.getOrganization(req.params.id) });
});

export const createOrganization = catchAsync(async (req, res) => {
  const { organization, admin, tempPassword } = await service.createOrganization(req.auth, req.body);
  await recordAudit(req, {
    organizationId: organization._id,
    scope: "platform",
    action: "organization.create",
    entityType: "Organization",
    entityId: organization._id,
    entityLabel: organization.name,
    summary: `Created organization ${organization.name} (${organization.code}) with Org Admin ${admin.email}`,
  });
  res.status(201).json({ data: { organization, admin }, meta: tempPassword ? { tempPassword } : undefined });
});

export const updateOrganization = catchAsync(async (req, res) => {
  const org = await service.updateOrganization(req.params.id, req.body);
  await recordAudit(req, {
    organizationId: org._id,
    scope: "platform",
    action: "organization.update",
    entityType: "Organization",
    entityId: org._id,
    entityLabel: org.name,
    summary: `Updated organization ${org.name} (${Object.keys(req.body).join(", ")})`,
  });
  res.json({ data: org });
});

export const setOrganizationStatus = catchAsync(async (req, res) => {
  const org = await service.setOrganizationStatus(req.params.id, req.body.status, req.body.reason);
  await recordAudit(req, {
    organizationId: org._id,
    scope: "platform",
    action: org.status === "active" ? "organization.activate" : "organization.deactivate",
    entityType: "Organization",
    entityId: org._id,
    entityLabel: org.name,
    summary: `${org.status === "active" ? "Activated" : "Deactivated"} organization ${org.name}${
      req.body.reason ? ` — ${req.body.reason}` : ""
    }`,
  });
  res.json({ data: org });
});

export const addOrgAdmin = catchAsync(async (req, res) => {
  const { organization, admin, tempPassword } = await service.addOrgAdmin(req.auth, req.params.id, req.body);
  await recordAudit(req, {
    organizationId: organization._id,
    scope: "platform",
    action: "organization.admin_add",
    entityType: "User",
    entityId: admin._id,
    entityLabel: admin.email,
    summary: `Added Org Admin ${admin.email} to ${organization.name}`,
  });
  res.status(201).json({ data: admin, meta: tempPassword ? { tempPassword } : undefined });
});

export const setOrgAdminStatus = catchAsync(async (req, res) => {
  const { organization, admin } = await service.setOrgAdminStatus(req.params.id, req.params.userId, req.body.status);
  await recordAudit(req, {
    organizationId: organization._id,
    scope: "platform",
    action: "organization.admin_status",
    entityType: "User",
    entityId: admin._id,
    entityLabel: admin.email,
    summary: `${admin.status === "active" ? "Reactivated" : "Suspended"} Org Admin ${admin.email}`,
  });
  res.json({ data: admin });
});

export const resetOrgAdminPassword = catchAsync(async (req, res) => {
  const { organization, admin, tempPassword } = await service.resetOrgAdminPassword(req.params.id, req.params.userId);
  await recordAudit(req, {
    organizationId: organization._id,
    scope: "platform",
    action: "organization.admin_reset_password",
    entityType: "User",
    entityId: admin._id,
    entityLabel: admin.email,
    summary: `Reset the password for Org Admin ${admin.email}`,
  });
  res.json({ data: { tempPassword } });
});

export const getSettings = catchAsync(async (_req, res) => {
  res.json({ data: await service.getSettings() });
});

export const updateSettings = catchAsync(async (req, res) => {
  const settings = await service.updateSettings(req.auth, req.body);
  await recordAudit(req, {
    organizationId: null,
    scope: "platform",
    action: "platform.settings_update",
    entityType: "PlatformSetting",
    summary: `Updated platform settings (${Object.keys(req.body).join(", ")})`,
    metadata: req.body,
  });
  res.json({ data: settings });
});

export const audit = catchAsync(async (req, res) => {
  res.json(await service.listPlatformAudit(req.query));
});

export default {
  overview,
  listOrganizations,
  getOrganization,
  createOrganization,
  updateOrganization,
  setOrganizationStatus,
  addOrgAdmin,
  setOrgAdminStatus,
  resetOrgAdminPassword,
  getSettings,
  updateSettings,
  audit,
};
