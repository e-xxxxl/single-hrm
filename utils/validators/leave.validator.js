import { z } from "zod";
import { LEAVE_CATEGORIES } from "../../models/hrm/LeaveType.js";

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "invalid id");
const isoDate = z.coerce.date();

/* ---- Leave types ---- */

export const createLeaveTypeSchema = z.object({
  name: z.string().min(2).max(80),
  code: z.string().min(2).max(16).regex(/^[A-Za-z0-9_]+$/),
  category: z.enum(LEAVE_CATEGORIES),
  description: z.string().max(400).optional(),
  paid: z.boolean().optional(),
  defaultDaysPerYear: z.coerce.number().min(0).max(366).optional(),
  accrual: z.enum(["annual", "monthly", "none"]).optional(),
  carryOverMaxDays: z.coerce.number().min(0).max(366).optional(),
  genderEligibility: z.enum(["any", "Male", "Female"]).optional(),
  minTenureMonths: z.coerce.number().min(0).max(120).optional(),
  minNoticeDays: z.coerce.number().min(0).max(365).optional(),
  maxConsecutiveDays: z.coerce.number().min(0).max(366).optional(),
  allowHalfDay: z.boolean().optional(),
  includeWeekends: z.boolean().optional(),
  requiresDocument: z.boolean().optional(),
  countsTowardCoverage: z.boolean().optional(),
});

export const updateLeaveTypeSchema = createLeaveTypeSchema.partial().extend({
  active: z.boolean().optional(),
});

export const leaveTypeActiveSchema = z.object({ active: z.boolean() });

/* ---- Requests ---- */

export const createLeaveRequestSchema = z
  .object({
    employee: objectId.optional(), // HR on-behalf only
    leaveType: objectId,
    startDate: isoDate,
    endDate: isoDate,
    halfDayStart: z.boolean().optional(),
    halfDayEnd: z.boolean().optional(),
    reason: z.string().min(3).max(1000),
    supportingDocumentUrl: z.string().max(500).optional(),
    contactWhileAway: z.string().max(120).optional(),
  })
  .refine((v) => v.endDate >= v.startDate, {
    message: "End date cannot be before start date",
    path: ["endDate"],
  });

export const updateLeaveRequestSchema = z.object({
  startDate: isoDate.optional(),
  endDate: isoDate.optional(),
  halfDayStart: z.boolean().optional(),
  halfDayEnd: z.boolean().optional(),
  reason: z.string().min(3).max(1000).optional(),
  supportingDocumentUrl: z.string().max(500).optional(),
  contactWhileAway: z.string().max(120).optional(),
});

export const decisionSchema = z.object({
  action: z.enum(["approve", "reject", "clarification"]),
  comment: z.string().max(1000).optional(),
  coverageOverride: z.boolean().optional(),
});

export const noteSchema = z.object({ note: z.string().min(1).max(1000) });

export const balanceAdjustSchema = z.object({
  employee: objectId,
  leaveType: objectId,
  year: z.coerce.number().int().min(2000).max(2100),
  entitledDays: z.coerce.number().min(0).max(366).optional(),
  carriedOverDays: z.coerce.number().min(0).max(366).optional(),
  accruedAdjustment: z.coerce.number().min(-366).max(366).optional(),
  notes: z.string().max(400).optional(),
});

export const listRequestsQuerySchema = z.object({
  scope: z.enum(["mine", "team", "all"]).optional(),
  status: z
    .enum(["Pending", "Manager Approved", "Approved", "Rejected", "Cancelled", "Clarification Requested"])
    .optional(),
  employee: objectId.optional(),
  leaveType: objectId.optional(),
  branch: objectId.optional(),
  department: objectId.optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
});

export const calendarQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  branch: objectId.optional(),
  department: objectId.optional(),
});

export default {
  createLeaveTypeSchema,
  updateLeaveTypeSchema,
  leaveTypeActiveSchema,
  createLeaveRequestSchema,
  updateLeaveRequestSchema,
  decisionSchema,
  noteSchema,
  balanceAdjustSchema,
  listRequestsQuerySchema,
  calendarQuerySchema,
};
