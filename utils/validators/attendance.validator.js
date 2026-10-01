import { z } from "zod";

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "invalid id");
const dayKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");

const coords = {
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  accuracyMeters: z.coerce.number().nonnegative().optional(),
  device: z.string().max(200).optional(),
  source: z.enum(["web", "mobile"]).optional(),
};

export const clockInSchema = z.object(coords);
export const clockOutSchema = z.object(coords);

export const dayQuerySchema = z.object({
  date: dayKey.optional(),
  branch: objectId.optional(),
  department: objectId.optional(),
  status: z.enum(["Present", "Late", "Absent", "On Leave", "Not Clocked In"]).optional(),
  search: z.string().max(120).optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
});

export const recordsQuerySchema = z.object({
  employee: objectId.optional(),
  branch: objectId.optional(),
  status: z.enum(["Present", "Late", "Absent", "On Leave"]).optional(),
  from: dayKey.optional(),
  to: dayKey.optional(),
  geofenceViolation: z.enum(["true", "false"]).optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
});

export const monthlyQuerySchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, "expected YYYY-MM").optional(),
  department: objectId.optional(),
  branch: objectId.optional(),
});

const manualPunch = z.object({
  at: z.coerce.date(),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  address: z.string().max(300).optional(),
});

export const manualEntrySchema = z
  .object({
    employee: objectId,
    dayKey,
    status: z.enum(["Present", "Late", "Absent", "On Leave"]),
    clockIn: manualPunch.optional(),
    clockOut: manualPunch.optional(),
    notes: z.string().max(500).optional(),
  })
  .refine((v) => !(v.clockOut && !v.clockIn), {
    message: "clockIn is required when clockOut is provided",
    path: ["clockIn"],
  });

export default {
  clockInSchema,
  clockOutSchema,
  dayQuerySchema,
  recordsQuerySchema,
  monthlyQuerySchema,
  manualEntrySchema,
};
