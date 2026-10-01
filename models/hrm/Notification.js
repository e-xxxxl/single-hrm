import mongoose from "mongoose";
import { hrmConnection } from "../../config/db.js";
import { registerModel } from "../registerModel.js";

const { Schema } = mongoose;

export const NOTIFICATION_TYPES = [
  "leave.submitted",
  "leave.status",
  "contract.expiring",
  "review.due",
  "payroll.completed",
  "payslip.available",
  "recruitment.update",
  "target.deadline",
  "attendance.flag",
  "task.reminder",
  "general",
];

/**
 * In-app notification for a single recipient user. Created by services via
 * notification.service#notify — never written directly from a controller.
 */
const notificationSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    recipient: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    recipientEmployee: { type: Schema.Types.ObjectId, ref: "Employee" },

    type: { type: String, default: "general" },
    title: { type: String, required: true, trim: true },
    body: { type: String, trim: true, default: "" },
    link: { type: String, trim: true },
    metadata: { type: Schema.Types.Mixed },

    read: { type: Boolean, default: false, index: true },
    readAt: { type: Date },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

notificationSchema.index({ organizationId: 1, recipient: 1, read: 1, createdAt: -1 });

notificationSchema.set("toJSON", {
  virtuals: true,
  transform(_doc, ret) {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

export const Notification = registerModel(hrmConnection, "Notification", notificationSchema);
export default Notification;
