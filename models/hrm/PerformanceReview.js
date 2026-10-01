import mongoose from "mongoose";
import { hrmConnection } from "../../config/db.js";
import { registerModel } from "../registerModel.js";

const { Schema } = mongoose;

export const REVIEW_STATUSES = [
  "draft",
  "self_review",
  "manager_review",
  "completed",
  "acknowledged",
];
export const REVIEW_TYPES = ["quarterly", "annual", "probation", "project"];

const kpiLineSchema = new Schema(
  {
    kpi: { type: Schema.Types.ObjectId, ref: "Kpi" },
    name: { type: String, required: true, trim: true },
    weight: { type: Number, default: 1, min: 0, max: 100 },
    target: { type: String, trim: true },
    actual: { type: String, trim: true },
    score: { type: Number, min: 1, max: 5 },
    comment: { type: String, trim: true },
  },
  { _id: true },
);

const performanceReviewSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    employee: { type: Schema.Types.ObjectId, ref: "Employee", required: true, index: true },
    department: { type: Schema.Types.ObjectId, ref: "Department" },
    reviewer: { type: Schema.Types.ObjectId, ref: "Employee" },

    cycle: { type: String, required: true, trim: true }, // "Q3 2026"
    type: { type: String, enum: REVIEW_TYPES, default: "quarterly" },
    periodStart: { type: Date },
    periodEnd: { type: Date },
    dueDate: { type: Date },

    kpis: { type: [kpiLineSchema], default: [] },
    overallScore: { type: Number, min: 0, max: 5, default: 0 },
    rating: { type: String, trim: true }, // "Exceeds", "Meets"…

    managerComments: { type: String, trim: true },
    employeeComments: { type: String, trim: true },
    developmentPlan: { type: String, trim: true },

    status: { type: String, enum: REVIEW_STATUSES, default: "draft", index: true },
    submittedAt: { type: Date },
    completedAt: { type: Date },
    acknowledgedAt: { type: Date },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

performanceReviewSchema.index({ organizationId: 1, cycle: 1, employee: 1 }, { unique: true });
performanceReviewSchema.index({ organizationId: 1, status: 1, dueDate: 1 });

performanceReviewSchema.methods.recomputeScore = function recomputeScore() {
  const scored = this.kpis.filter((k) => typeof k.score === "number");
  if (scored.length === 0) {
    this.overallScore = 0;
    return;
  }
  const totalWeight = scored.reduce((s, k) => s + (k.weight || 1), 0) || scored.length;
  const weighted = scored.reduce((s, k) => s + k.score * (k.weight || 1), 0);
  this.overallScore = Math.round((weighted / totalWeight) * 100) / 100;
  this.rating =
    this.overallScore >= 4.5
      ? "Outstanding"
      : this.overallScore >= 3.5
        ? "Exceeds expectations"
        : this.overallScore >= 2.5
          ? "Meets expectations"
          : this.overallScore >= 1.5
            ? "Needs improvement"
            : "Unsatisfactory";
};

performanceReviewSchema.set("toJSON", {
  virtuals: true,
  transform(_d, r) {
    r.id = r._id;
    delete r._id;
    delete r.__v;
    return r;
  },
});

export const PerformanceReview = registerModel(
  hrmConnection,
  "PerformanceReview",
  performanceReviewSchema,
);
export default PerformanceReview;
