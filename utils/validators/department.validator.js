import { z } from "zod";

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "invalid id");

export const createDepartmentSchema = z.object({
  name: z.string().min(2).max(120),
  code: z.string().max(12).optional(),
  description: z.string().max(500).optional(),
  head: objectId.optional(),
  branch: objectId.optional(),
  parent: objectId.optional(),
});

export const updateDepartmentSchema = createDepartmentSchema.partial();

export const departmentStatusSchema = z.object({ status: z.enum(["active", "inactive"]) });

export default { createDepartmentSchema, updateDepartmentSchema, departmentStatusSchema };
