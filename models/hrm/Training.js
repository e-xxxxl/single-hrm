import mongoose from "mongoose";
import { hrmConnection } from "../../config/db.js";
import { registerModel } from "../registerModel.js";

const { Schema } = mongoose;

/**
 * A training catalog entry for one organization — the source list for the
 * "Trainings attended" dropdown. Only roles holding training:write create
 * these (see utils/permissions.js `training:write`); anyone can read the
 * catalog to log or view attendance against it.
 */
const trainingSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    category: { type: String, trim: true }, // Compliance, Safety, Onboarding, Technical…
    provider: { type: String, trim: true }, // internal | vendor/organiser name
    active: { type: Boolean, default: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

trainingSchema.index({ organizationId: 1, name: 1 }, { unique: true });

trainingSchema.set("toJSON", {
  virtuals: true,
  transform(_d, r) {
    r.id = r._id;
    delete r._id;
    delete r.__v;
    return r;
  },
});

export const Training = registerModel(hrmConnection, "Training", trainingSchema);
export default Training;
