import mongoose from "mongoose";
import { hrmConnection } from "../../config/db.js";
import { registerModel } from "../registerModel.js";

const { Schema } = mongoose;

/**
 * An organization (tenant) using the HRM. Every HR record carries its
 * `organizationId`; organizations are created and switched on / off by the
 * Platform Admin. Payroll behaviour is organization-specific and selected by
 * `payrollStrategy`.
 */

export const PAYROLL_STRATEGIES = ["fixed-monthly", "hybrid", "allowance-based"];
export const ORG_STATUSES = ["active", "inactive"];
// Accent presets the client knows how to render (client/src/utils/brandTheme.js).
export const BRAND_COLORS = ["blue", "navy", "green", "forest", "amber", "orange", "plum", "purple", "teal", "rose"];

const settingsSchema = new Schema(
  {
    timezone: { type: String, default: "Africa/Lagos" },
    currency: { type: String, default: "NGN" },
    workweek: { type: [Number], default: [1, 2, 3, 4, 5] }, // 0=Sun … 6=Sat
    standardClockIn: { type: String, default: "08:00" }, // HH:mm, local
    lateGraceMinutes: { type: Number, default: 15 },
    standardWorkHours: { type: Number, default: 8 },
    minBranchCoverage: { type: Number, default: 1 }, // leave approval floor
    payFrequency: { type: String, enum: ["monthly"], default: "monthly" },
    payDayOfMonth: { type: Number, default: 28, min: 1, max: 31 },
    probationMonths: { type: Number, default: 3 },
    contractAlertDays: { type: [Number], default: [30, 14, 7] },

    // HR configuration (managed from HR Settings)
    reviewCyclesPerYear: { type: Number, default: 4, min: 1, max: 12 },
    documentTypes: {
      type: [String],
      default: [
        "Employment Contract",
        "Offer Letter",
        "NIN Slip",
        "Means of Identification",
        "Educational Certificate",
        "Professional Certification",
        "Guarantor Form",
        "Medical Report",
        "Reference Letter",
        "Other",
      ],
    },
    notifications: {
      leaveWorkflow: { type: Boolean, default: true },
      payslipReady: { type: Boolean, default: true },
      contractExpiry: { type: Boolean, default: true },
      reviewDue: { type: Boolean, default: true },
      targetDeadline: { type: Boolean, default: true },
    },
  },
  { _id: false },
);

const organizationSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    // Short uppercase code — prefixes employee numbers (e.g. ACME-0001).
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    industry: { type: String, trim: true },
    payrollStrategy: { type: String, enum: PAYROLL_STRATEGIES, default: "fixed-monthly" },

    legalName: { type: String, trim: true },
    rcNumber: { type: String, trim: true }, // company registration number
    tin: { type: String, trim: true }, // tax identification number
    email: { type: String, trim: true, lowercase: true },
    phone: { type: String, trim: true },
    website: { type: String, trim: true },
    address: { type: String, trim: true },
    state: { type: String, trim: true },
    lga: { type: String, trim: true },
    country: { type: String, trim: true, default: "Nigeria" },

    // Logo bytes live in a StoredFile (purpose "org-logo"); `logoUrl` is the
    // public, unauthenticated URL the client renders (routes/public.routes.js).
    logoFile: { type: Schema.Types.ObjectId, ref: "StoredFile" },
    logoUrl: { type: String, trim: true },
    brandColor: { type: String, enum: BRAND_COLORS, default: "blue" },

    settings: { type: settingsSchema, default: () => ({}) },

    status: { type: String, enum: ORG_STATUSES, default: "active", index: true },
    statusReason: { type: String, trim: true },
    statusChangedAt: { type: Date },
    createdBy: { type: Schema.Types.ObjectId },
  },
  { timestamps: true },
);

organizationSchema.methods.toJSON = function toJSON() {
  const obj = this.toObject({ virtuals: true });
  obj.id = obj._id;
  delete obj._id;
  delete obj.__v;
  return obj;
};

export const Organization = registerModel(hrmConnection, "Organization", organizationSchema);
export default Organization;
