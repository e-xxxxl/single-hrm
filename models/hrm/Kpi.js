import mongoose from "mongoose";
import { hrmConnection } from "../../config/db.js";
import { registerModel } from "../registerModel.js";

const { Schema } = mongoose;

/** Reusable KPI definition — the organisation's library of measurable metrics. */
const kpiSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    category: { type: String, trim: true }, // Sales, Delivery, Quality, Finance…
    unit: { type: String, trim: true, default: "" }, // %, NGN, count, hours…
    direction: { type: String, enum: ["higher_better", "lower_better"], default: "higher_better" },
    department: { type: Schema.Types.ObjectId, ref: "Department" },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

kpiSchema.index({ organizationId: 1, name: 1 }, { unique: true });

kpiSchema.set("toJSON", {
  virtuals: true,
  transform(_d, r) {
    r.id = r._id;
    delete r._id;
    delete r.__v;
    return r;
  },
});

export const Kpi = registerModel(hrmConnection, "Kpi", kpiSchema);
export default Kpi;
