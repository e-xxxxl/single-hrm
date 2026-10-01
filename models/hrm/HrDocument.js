import mongoose from "mongoose";
import { hrmConnection } from "../../config/db.js";
import { registerModel } from "../registerModel.js";

const { Schema } = mongoose;

export const DOCUMENT_CATEGORIES = [
  "contract",
  "identification",
  "certification",
  "education",
  "hr_letter",
  "medical",
  "other",
];
export const DOCUMENT_STATUSES = ["active", "expiring", "expired", "archived"];

const hrDocumentSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    employee: { type: Schema.Types.ObjectId, ref: "Employee", index: true }, // null = org-level document

    category: { type: String, enum: DOCUMENT_CATEGORIES, required: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true },

    fileUrl: { type: String, required: true, trim: true },
    fileName: { type: String, trim: true },
    fileType: { type: String, trim: true },
    fileSize: { type: Number },

    issueDate: { type: Date },
    expiryDate: { type: Date, index: true },

    status: { type: String, enum: DOCUMENT_STATUSES, default: "active", index: true },
    // Which reminder thresholds (days-before-expiry) have already fired.
    alertsSent: { type: [Number], default: [] },

    uploadedBy: { type: Schema.Types.ObjectId, ref: "User" },
    archivedAt: { type: Date },
  },
  { timestamps: true },
);

hrDocumentSchema.index({ organizationId: 1, employee: 1, category: 1 });

/** Recompute status from the expiry date. */
hrDocumentSchema.methods.refreshStatus = function refreshStatus() {
  if (this.status === "archived") return;
  if (!this.expiryDate) {
    this.status = "active";
    return;
  }
  const days = (this.expiryDate - Date.now()) / 86400000;
  this.status = days < 0 ? "expired" : days <= 30 ? "expiring" : "active";
};

hrDocumentSchema.set("toJSON", {
  virtuals: true,
  transform(_d, r) {
    r.id = r._id;
    delete r._id;
    delete r.__v;
    return r;
  },
});

export const HrDocument = registerModel(hrmConnection, "HrDocument", hrDocumentSchema);
export default HrDocument;
