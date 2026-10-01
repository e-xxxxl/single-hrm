import { z } from "zod";

export const applyLoanSchema = z.object({
  amount: z.coerce.number().positive().max(100_000_000),
  reason: z.string().max(500).optional(),
  repaymentMonths: z.coerce.number().int().min(1).max(24).optional(),
});

export const decideLoanSchema = z.object({
  status: z.enum(["approved", "rejected"]),
  note: z.string().max(500).optional(),
});

export const loanListQuerySchema = z.object({
  status: z.enum(["pending", "approved", "rejected", "completed", "cancelled"]).optional(),
  employee: z.string().regex(/^[a-f\d]{24}$/i).optional(),
});

export default { applyLoanSchema, decideLoanSchema, loanListQuerySchema };
