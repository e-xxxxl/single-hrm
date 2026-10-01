import { z } from "zod";
import { NIGERIAN_STATES } from "../nigeria.js";

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "invalid id");

export const createBranchSchema = z.object({
  name: z.string().min(2).max(120),
  code: z.string().max(12).optional(),
  address: z.string().max(300).optional(),
  state: z.enum(NIGERIAN_STATES).optional(),
  lga: z.string().max(80).optional(),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  geofenceRadiusMeters: z.coerce.number().min(20).max(5000).optional(),
  manager: objectId.optional(),
  phone: z.string().max(30).optional(),
  openingTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  closingTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
});

export const updateBranchSchema = createBranchSchema.partial();

export const branchStatusSchema = z.object({ status: z.enum(["active", "inactive"]) });

export default { createBranchSchema, updateBranchSchema, branchStatusSchema };
