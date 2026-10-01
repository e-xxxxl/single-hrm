import mongoose from "mongoose";
import { hrmConnection } from "../../config/db.js";
import { registerModel } from "../registerModel.js";

const { Schema } = mongoose;

export const PAYROLL_RUN_STATUSES = ["draft", "calculated", "approved", "finalized", "cancelled"];

const totalsSchema = new Schema(
  {
    grossEarnings: { type: Number, default: 0 },
    commission: { type: Number, default: 0 },
    paye: { type: Number, default: 0 },
    pensionEmployee: { type: Number, default: 0 },
    pensionEmployer: { type: Number, default: 0 },
    nhf: { type: Number, default: 0 },
    otherDeductions: { type: Number, default: 0 },
    totalDeductions: { type: Number, default: 0 },
    netPay: { type: Number, default: 0 },
    employeeCount: { type: Number, default: 0 },
  },
  { _id: false },
);

const payrollRunSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    reference: { type: String, required: true, uppercase: true },
    strategy: { type: String, required: true }, // fixed-monthly | hybrid | allowance-based

    year: { type: Number, required: true },
    month: { type: Number, required: true, min: 1, max: 12 },
    periodLabel: { type: String, required: true }, // "September 2026"
    payDate: { type: Date },

    status: { type: String, enum: PAYROLL_RUN_STATUSES, default: "draft", index: true },
    totals: { type: totalsSchema, default: () => ({}) },
    excludedEmployeeCount: { type: Number, default: 0 },
    notes: { type: String, trim: true },

    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    calculatedAt: { type: Date },
    approvedBy: { type: Schema.Types.ObjectId, ref: "User" },
    approvedAt: { type: Date },
    finalizedBy: { type: Schema.Types.ObjectId, ref: "User" },
    finalizedAt: { type: Date },
  },
  { timestamps: true },
);

payrollRunSchema.index({ organizationId: 1, year: 1, month: 1 }, { unique: true });
payrollRunSchema.index({ organizationId: 1, reference: 1 }, { unique: true });

payrollRunSchema.set("toJSON", {
  virtuals: true,
  transform(_doc, ret) {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

export const PayrollRun = registerModel(hrmConnection, "PayrollRun", payrollRunSchema);
export default PayrollRun;
