import { z } from "zod";

export const password = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128, "Password is too long");

export const loginSchema = z.object({
  email: z.string().email("Enter a valid email").transform((s) => s.toLowerCase().trim()),
  password: z.string().min(1, "Password is required").max(200),
  totp: z.string().min(6).max(20).optional(),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required"),
    newPassword: password,
  })
  .refine((v) => v.currentPassword !== v.newPassword, {
    message: "New password must be different",
    path: ["newPassword"],
  });

export default { password, loginSchema, changePasswordSchema };
