import { catchAsync } from "../utils/catchAsync.js";
import { AppError } from "../utils/AppError.js";
import { saveUpload, openForDownload, canAccessFile, fileRef } from "../services/file.service.js";

export const upload = catchAsync(async (req, res) => {
  if (!req.file) throw AppError.badRequest("No file uploaded (field name must be 'file')");
  const purpose = req.body.purpose || "general";
  if (purpose === "org-logo") throw AppError.badRequest("Upload logos from Settings → Branding");
  const record = await saveUpload(req.orgId, req.file, { purpose, userId: req.auth.userId });
  res.status(201).json({
    data: {
      id: record._id,
      url: fileRef(record._id),
      originalName: record.originalName,
      mimeType: record.mimeType,
      size: record.size,
    },
  });
});

export const download = catchAsync(async (req, res) => {
  const { record, stream } = await openForDownload(req.orgId, req.params.id);
  // Same response as a missing file: don't confirm the id exists.
  if (!(await canAccessFile(req.orgId, req.auth, record))) throw AppError.notFound("File not found");

  const disposition = req.query.download ? "attachment" : "inline";
  res.setHeader("Content-Type", record.mimeType || "application/octet-stream");
  res.setHeader("Content-Disposition", `${disposition}; filename="${encodeURIComponent(record.originalName || "file")}"`);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "private, no-store");
  stream.on("error", () => res.destroy());
  stream.pipe(res);
});

export default { upload, download };
