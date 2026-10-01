import { z } from "zod";

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "invalid id");

export const createReferralSchema = z.object({
  employee: objectId,
  referredName: z.string().min(2).max(150),
  referredContact: z.string().max(120).optional(),
  referredFor: z.string().max(120).optional(),
  dateReferred: z.coerce.date(),
  status: z.enum(["submitted", "interviewing", "hired", "not_selected"]).optional(),
  notes: z.string().max(500).optional(),
});

export const updateReferralSchema = createReferralSchema.partial();

export default { createReferralSchema, updateReferralSchema };
