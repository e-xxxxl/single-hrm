import { z } from "zod";

export const createHolidaySchema = z.object({
  name: z.string().min(1).max(120),
  date: z.coerce.date(),
  recurringAnnually: z.boolean().optional(),
  notes: z.string().max(500).optional(),
});

export const updateHolidaySchema = createHolidaySchema.partial();

export const holidayListQuerySchema = z.object({
  year: z.coerce.number().int().optional(),
});

export default { createHolidaySchema, updateHolidaySchema, holidayListQuerySchema };
