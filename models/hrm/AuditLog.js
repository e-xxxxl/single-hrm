import mongoose from "mongoose";
import { hrmConnection } from "../../config/db.js";
import { registerModel } from "../registerModel.js";

const { Schema } = mongoose;

/**
 * Append-only record of significant HR actions. Written by services, never
 * edited or deleted through the API.
 *
 * `organizationId` is the organization the action concerns. Platform-level
 * actions (platform settings) carry `null` and are only visible to the
 * Platform Admin; platform actions *on* an organization (create, deactivate)
 * are filed under that organization so its own admins can see them too.
 */
const auditLogSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", default: null, index: true },
    scope: { type: String, enum: ["organization", "platform"], default: "organization" },
    actor: { type: Schema.Types.ObjectId, ref: "User" },
    actorName: { type: String, trim: true },
    actorRole: { type: String, trim: true },

    action: { type: String, required: true, trim: true }, // e.g. "employee.create"
    entityType: { type: String, trim: true }, // e.g. "Employee"
    entityId: { type: Schema.Types.ObjectId },
    entityLabel: { type: String, trim: true },

    summary: { type: String, trim: true },
    changes: { type: Schema.Types.Mixed }, // { field: { from, to } }
    metadata: { type: Schema.Types.Mixed },

    ip: { type: String, trim: true },
    userAgent: { type: String, trim: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

auditLogSchema.index({ organizationId: 1, createdAt: -1 });
auditLogSchema.index({ organizationId: 1, entityType: 1, entityId: 1 });

auditLogSchema.set("toJSON", {
  virtuals: true,
  transform(_doc, ret) {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

// The actor may be a Platform Admin (no organization), so the same-organization
// reference check is off for this append-only log; tenant pinning still applies.
export const AuditLog = registerModel(hrmConnection, "AuditLog", auditLogSchema, { tenant: { refGuard: false } });
export default AuditLog;
