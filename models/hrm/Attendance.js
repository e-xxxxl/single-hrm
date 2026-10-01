import mongoose from "mongoose";
import { hrmConnection } from "../../config/db.js";
import { registerModel } from "../registerModel.js";

const { Schema } = mongoose;

export const ATTENDANCE_STATUSES = ["Present", "Late", "On Leave", "Absent"];

const punchSchema = new Schema(
  {
    at: { type: Date, required: true },
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    accuracyMeters: { type: Number },
    address: { type: String, trim: true, default: "" },
    device: { type: String, trim: true, default: "" },
    source: { type: String, enum: ["web", "mobile", "manual"], default: "web" },
    // Geofence evaluation against the employee's branch at punch time.
    geofenceChecked: { type: Boolean, default: false },
    withinGeofence: { type: Boolean, default: null },
    distanceMeters: { type: Number, default: null },
    allowedRadiusMeters: { type: Number, default: null },
  },
  { _id: false },
);

const attendanceSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    employee: { type: Schema.Types.ObjectId, ref: "Employee", required: true, index: true },
    branch: { type: Schema.Types.ObjectId, ref: "Branch" },

    // Stable per-day key in the org timezone (UTC Date pinned to local midnight).
    date: { type: Date, required: true },
    dayKey: { type: String, required: true }, // "YYYY-MM-DD"

    clockIn: { type: punchSchema },
    clockOut: { type: punchSchema },

    status: { type: String, enum: ATTENDANCE_STATUSES, default: "Present" },
    lateByMinutes: { type: Number, default: 0 },
    totalHours: { type: Number, default: null },

    geofenceViolation: { type: Boolean, default: false },
    notes: { type: String, trim: true },

    // Set when a record is created/edited by HR rather than a self clock-in.
    recordedBy: { type: Schema.Types.ObjectId, ref: "User" },
    manualEntry: { type: Boolean, default: false },
  },
  { timestamps: true },
);

attendanceSchema.index({ organizationId: 1, employee: 1, dayKey: 1 }, { unique: true });
attendanceSchema.index({ organizationId: 1, dayKey: 1, branch: 1 });

attendanceSchema.set("toJSON", {
  virtuals: true,
  transform(_doc, ret) {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

export const Attendance = registerModel(hrmConnection, "Attendance", attendanceSchema);
export default Attendance;
