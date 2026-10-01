import mongoose from "mongoose";
import { hrmConnection } from "../../config/db.js";
import { registerModel } from "../registerModel.js";

const { Schema } = mongoose;

export const LEAVE_CATEGORIES = [
  "annual",
  "casual",
  "sick",
  "maternity",
  "paternity",
  "compassionate",
  "unpaid",
  "other",
];

/**
 * A leave type configured per organization. Entitlement, whether it is paid,
 * notice requirements and eligibility all live here so the request + balance
 * logic stays generic.
 */
const leaveTypeSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, index: true },

    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, uppercase: true, trim: true },
    category: { type: String, enum: LEAVE_CATEGORIES, required: true },
    description: { type: String, trim: true },

    paid: { type: Boolean, default: true },
    defaultDaysPerYear: { type: Number, default: 0, min: 0, max: 366 },
    accrual: { type: String, enum: ["annual", "monthly", "none"], default: "annual" },
    carryOverMaxDays: { type: Number, default: 0, min: 0 },

    genderEligibility: { type: String, enum: ["any", "Male", "Female"], default: "any" },
    minTenureMonths: { type: Number, default: 0, min: 0 },
    minNoticeDays: { type: Number, default: 0, min: 0 },
    maxConsecutiveDays: { type: Number, default: 0, min: 0 }, // 0 = no limit
    allowHalfDay: { type: Boolean, default: true },
    includeWeekends: { type: Boolean, default: false }, // count Sat/Sun against balance
    requiresDocument: { type: Boolean, default: false },
    countsTowardCoverage: { type: Boolean, default: true }, // affects branch-coverage checks

    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

leaveTypeSchema.index({ organizationId: 1, code: 1 }, { unique: true });
leaveTypeSchema.index({ organizationId: 1, name: 1 }, { unique: true });

leaveTypeSchema.set("toJSON", {
  virtuals: true,
  transform(_doc, ret) {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

export const LeaveType = registerModel(hrmConnection, "LeaveType", leaveTypeSchema);
export default LeaveType;
