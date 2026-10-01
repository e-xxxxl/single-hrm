import mongoose from "mongoose";
import { hrmConnection } from "../../config/db.js";
import { registerModel } from "../registerModel.js";

const { Schema } = mongoose;

/**
 * A completed trip attributed to an employee (rider / driver). Used by the
 * hybrid payroll strategy (QuickShipAfrica): commission = trip count × rate,
 * plus any per-trip amount overrides. In later phases the CRM delivery modules
 * create these automatically; for now they can be logged or imported.
 */
const tripLogSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    employee: { type: Schema.Types.ObjectId, ref: "Employee", required: true, index: true },

    date: { type: Date, required: true },
    dayKey: { type: String, required: true }, // "YYYY-MM-DD"
    reference: { type: String, trim: true }, // order / waybill number
    origin: { type: String, trim: true },
    destination: { type: String, trim: true },

    amountOverride: { type: Number, min: 0 }, // use instead of the flat rate when set
    countsForPayroll: { type: Boolean, default: true },
    payrollRun: { type: Schema.Types.ObjectId, ref: "PayrollRun" }, // set once paid

    source: { type: String, enum: ["manual", "import", "system"], default: "manual" },
    recordedBy: { type: Schema.Types.ObjectId, ref: "User" },
    notes: { type: String, trim: true },
  },
  { timestamps: true },
);

tripLogSchema.index({ organizationId: 1, employee: 1, dayKey: 1 });
tripLogSchema.index({ organizationId: 1, dayKey: 1 });

tripLogSchema.set("toJSON", {
  virtuals: true,
  transform(_doc, ret) {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

export const TripLog = registerModel(hrmConnection, "TripLog", tripLogSchema);
export default TripLog;
