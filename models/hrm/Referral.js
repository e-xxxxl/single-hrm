import mongoose from "mongoose";
import { hrmConnection } from "../../config/db.js";
import { registerModel } from "../registerModel.js";

const { Schema } = mongoose;

/** A manually-logged referral credited to an employee — part of their performance record. */
const referralSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    employee: { type: Schema.Types.ObjectId, ref: "Employee", required: true, index: true }, // who gets credit
    referredName: { type: String, required: true, trim: true },
    referredContact: { type: String, trim: true },
    referredFor: { type: String, trim: true }, // role/position referred for
    dateReferred: { type: Date, required: true },
    status: { type: String, enum: ["submitted", "interviewing", "hired", "not_selected"], default: "submitted" },
    notes: { type: String, trim: true },
    recordedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

referralSchema.index({ organizationId: 1, employee: 1, createdAt: -1 });

referralSchema.set("toJSON", {
  virtuals: true,
  transform(_d, r) {
    r.id = r._id;
    delete r._id;
    delete r.__v;
    return r;
  },
});

export const Referral = registerModel(hrmConnection, "Referral", referralSchema);
export default Referral;
