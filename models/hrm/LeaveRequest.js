import mongoose from "mongoose";
import { hrmConnection } from "../../config/db.js";
import { registerModel } from "../registerModel.js";

const { Schema } = mongoose;

export const LEAVE_STATUSES = [
  "Pending", // awaiting line manager
  "Manager Approved", // awaiting HR
  "Approved", // final
  "Rejected",
  "Cancelled",
  "Clarification Requested",
];

const decisionSchema = new Schema(
  {
    stage: { type: String, enum: ["manager", "hr"], required: true },
    action: { type: String, enum: ["approved", "rejected", "clarification", "override"], required: true },
    by: { type: Schema.Types.ObjectId, ref: "User" },
    byName: { type: String, trim: true },
    comment: { type: String, trim: true },
    at: { type: Date, default: Date.now },
  },
  { _id: false },
);

const noteSchema = new Schema(
  {
    by: { type: Schema.Types.ObjectId, ref: "User" },
    byName: { type: String, trim: true },
    note: { type: String, trim: true, required: true },
    at: { type: Date, default: Date.now },
  },
  { _id: true },
);

const leaveRequestSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    reference: { type: String, required: true, uppercase: true },
    employee: { type: Schema.Types.ObjectId, ref: "Employee", required: true, index: true },
    branch: { type: Schema.Types.ObjectId, ref: "Branch" },
    department: { type: Schema.Types.ObjectId, ref: "Department" },
    leaveType: { type: Schema.Types.ObjectId, ref: "LeaveType", required: true },

    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    halfDayStart: { type: Boolean, default: false },
    halfDayEnd: { type: Boolean, default: false },
    days: { type: Number, required: true, min: 0.5 }, // chargeable working days
    year: { type: Number, required: true },

    reason: { type: String, trim: true, required: true },
    supportingDocumentUrl: { type: String, trim: true },
    contactWhileAway: { type: String, trim: true },

    lineManager: { type: Schema.Types.ObjectId, ref: "Employee" },

    status: { type: String, enum: LEAVE_STATUSES, default: "Pending", index: true },
    decisions: { type: [decisionSchema], default: [] },
    notes: { type: [noteSchema], default: [] },

    coverageOverride: { type: Boolean, default: false },
    coverageWarning: { type: String, trim: true },

    submittedAt: { type: Date, default: Date.now },
    decidedAt: { type: Date },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

leaveRequestSchema.index({ organizationId: 1, reference: 1 }, { unique: true });
leaveRequestSchema.index({ organizationId: 1, status: 1, startDate: 1 });
leaveRequestSchema.index({ organizationId: 1, employee: 1, startDate: -1 });
leaveRequestSchema.index({ organizationId: 1, branch: 1, startDate: 1, endDate: 1 });

leaveRequestSchema.virtual("isOpen").get(function () {
  return ["Pending", "Manager Approved", "Clarification Requested"].includes(this.status);
});

leaveRequestSchema.set("toJSON", {
  virtuals: true,
  transform(_doc, ret) {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

export const LeaveRequest = registerModel(hrmConnection, "LeaveRequest", leaveRequestSchema);
export default LeaveRequest;
