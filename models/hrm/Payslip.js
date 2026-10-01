import mongoose from "mongoose";
import { hrmConnection } from "../../config/db.js";
import { registerModel } from "../registerModel.js";

const { Schema } = mongoose;

const lineItem = new Schema(
  { label: { type: String, required: true }, amount: { type: Number, required: true } },
  { _id: false },
);

/**
 * One employee's pay for one period. Stored in the `payroll` collection. Frozen
 * once the parent run is finalized.
 */
const payslipSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    payrollRun: { type: Schema.Types.ObjectId, ref: "PayrollRun", required: true, index: true },
    employee: { type: Schema.Types.ObjectId, ref: "Employee", required: true, index: true },

    year: { type: Number, required: true },
    month: { type: Number, required: true },
    periodLabel: { type: String, required: true },
    currency: { type: String, default: "NGN" },
    strategy: { type: String, required: true },

    // Snapshots so a payslip stays correct even if the employee record changes.
    employeeSnapshot: {
      name: String,
      employeeId: String,
      position: String,
      department: String,
      branch: String,
      taxState: String,
      pfaName: String,
      bank: { bankName: String, accountNumber: String, accountName: String },
    },

    earnings: { type: [lineItem], default: [] },
    grossEarnings: { type: Number, default: 0 },
    tripCount: { type: Number, default: 0 },
    commission: { type: Number, default: 0 },

    deductions: { type: [lineItem], default: [] },
    paye: { type: Number, default: 0 },
    payeEmployer: { type: Number, default: 0 }, // company-absorbed half, not withheld
    pensionEmployee: { type: Number, default: 0 },
    pensionEmployer: { type: Number, default: 0 },
    nhf: { type: Number, default: 0 },
    // This period's loan installment, if any — also present as a line in
    // `deductions`. Kept denormalized here so finalizeRun can decrement the
    // Loan's balanceRemaining for exactly the employees it applied to,
    // without re-deriving it from the deductions array by label matching.
    loan: { type: Schema.Types.ObjectId, ref: "Loan" },
    loanDeduction: { type: Number, default: 0 },
    totalDeductions: { type: Number, default: 0 },

    netPay: { type: Number, default: 0 },

    taxDetail: { type: Schema.Types.Mixed }, // computePAYE output for auditability
    status: { type: String, enum: ["pending", "paid"], default: "pending" },
    paidAt: { type: Date },
    notes: { type: String, trim: true },
  },
  { timestamps: true },
);

payslipSchema.index({ organizationId: 1, payrollRun: 1, employee: 1 }, { unique: true });
payslipSchema.index({ organizationId: 1, employee: 1, year: -1, month: -1 });

payslipSchema.set("toJSON", {
  virtuals: true,
  transform(_doc, ret) {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

export const Payslip = registerModel(hrmConnection, "Payslip", payslipSchema);
export default Payslip;
