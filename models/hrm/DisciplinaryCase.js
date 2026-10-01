import mongoose from "mongoose";
import { hrmConnection } from "../../config/db.js";
import { registerModel } from "../registerModel.js";

const { Schema } = mongoose;

export const DISCIPLINARY_STATUSES = [
  "open",
  "query_issued",
  "response_received",
  "hearing_scheduled",
  "hearing_held",
  "closed",
];
export const DISCIPLINARY_CATEGORIES = [
  "misconduct",
  "attendance",
  "performance",
  "insubordination",
  "policy_breach",
  "safety",
  "other",
];
export const DISCIPLINARY_OUTCOMES = [
  "no_action",
  "verbal_warning",
  "written_warning",
  "final_warning",
  "suspension",
  "demotion",
  "dismissal",
  "other",
];

const noteSchema = new Schema(
  {
    by: { type: Schema.Types.ObjectId, ref: "User" },
    byName: { type: String, trim: true },
    note: { type: String, trim: true, required: true },
    at: { type: Date, default: Date.now },
  },
  { _id: true },
);

/**
 * Restricted disciplinary record. Access is gated on `disciplinary:read` /
 * `disciplinary:write` and every read is expected to be audit-logged by the
 * calling service.
 */
const disciplinaryCaseSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    reference: { type: String, uppercase: true },
    employee: { type: Schema.Types.ObjectId, ref: "Employee", required: true, index: true },

    incidentDate: { type: Date, required: true },
    reportedBy: { type: Schema.Types.ObjectId, ref: "Employee" },
    category: { type: String, enum: DISCIPLINARY_CATEGORIES, required: true },
    severity: { type: String, enum: ["minor", "major", "gross"], default: "minor" },
    description: { type: String, required: true, trim: true },
    evidenceUrls: { type: [String], default: [] },

    query: {
      content: { type: String, trim: true },
      issuedAt: { type: Date },
      issuedBy: { type: Schema.Types.ObjectId, ref: "User" },
      acknowledgedAt: { type: Date },
      responseDueDate: { type: Date },
    },
    employeeResponse: {
      text: { type: String, trim: true },
      documentUrl: { type: String, trim: true },
      submittedAt: { type: Date },
    },
    hearing: {
      scheduledFor: { type: Date },
      panel: { type: [String], default: [] },
      location: { type: String, trim: true },
      notes: { type: String, trim: true },
      heldAt: { type: Date },
    },
    outcome: {
      decision: { type: String, enum: DISCIPLINARY_OUTCOMES },
      details: { type: String, trim: true },
      effectiveDate: { type: Date },
      sanctionEndDate: { type: Date },
      decidedBy: { type: Schema.Types.ObjectId, ref: "User" },
      decidedAt: { type: Date },
    },

    status: { type: String, enum: DISCIPLINARY_STATUSES, default: "open", index: true },
    notes: { type: [noteSchema], default: [] },
    closedAt: { type: Date },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

disciplinaryCaseSchema.index({ organizationId: 1, reference: 1 }, { unique: true, sparse: true });
disciplinaryCaseSchema.index({ organizationId: 1, employee: 1, createdAt: -1 });

disciplinaryCaseSchema.set("toJSON", {
  virtuals: true,
  transform(_d, r) {
    r.id = r._id;
    delete r._id;
    delete r.__v;
    return r;
  },
});

export const DisciplinaryCase = registerModel(hrmConnection, "DisciplinaryCase", disciplinaryCaseSchema);
export default DisciplinaryCase;
