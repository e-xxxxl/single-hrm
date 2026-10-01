import mongoose from "mongoose";
import { hrmConnection } from "../../config/db.js";
import { registerModel } from "../registerModel.js";
import { PAYROLL_STRATEGIES } from "./Organization.js";

const { Schema } = mongoose;

/**
 * Platform-wide settings — a singleton document (`key: "platform"`) managed by
 * the Platform Admin. Holds nothing organization-specific; the defaults are
 * only copied onto an organization at creation time.
 */
const platformSettingSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, default: "platform" },
    platformName: { type: String, trim: true, default: "HRM Platform" },
    supportEmail: { type: String, trim: true, lowercase: true },
    // When false, sign-in is refused for every organization user (maintenance).
    allowOrganizationLogins: { type: Boolean, default: true },
    defaults: {
      timezone: { type: String, default: "Africa/Lagos" },
      currency: { type: String, default: "NGN" },
      payrollStrategy: { type: String, enum: PAYROLL_STRATEGIES, default: "fixed-monthly" },
      country: { type: String, default: "Nigeria" },
    },
    updatedBy: { type: Schema.Types.ObjectId },
  },
  { timestamps: true },
);

platformSettingSchema.set("toJSON", {
  virtuals: true,
  transform(_doc, ret) {
    delete ret._id;
    delete ret.__v;
    delete ret.key;
    return ret;
  },
});

export const PlatformSetting = registerModel(hrmConnection, "PlatformSetting", platformSettingSchema);

/** Read the singleton, creating it with defaults on first use. */
export async function getPlatformSettings() {
  return PlatformSetting.findOneAndUpdate(
    { key: "platform" },
    { $setOnInsert: { key: "platform" } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
}

export default PlatformSetting;
