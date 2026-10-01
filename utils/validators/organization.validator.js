import { z } from "zod";
import { PAYROLL_STRATEGIES, BRAND_COLORS } from "../../models/hrm/Organization.js";
import { password } from "./auth.validator.js";

const settings = z
  .object({
    timezone: z.string().max(60).optional(),
    currency: z.string().max(10).optional(),
    workweek: z.array(z.number().int().min(0).max(6)).optional(),
    standardClockIn: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    lateGraceMinutes: z.number().int().min(0).max(240).optional(),
    standardWorkHours: z.number().min(1).max(24).optional(),
    minBranchCoverage: z.number().int().min(0).optional(),
    payDayOfMonth: z.number().int().min(1).max(31).optional(),
    probationMonths: z.number().int().min(0).max(24).optional(),
    contractAlertDays: z.array(z.number().int().positive()).optional(),
  })
  .partial();

/** Profile fields an organization may edit about itself (organization.routes.js). */
export const orgProfileSchema = z
  .object({
    name: z.string().min(2).max(120),
    industry: z.string().max(80),
    legalName: z.string().max(160),
    rcNumber: z.string().max(40),
    tin: z.string().max(40),
    email: z.string().email().or(z.literal("")),
    phone: z.string().max(30),
    website: z.string().max(160),
    address: z.string().max(300),
    state: z.string().max(60),
    lga: z.string().max(60),
    country: z.string().max(60),
    brandColor: z.enum(BRAND_COLORS),
  })
  .partial();

const orgAdminSchema = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email().transform((s) => s.toLowerCase().trim()),
  phone: z.string().max(30).optional(),
  password: password.optional(),
});

/** Platform Admin: create an organization together with its first Org Admin. */
export const createOrganizationSchema = orgProfileSchema.extend({
  name: z.string().min(2).max(120),
  slug: z
    .string()
    .min(2)
    .max(60)
    .regex(/^[a-z0-9-]+$/, "lowercase letters, numbers and hyphens only")
    .optional(),
  code: z.string().min(2).max(10).regex(/^[A-Za-z0-9]+$/, "letters and numbers only"),
  payrollStrategy: z.enum(PAYROLL_STRATEGIES).optional(),
  settings: settings.optional(),
  admin: orgAdminSchema,
});

/** Platform Admin: edit any organization field. */
export const updateOrganizationSchema = createOrganizationSchema.omit({ admin: true }).partial();

export const orgStatusSchema = z.object({
  status: z.enum(["active", "inactive"]),
  reason: z.string().max(300).optional(),
});

export const addOrgAdminSchema = orgAdminSchema;

export const orgAdminStatusSchema = z.object({ status: z.enum(["active", "suspended"]) });

export const platformSettingsSchema = z
  .object({
    platformName: z.string().min(2).max(80),
    supportEmail: z.string().email().or(z.literal("")),
    allowOrganizationLogins: z.boolean(),
    defaults: z
      .object({
        timezone: z.string().max(60),
        currency: z.string().max(10),
        payrollStrategy: z.enum(PAYROLL_STRATEGIES),
        country: z.string().max(60),
      })
      .partial(),
  })
  .partial();

export default {
  orgProfileSchema,
  createOrganizationSchema,
  updateOrganizationSchema,
  orgStatusSchema,
  addOrgAdminSchema,
  orgAdminStatusSchema,
  platformSettingsSchema,
};
