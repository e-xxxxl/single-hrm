import mongoose from "mongoose";
import { hrmConnection } from "../../config/db.js";
import { registerModel } from "../registerModel.js";

const { Schema } = mongoose;

/**
 * A company/public holiday. `date` is the reference occurrence — when
 * `recurringAnnually` is true (the default; most public holidays fall on
 * the same month/day every year), the calendar recomputes the occurrence
 * for whichever year it's actually rendering, so a holiday only needs to be
 * created once. Set it to false for a one-off (e.g. a special closure day).
 */
const holidaySchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    name: { type: String, required: true, trim: true },
    date: { type: Date, required: true },
    recurringAnnually: { type: Boolean, default: true },
    notes: { type: String, trim: true, maxlength: 500 },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

holidaySchema.index({ organizationId: 1, date: 1 });

holidaySchema.set("toJSON", {
  virtuals: true,
  transform(_doc, ret) {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

export const Holiday = registerModel(hrmConnection, "Holiday", holidaySchema);
export default Holiday;
