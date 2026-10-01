import { z } from "zod";

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "invalid id");

export const createTrainingSchema = z.object({
  name: z.string().min(2).max(150),
  description: z.string().max(500).optional(),
  category: z.string().max(60).optional(),
  provider: z.string().max(120).optional(),
});

export const updateTrainingSchema = createTrainingSchema.partial();

export const trainingActiveSchema = z.object({ active: z.boolean() });

export const recordAttendanceSchema = z.object({
  employee: objectId,
  training: objectId,
  dateAttended: z.coerce.date(),
  certificateUrl: z.string().max(500).optional(),
  notes: z.string().max(500).optional(),
});

export default { createTrainingSchema, updateTrainingSchema, trainingActiveSchema, recordAttendanceSchema };
