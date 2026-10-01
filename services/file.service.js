import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { Readable } from "node:stream";
import { StoredFile } from "../models/hrm/StoredFile.js";
import { Employee } from "../models/hrm/Employee.js";
import { HrDocument } from "../models/hrm/HrDocument.js";
import { LeaveRequest } from "../models/hrm/LeaveRequest.js";
import { Applicant } from "../models/hrm/Applicant.js";
import { DisciplinaryCase } from "../models/hrm/DisciplinaryCase.js";
import { TrainingAttendance } from "../models/hrm/TrainingAttendance.js";
import { UPLOAD_DIR, EXT_FOR_MIME } from "../middleware/upload.js";
import cloudinary, { cloudinaryEnabled } from "../config/cloudinary.js";
import { AppError } from "../utils/AppError.js";
import { hasPermission, HR_ADMIN_ROLES } from "../utils/permissions.js";
import { logger } from "../utils/logger.js";

/**
 * File storage.
 *
 * Bytes are never publicly addressable. With STORAGE_DRIVER=local they live
 * under UPLOAD_DIR/<organizationId>/…; with cloudinary they are uploaded as
 * `authenticated` assets. Either way the only way to read one is
 * GET /api/hrm/files/:id, which (1) looks the record up by `{ _id,
 * organizationId }` — another organization's id is simply not found — and
 * (2) checks the caller may see the record that references the file
 * (canAccessFile below), so guessing a colleague's file id doesn't work either.
 *
 * Records store the file as `fileRef(id)` = "/hrm/files/<id>".
 */

export const UPLOAD_PURPOSES = ["document", "leave-document", "resume", "evidence", "certificate", "avatar", "general"];

export const fileRef = (id) => `/hrm/files/${id}`;

function uploadBufferToCloudinary(buffer, { folder, originalName }) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: "auto",
        type: "authenticated",
        filename_override: originalName,
        use_filename: true,
        unique_filename: true,
      },
      (err, result) => (err ? reject(err) : resolve(result)),
    );
    Readable.from(buffer).pipe(stream);
  });
}

async function writeLocal(orgId, file) {
  const dir = path.join(UPLOAD_DIR, String(orgId));
  await fsp.mkdir(dir, { recursive: true });
  const ext = EXT_FOR_MIME.get(file.mimetype) || "";
  const name = `${Date.now()}-${crypto.randomBytes(12).toString("hex")}${ext}`;
  await fsp.writeFile(path.join(dir, name), file.buffer);
  return `${orgId}/${name}`;
}

export async function saveUpload(orgId, file, { purpose = "general", userId } = {}) {
  if (!file) throw AppError.badRequest("No file provided");
  if (!UPLOAD_PURPOSES.includes(purpose) && purpose !== "org-logo") {
    throw AppError.badRequest(`Unknown upload purpose "${purpose}"`);
  }

  const record = {
    organizationId: orgId,
    originalName: file.originalname,
    mimeType: file.mimetype,
    size: file.size,
    purpose,
    uploadedBy: userId,
  };

  if (cloudinaryEnabled) {
    const result = await uploadBufferToCloudinary(file.buffer, {
      folder: `hrm/${orgId}/${purpose}`,
      originalName: file.originalname,
    });
    Object.assign(record, {
      publicId: result.public_id,
      resourceType: result.resource_type,
      format: result.format,
      deliveryType: "authenticated",
    });
  } else {
    record.key = await writeLocal(orgId, file);
  }

  return StoredFile.create(record);
}

/** Resolve a stored file into something the controller can stream. Org-scoped. */
export async function openForDownload(orgId, id) {
  const record = await StoredFile.findOne({ _id: id, organizationId: orgId });
  if (!record) throw AppError.notFound("File not found");

  if (record.publicId) {
    const url = cloudinary.utils.private_download_url(record.publicId, record.format || "", {
      resource_type: record.resourceType || "raw",
      type: record.deliveryType || "authenticated",
      expires_at: Math.floor(Date.now() / 1000) + 60,
    });
    const res = await fetch(url);
    if (!res.ok || !res.body) throw AppError.notFound("File is missing from storage");
    return { record, stream: Readable.fromWeb(res.body) };
  }

  const filePath = path.resolve(UPLOAD_DIR, record.key || "");
  if (!filePath.startsWith(path.resolve(UPLOAD_DIR)) || !fs.existsSync(filePath)) {
    throw AppError.notFound("File is missing from storage");
  }
  return { record, stream: fs.createReadStream(filePath) };
}

/**
 * May `actor` read this file? Always yes for the uploader and HR admins;
 * otherwise only if the caller can see a record that references the file.
 */
export async function canAccessFile(orgId, actor, record) {
  if (String(record.uploadedBy) === String(actor.userId)) return true;
  if (HR_ADMIN_ROLES.includes(actor.role)) return true;
  if (record.purpose === "org-logo") return true;

  const ref = fileRef(record._id);
  const can = (p) => hasPermission(actor.permissions, p);
  const me = await Employee.findOne({ organizationId: orgId, user: actor.userId }).select("_id");
  const mine = (employeeId) => me && employeeId && String(employeeId) === String(me._id);

  const doc = await HrDocument.findOne({ organizationId: orgId, fileUrl: ref }).select("employee");
  if (doc && (can("document:write") || mine(doc.employee))) return true;

  const leave = await LeaveRequest.findOne({ organizationId: orgId, supportingDocumentUrl: ref }).select(
    "employee lineManager",
  );
  if (leave && (can("leave:approve_hr") || mine(leave.employee) || mine(leave.lineManager))) return true;

  const applicant = await Applicant.exists({ organizationId: orgId, resumeUrl: ref });
  if (applicant && can("recruitment:read")) return true;

  const kase = await DisciplinaryCase.findOne({
    organizationId: orgId,
    $or: [{ evidenceUrls: ref }, { "employeeResponse.documentUrl": ref }],
  }).select("employee");
  if (kase && (can("disciplinary:read") || mine(kase.employee))) return true;

  const cert = await TrainingAttendance.findOne({ organizationId: orgId, certificateUrl: ref }).select("employee");
  if (cert && (can("employee:read") || mine(cert.employee))) return true;

  return false;
}

export async function deleteFile(orgId, id) {
  const record = await StoredFile.findOne({ _id: id, organizationId: orgId });
  if (!record) return;

  if (record.publicId) {
    try {
      await cloudinary.uploader.destroy(record.publicId, {
        resource_type: record.resourceType || "raw",
        type: record.deliveryType || "authenticated",
      });
    } catch (err) {
      logger.warn(`[cloudinary] failed to delete ${record.publicId}: ${err.message}`);
    }
  } else if (record.key) {
    const filePath = path.resolve(UPLOAD_DIR, record.key);
    if (filePath.startsWith(path.resolve(UPLOAD_DIR))) fs.rm(filePath, { force: true }, () => {});
  }
  await record.deleteOne();
}

export default { UPLOAD_PURPOSES, fileRef, saveUpload, openForDownload, canAccessFile, deleteFile };
