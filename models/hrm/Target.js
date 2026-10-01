import mongoose from "mongoose";
import { hrmConnection } from "../../config/db.js";
import { registerModel } from "../registerModel.js";

const { Schema } = mongoose;

export const TARGET_STATUSES = [
  "not_started",
  "in_progress",
  "at_risk",
  "achieved",
  "missed",
  "cancelled",
];

const progressUpdateSchema = new Schema(
  {
    value: { type: Number, required: true },
    note: { type: String, trim: true },
    by: { type: Schema.Types.ObjectId, ref: "User" },
    byName: { type: String, trim: true },
    at: { type: Date, default: Date.now },
  },
  { _id: true },
);

const targetSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    reference: { type: String, uppercase: true },

    employee: { type: Schema.Types.ObjectId, ref: "Employee", index: true },
    department: { type: Schema.Types.ObjectId, ref: "Department", index: true },

    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    kpi: { type: Schema.Types.ObjectId, ref: "Kpi" },
    kpiName: { type: String, trim: true },
    metricUnit: { type: String, trim: true, default: "" },
    direction: { type: String, enum: ["higher_better", "lower_better"], default: "higher_better" },

    baselineValue: { type: Number, default: 0 },
    targetValue: { type: Number, required: true },
    currentValue: { type: Number, default: 0 },

    startDate: { type: Date, required: true },
    deadline: { type: Date, required: true },
    weight: { type: Number, default: 1, min: 0, max: 100 },

    status: { type: String, enum: TARGET_STATUSES, default: "not_started", index: true },
    progressUpdates: { type: [progressUpdateSchema], default: [] },

    assignedBy: { type: Schema.Types.ObjectId, ref: "User" },
    completedAt: { type: Date },
  },
  { timestamps: true },
);

targetSchema.index({ organizationId: 1, status: 1, deadline: 1 });

targetSchema.virtual("progressPercent").get(function () {
  const span = this.targetValue - this.baselineValue;
  if (span === 0) return this.currentValue >= this.targetValue ? 100 : 0;
  const pct = ((this.currentValue - this.baselineValue) / span) * 100;
  return Math.max(0, Math.min(100, Math.round(pct)));
});

/** Auto-advance status from progress + deadline unless explicitly closed. */
targetSchema.methods.refreshStatus = function refreshStatus() {
  if (["achieved", "missed", "cancelled"].includes(this.status)) return;
  const pct = this.progressPercent;
  const now = new Date();
  if (pct >= 100) {
    this.status = "achieved";
    this.completedAt = now;
  } else if (now > this.deadline) {
    this.status = "missed";
  } else if (pct === 0) {
    this.status = "not_started";
  } else {
    const elapsed = (now - this.startDate) / (this.deadline - this.startDate);
    this.status = elapsed > 0.5 && pct < elapsed * 100 - 15 ? "at_risk" : "in_progress";
  }
};

targetSchema.set("toJSON", {
  virtuals: true,
  transform(_d, r) {
    r.id = r._id;
    delete r._id;
    delete r.__v;
    return r;
  },
});

export const Target = registerModel(hrmConnection, "Target", targetSchema);
export default Target;
