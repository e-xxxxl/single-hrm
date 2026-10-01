import mongoose from "mongoose";
import { hrmConnection } from "../../config/db.js";
import { registerModel } from "../registerModel.js";

const { Schema } = mongoose;

/**
 * Per employee / leave type / year ledger. `pendingDays` holds days reserved by
 * submitted-but-not-final requests; `usedDays` holds fully approved days.
 *
 *   available = entitledDays + carriedOverDays + accruedAdjustment - usedDays - pendingDays
 */
const leaveBalanceSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    employee: { type: Schema.Types.ObjectId, ref: "Employee", required: true, index: true },
    leaveType: { type: Schema.Types.ObjectId, ref: "LeaveType", required: true },
    year: { type: Number, required: true },

    entitledDays: { type: Number, default: 0 },
    carriedOverDays: { type: Number, default: 0 },
    accruedAdjustment: { type: Number, default: 0 }, // manual +/- corrections
    usedDays: { type: Number, default: 0 },
    pendingDays: { type: Number, default: 0 },

    notes: { type: String, trim: true },
  },
  { timestamps: true },
);

leaveBalanceSchema.index({ organizationId: 1, employee: 1, leaveType: 1, year: 1 }, { unique: true });

leaveBalanceSchema.virtual("availableDays").get(function () {
  return (
    this.entitledDays +
    this.carriedOverDays +
    this.accruedAdjustment -
    this.usedDays -
    this.pendingDays
  );
});

leaveBalanceSchema.set("toJSON", {
  virtuals: true,
  transform(_doc, ret) {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

export const LeaveBalance = registerModel(hrmConnection, "LeaveBalance", leaveBalanceSchema);
export default LeaveBalance;
