import mongoose from "mongoose";
import { hrmConnection } from "../../config/db.js";
import { registerModel } from "../registerModel.js";
import { NIGERIAN_STATES, PFA_LIST } from "../../utils/nigeria.js";

const { Schema } = mongoose;

export const EMPLOYMENT_TYPES = ["Full-time", "Part-time", "Contract", "Internship", "NYSC", "Locum"];
export const EMPLOYMENT_STATUSES = ["Active", "Probation", "Suspended", "On Leave", "Exited"];
export const GENDERS = ["Male", "Female"];
export const MARITAL_STATUSES = ["Single", "Married", "Divorced", "Widowed"];

const historyEntry = (extra) =>
  new Schema(
    {
      from: { type: Date, required: true },
      to: { type: Date },
      note: { type: String, trim: true },
      changedBy: { type: Schema.Types.ObjectId, ref: "User" },
      ...extra,
    },
    { _id: true },
  );

const employeeSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    employeeId: { type: String, required: true, trim: true, uppercase: true },
    user: { type: Schema.Types.ObjectId, ref: "User" },

    // ---- Personal ----
    firstName: { type: String, required: true, trim: true },
    middleName: { type: String, trim: true },
    lastName: { type: String, required: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    phone: { type: String, required: true, trim: true },
    altPhone: { type: String, trim: true },
    dateOfBirth: { type: Date },
    gender: { type: String, enum: GENDERS },
    maritalStatus: { type: String, enum: MARITAL_STATUSES },
    nationality: { type: String, default: "Nigerian", trim: true },
    stateOfOrigin: { type: String, enum: NIGERIAN_STATES, trim: true },
    lga: { type: String, trim: true },
    residentialAddress: { type: String, trim: true },
    residentialState: { type: String, enum: NIGERIAN_STATES, trim: true },
    photoUrl: { type: String, trim: true },
    nin: { type: String, trim: true, select: false },
    bvn: { type: String, trim: true, select: false },

    emergencyContact: {
      name: { type: String, trim: true },
      relationship: { type: String, trim: true },
      phone: { type: String, trim: true },
      address: { type: String, trim: true },
    },

    // ---- Employment ----
    position: { type: String, required: true, trim: true },
    grade: { type: String, trim: true },
    department: { type: Schema.Types.ObjectId, ref: "Department", index: true },
    branch: { type: Schema.Types.ObjectId, ref: "Branch", index: true },
    reportingManager: { type: Schema.Types.ObjectId, ref: "Employee" },
    employmentType: { type: String, enum: EMPLOYMENT_TYPES, default: "Full-time" },
    employmentStatus: { type: String, enum: EMPLOYMENT_STATUSES, default: "Probation" },
    dateJoined: { type: Date, required: true },
    confirmationDate: { type: Date },
    probationEndDate: { type: Date },
    contractEndDate: { type: Date },
    exitDate: { type: Date },
    exitReason: { type: String, trim: true },

    // ---- Payroll linkage (populated from Phase 4) ----
    salaryStructure: { type: Schema.Types.ObjectId, ref: "SalaryStructure" },
    bank: {
      bankName: { type: String, trim: true },
      accountNumber: { type: String, trim: true },
      accountName: { type: String, trim: true },
    },
    pension: {
      pfaName: { type: String, enum: [...PFA_LIST, ""], trim: true },
      pfaPin: { type: String, trim: true },
    },
    taxId: { type: String, trim: true },
    taxState: { type: String, enum: NIGERIAN_STATES, default: "Lagos" },

    // ---- History ----
    positionHistory: { type: [historyEntry({ title: { type: String, trim: true }, grade: { type: String, trim: true } })], default: [] },
    departmentHistory: { type: [historyEntry({ department: { type: Schema.Types.ObjectId, ref: "Department" } })], default: [] },
    branchHistory: { type: [historyEntry({ branch: { type: Schema.Types.ObjectId, ref: "Branch" } })], default: [] },
    salaryHistory: { type: [historyEntry({ gross: { type: Number }, reason: { type: String, trim: true } })], default: [], select: false },

    // ---- Record state ----
    status: { type: String, enum: ["active", "inactive"], default: "active", index: true },
    deactivatedAt: { type: Date },
    deactivatedReason: { type: String, trim: true },
  },
  { timestamps: true },
);

employeeSchema.index({ organizationId: 1, employeeId: 1 }, { unique: true });
employeeSchema.index({ organizationId: 1, email: 1 }, { unique: true });
employeeSchema.index({ organizationId: 1, lastName: 1, firstName: 1 });
employeeSchema.index({ firstName: "text", lastName: "text", email: "text", employeeId: "text", position: "text" });

employeeSchema.virtual("fullName").get(function () {
  return [this.firstName, this.middleName, this.lastName].filter(Boolean).join(" ");
});

/** Upcoming birthday (this year or next) — used by the HR overview. */
employeeSchema.virtual("nextBirthday").get(function () {
  if (!this.dateOfBirth) return null;
  const now = new Date();
  const dob = new Date(this.dateOfBirth);
  let next = new Date(now.getFullYear(), dob.getMonth(), dob.getDate());
  if (next < new Date(now.getFullYear(), now.getMonth(), now.getDate())) {
    next = new Date(now.getFullYear() + 1, dob.getMonth(), dob.getDate());
  }
  return next;
});

employeeSchema.set("toJSON", {
  virtuals: true,
  transform(_doc, ret) {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    delete ret.nin;
    delete ret.bvn;
    return ret;
  },
});

export const Employee = registerModel(hrmConnection, "Employee", employeeSchema);
export default Employee;
