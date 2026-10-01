import * as service from "../services/organization.service.js";
import { catchAsync } from "../utils/catchAsync.js";
import { AppError } from "../utils/AppError.js";
import { recordAudit } from "../services/audit.service.js";

/** GET /api/organization — the caller's own organization. */
export const get = catchAsync(async (req, res) => {
  res.json({ data: await service.getOwnOrganization(req.orgId) });
});

/** PATCH /api/organization — profile + branding colour. */
export const update = catchAsync(async (req, res) => {
  const org = await service.updateOwnOrganization(req.orgId, req.body);
  await recordAudit(req, {
    action: "organization.update",
    entityType: "Organization",
    entityId: org._id,
    entityLabel: org.name,
    summary: `Updated organization profile (${Object.keys(req.body).join(", ")})`,
  });
  res.json({ data: org });
});

export const uploadLogo = catchAsync(async (req, res) => {
  if (!req.file) throw AppError.badRequest("No file uploaded (field name must be 'file')");
  const org = await service.setLogo(req.orgId, req.file, req.auth.userId);
  await recordAudit(req, {
    action: "organization.logo",
    entityType: "Organization",
    entityId: org._id,
    entityLabel: org.name,
    summary: "Updated the organization logo",
  });
  res.json({ data: org });
});

export const removeLogo = catchAsync(async (req, res) => {
  const org = await service.removeLogo(req.orgId);
  await recordAudit(req, {
    action: "organization.logo",
    entityType: "Organization",
    entityId: org._id,
    entityLabel: org.name,
    summary: "Removed the organization logo",
  });
  res.json({ data: org });
});

/** GET /api/public/organizations/:id/logo — unauthenticated, logo bytes only. */
export const publicLogo = catchAsync(async (req, res) => {
  const { record, stream } = await service.openLogo(req.params.id);
  res.setHeader("Content-Type", record.mimeType || "image/png");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "public, max-age=86400");
  stream.on("error", () => res.destroy());
  stream.pipe(res);
});

export default { get, update, uploadLogo, removeLogo, publicLogo };
