import mongoose from "mongoose";
import { hrmConnection } from "../../config/db.js";
import { registerModel } from "../registerModel.js";
import { EMPLOYMENT_TYPES } from "./Employee.js";

const { Schema } = mongoose;

export const JOB_STATUSES = ["draft", "open", "closed", "filled", "cancelled"];

const jobPostingSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    reference: { type: String, uppercase: true },

    title: { type: String, required: true, trim: true },
    department: { type: Schema.Types.ObjectId, ref: "Department" },
    branch: { type: Schema.Types.ObjectId, ref: "Branch" },
    employmentType: { type: String, enum: EMPLOYMENT_TYPES, default: "Full-time" },

    description: { type: String, trim: true },
    responsibilities: { type: String, trim: true },
    requirements: { type: String, trim: true },

    salaryMin: { type: Number, min: 0 },
    salaryMax: { type: Number, min: 0 },
    salaryVisible: { type: Boolean, default: false },
    openings: { type: Number, default: 1, min: 1 },

    hiringManager: { type: Schema.Types.ObjectId, ref: "Employee" },
    status: { type: String, enum: JOB_STATUSES, default: "draft", index: true },
    openedAt: { type: Date },
    closingDate: { type: Date },
    closedAt: { type: Date },

    postedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

jobPostingSchema.index({ organizationId: 1, reference: 1 }, { unique: true, sparse: true });
jobPostingSchema.index({ organizationId: 1, status: 1 });

jobPostingSchema.set("toJSON", {
  virtuals: true,
  transform(_d, r) {
    r.id = r._id;
    delete r._id;
    delete r.__v;
    return r;
  },
});

export const JobPosting = registerModel(hrmConnection, "JobPosting", jobPostingSchema);
export default JobPosting;
