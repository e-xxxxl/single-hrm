import { Organization } from "../models/hrm/Organization.js";
import { catchAsync } from "../utils/catchAsync.js";
import { AppError } from "../utils/AppError.js";
import { recordAudit } from "../services/audit.service.js";

/** GET /hrm/settings — the active organization's HR configuration. */
export const get = catchAsync(async (req, res) => {
  const org = await Organization.findById(req.orgId).select("name code payrollStrategy settings");
  if (!org) throw AppError.notFound("Organization not found");
  res.json({
    data: {
      organization: { id: org._id, name: org.name, code: org.code, payrollStrategy: org.payrollStrategy },
      settings: org.settings,
    },
  });
});

const ALLOWED = [
  "workweek",
  "standardClockIn",
  "lateGraceMinutes",
  "standardWorkHours",
  "minBranchCoverage",
  "payDayOfMonth",
  "probationMonths",
  "contractAlertDays",
  "reviewCyclesPerYear",
  "documentTypes",
  "notifications",
];

/** PATCH /hrm/settings — update a whitelisted subset of org.settings. */
export const update = catchAsync(async (req, res) => {
  const org = await Organization.findById(req.orgId);
  if (!org) throw AppError.notFound("Organization not found");

  const changed = [];
  for (const key of ALLOWED) {
    if (req.body[key] === undefined) continue;
    if (key === "notifications") {
      org.settings.notifications = { ...org.settings.notifications?.toObject?.(), ...req.body.notifications };
    } else {
      org.settings[key] = req.body[key];
    }
    changed.push(key);
  }
  org.markModified("settings");
  await org.save();

  await recordAudit(req, {
    action: "settings.update",
    entityType: "Organization",
    entityId: org._id,
    entityLabel: org.name,
    summary: `Updated HR settings: ${changed.join(", ")}`,
    metadata: Object.fromEntries(changed.map((k) => [k, req.body[k]])),
  });

  res.json({ data: org.settings });
});

export default { get, update };
