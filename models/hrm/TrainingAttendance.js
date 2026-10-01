import mongoose from "mongoose";
import { hrmConnection } from "../../config/db.js";
import { registerModel } from "../registerModel.js";

const { Schema } = mongoose;

/** One employee's record of having attended one catalog training. */
const trainingAttendanceSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    employee: { type: Schema.Types.ObjectId, ref: "Employee", required: true, index: true },
    training: { type: Schema.Types.ObjectId, ref: "Training", required: true, index: true },
    trainingName: { type: String, trim: true }, // snapshot, survives a catalog rename
    dateAttended: { type: Date, required: true },
    certificateUrl: { type: String, trim: true },
    notes: { type: String, trim: true },
    recordedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

trainingAttendanceSchema.index({ organizationId: 1, employee: 1, dateAttended: -1 });

trainingAttendanceSchema.set("toJSON", {
  virtuals: true,
  transform(_d, r) {
    r.id = r._id;
    delete r._id;
    delete r.__v;
    return r;
  },
});

export const TrainingAttendance = registerModel(hrmConnection, "TrainingAttendance", trainingAttendanceSchema);
export default TrainingAttendance;
