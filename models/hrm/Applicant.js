import mongoose from "mongoose";
import { hrmConnection } from "../../config/db.js";
import { registerModel } from "../registerModel.js";

const { Schema } = mongoose;

export const APPLICANT_STAGES = [
  "Applied",
  "Screening",
  "Interview",
  "Assessment",
  "Offer",
  "Accepted",
  "Rejected",
];
export const ACTIVE_STAGES = ["Applied", "Screening", "Interview", "Assessment", "Offer"];

const stageEventSchema = new Schema(
  {
    stage: { type: String, enum: APPLICANT_STAGES, required: true },
    at: { type: Date, default: Date.now },
    by: { type: Schema.Types.ObjectId, ref: "User" },
    byName: { type: String, trim: true },
    note: { type: String, trim: true },
  },
  { _id: false },
);

const interviewSchema = new Schema(
  {
    scheduledFor: { type: Date, required: true },
    mode: { type: String, enum: ["onsite", "phone", "video"], default: "video" },
    location: { type: String, trim: true },
    interviewers: { type: [String], default: [] },
    feedback: { type: String, trim: true },
    outcome: { type: String, enum: ["pending", "pass", "fail", "hold"], default: "pending" },
  },
  { _id: true },
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

const applicantSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    jobPosting: { type: Schema.Types.ObjectId, ref: "JobPosting", required: true, index: true },

    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    phone: { type: String, trim: true },
    resumeUrl: { type: String, trim: true },
    coverLetter: { type: String, trim: true },
    source: { type: String, trim: true, default: "direct" },
    currentEmployer: { type: String, trim: true },
    expectedSalary: { type: Number, min: 0 },

    stage: { type: String, enum: APPLICANT_STAGES, default: "Applied", index: true },
    stageHistory: { type: [stageEventSchema], default: [] },
    rating: { type: Number, min: 1, max: 5 },
    rejectionReason: { type: String, trim: true },

    assignedRecruiter: { type: Schema.Types.ObjectId, ref: "Employee" },
    interviews: { type: [interviewSchema], default: [] },
    notes: { type: [noteSchema], default: [] },

    offer: {
      salary: { type: Number, min: 0 },
      startDate: { type: Date },
      sentAt: { type: Date },
      respondedAt: { type: Date },
      response: { type: String, enum: ["pending", "accepted", "declined"], default: "pending" },
    },

    convertedToEmployee: { type: Schema.Types.ObjectId, ref: "Employee" },
    appliedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

applicantSchema.index({ organizationId: 1, jobPosting: 1, email: 1 }, { unique: true });
applicantSchema.index({ organizationId: 1, stage: 1 });

applicantSchema.set("toJSON", {
  virtuals: true,
  transform(_d, r) {
    r.id = r._id;
    delete r._id;
    delete r.__v;
    return r;
  },
});

export const Applicant = registerModel(hrmConnection, "Applicant", applicantSchema);
export default Applicant;
