import mongoose from "mongoose";
import { hrmConnection } from "../../config/db.js";
import { registerModel } from "../registerModel.js";
import { NIGERIAN_STATES } from "../../utils/nigeria.js";

const { Schema } = mongoose;

// GeoJSON Point. Only stored when coordinates exist — a partial `{ type: "Point" }`
// with no coordinates breaks the 2dsphere index.
const pointSchema = new Schema(
  {
    type: { type: String, enum: ["Point"], default: "Point" },
    coordinates: {
      type: [Number],
      validate: {
        validator: (v) => Array.isArray(v) && v.length === 2,
        message: "coordinates must be [longitude, latitude]",
      },
    },
  },
  { _id: false },
);

/**
 * A physical location belonging to an organization. Attendance clock-ins are
 * geofenced against `location` + `geofenceRadiusMeters`.
 */
const branchSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, index: true },

    name: { type: String, required: true, trim: true },
    code: { type: String, trim: true, uppercase: true },

    address: { type: String, trim: true },
    state: { type: String, enum: NIGERIAN_STATES, trim: true },
    lga: { type: String, trim: true },

    // GeoJSON Point: [longitude, latitude] — absent until coordinates are set.
    location: { type: pointSchema, default: undefined },
    geofenceRadiusMeters: { type: Number, default: 200, min: 20, max: 5000 },

    manager: { type: Schema.Types.ObjectId, ref: "Employee" },
    phone: { type: String, trim: true },
    openingTime: { type: String, default: "08:00" }, // HH:mm local
    closingTime: { type: String, default: "17:00" },

    status: { type: String, enum: ["active", "inactive"], default: "active" },
  },
  { timestamps: true },
);

branchSchema.index({ organizationId: 1, name: 1 }, { unique: true });
branchSchema.index({ organizationId: 1, code: 1 }, { unique: true, sparse: true });
branchSchema.index({ location: "2dsphere" });

branchSchema.virtual("latitude").get(function () {
  return this.location?.coordinates?.[1] ?? null;
});
branchSchema.virtual("longitude").get(function () {
  return this.location?.coordinates?.[0] ?? null;
});

branchSchema.set("toJSON", {
  virtuals: true,
  transform(_doc, ret) {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

export const Branch = registerModel(hrmConnection, "Branch", branchSchema);
export default Branch;
