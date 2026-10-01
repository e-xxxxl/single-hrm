import { z } from "zod";

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "invalid id");
const money = z.coerce.number().min(0).max(1_000_000_000);

const customEarning = z.object({
  name: z.string().min(1).max(60),
  amount: money,
  taxable: z.boolean().optional(),
  pensionable: z.boolean().optional(),
});

export const salaryStructureSchema = z.object({
  currency: z.string().length(3).optional(),
  effectiveFrom: z.coerce.date().optional(),
  basic: money.optional(),
  housing: money.optional(),
  transport: money.optional(),
  subsidy: money.optional(),
  dataAllowance: money.optional(),
  exGratia: money.optional(),
  referralBonus: money.optional(),
  overtime: money.optional(),
  latenessDeduction: money.optional(),
  otherDeductions: money.optional(),
  customEarnings: z.array(customEarning).max(20).optional(),
  grossMonthly: money.optional(),
  commissionPerTrip: money.optional(),
  payeApplicable: z.boolean().optional(),
  pensionApplicable: z.boolean().optional(),
  nhfApplicable: z.boolean().optional(),
  reason: z.string().max(300).optional(),
});

export const createRunSchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
  payDate: z.coerce.date().optional(),
  notes: z.string().max(500).optional(),
});

export const calculateRunSchema = z.object({
  excludeEmployees: z.array(objectId).max(1000).optional(),
});

export const runListQuerySchema = z.object({
  status: z.enum(["draft", "calculated", "approved", "finalized", "cancelled"]).optional(),
  year: z.coerce.number().int().optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
});

export const payslipListQuerySchema = z.object({
  payrollRun: objectId.optional(),
  employee: objectId.optional(),
  status: z.enum(["pending", "paid"]).optional(),
  year: z.coerce.number().int().optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
});

export const createTripSchema = z.object({
  employee: objectId,
  date: z.coerce.date(),
  reference: z.string().max(60).optional(),
  origin: z.string().max(120).optional(),
  destination: z.string().max(120).optional(),
  amountOverride: money.optional(),
  countsForPayroll: z.boolean().optional(),
  notes: z.string().max(300).optional(),
});

export const bulkTripSchema = z.object({
  rows: z
    .array(
      z.object({
        employeeId: z.string().min(1),
        date: z.string().min(1),
        reference: z.string().optional(),
        origin: z.string().optional(),
        destination: z.string().optional(),
        amountOverride: z.union([z.string(), z.number()]).optional(),
      }),
    )
    .min(1)
    .max(2000),
});

export const tripListQuerySchema = z.object({
  employee: objectId.optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  unpaidOnly: z.enum(["true", "false"]).optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
});

export default {
  salaryStructureSchema,
  createRunSchema,
  calculateRunSchema,
  runListQuerySchema,
  payslipListQuerySchema,
  createTripSchema,
  bulkTripSchema,
  tripListQuerySchema,
};
