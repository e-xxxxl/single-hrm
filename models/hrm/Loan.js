import mongoose from "mongoose";
import { hrmConnection } from "../../config/db.js";
import { registerModel } from "../registerModel.js";

const { Schema } = mongoose;

/**
 * An employee's salary-advance/loan request. Capped at 50% of monthly gross
 * at application time (enforced in loan.service.js, not here, since it needs
 * the employee's current salary structure to check against).
 *
 * Once approved, `monthlyDeduction` is taken off pay automatically each
 * payroll run (see payroll.service.js#calculateRun) until `balanceRemaining`
 * reaches 0, at which point the loan is marked "completed". Only one
 * pending/approved loan is allowed per employee at a time.
 */
const loanSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    employee: { type: Schema.Types.ObjectId, ref: "Employee", required: true, index: true },

    amount: { type: Number, required: true, min: 0 },
    reason: { type: String, trim: true, maxlength: 500 },
    repaymentMonths: { type: Number, required: true, min: 1, max: 24, default: 1 },
    monthlyDeduction: { type: Number, required: true, min: 0 },
    balanceRemaining: { type: Number, required: true, min: 0 },

    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "completed", "cancelled"],
      default: "pending",
      index: true,
    },

    requestedAt: { type: Date, default: Date.now },
    decidedBy: { type: Schema.Types.ObjectId, ref: "User" },
    decidedAt: { type: Date },
    decisionNote: { type: String, trim: true, maxlength: 500 },

    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

loanSchema.index({ organizationId: 1, employee: 1, status: 1 });

loanSchema.set("toJSON", {
  virtuals: true,
  transform(_doc, ret) {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

export const Loan = registerModel(hrmConnection, "Loan", loanSchema);
export default Loan;
