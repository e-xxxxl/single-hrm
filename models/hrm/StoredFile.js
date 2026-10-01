import mongoose from "mongoose";
import { hrmConnection } from "../../config/db.js";
import { registerModel } from "../registerModel.js";

const { Schema } = mongoose;

/**
 * Metadata for an uploaded file. The bytes are never publicly addressable:
 * either on local disk under UPLOAD_DIR (`key` = "<organizationId>/<name>")
 * or on Cloudinary as an `authenticated` asset (`publicId`). They are only
 * served through GET /api/hrm/files/:id (see services/file.service.js).
 */
const storedFileSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    key: { type: String, unique: true, sparse: true }, // local disk path relative to UPLOAD_DIR
    publicId: { type: String, trim: true }, // Cloudinary public_id
    resourceType: { type: String, trim: true, default: "raw" }, // image | raw | video
    format: { type: String, trim: true },
    deliveryType: { type: String, trim: true, default: "authenticated" },
    originalName: { type: String, trim: true },
    mimeType: { type: String, trim: true },
    size: { type: Number },
    purpose: { type: String, trim: true, default: "general" }, // document | resume | evidence | avatar…
    uploadedBy: { type: Schema.Types.ObjectId, ref: "User" },
    scanStatus: { type: String, enum: ["skipped", "pending", "clean", "infected"], default: "skipped" },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

storedFileSchema.set("toJSON", {
  virtuals: true,
  transform(_d, r) {
    r.id = r._id;
    delete r._id;
    delete r.__v;
    delete r.key;
    delete r.publicId;
    return r;
  },
});

export const StoredFile = registerModel(hrmConnection, "StoredFile", storedFileSchema);
export default StoredFile;
