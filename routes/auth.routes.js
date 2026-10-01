import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import * as ctrl from "../controllers/auth.controller.js";
import { verifyToken } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { env } from "../config/env.js";
import { loginSchema, changePasswordSchema } from "../utils/validators/auth.validator.js";

const codeSchema = z.object({ code: z.string().min(6).max(20) });
const passwordOnlySchema = z.object({ password: z.string().min(1).max(200) });

const router = Router();

// Tight limiter on credential-checking endpoints; looser on refresh.
// Relaxed outside production so local scripting / testing isn't throttled.
const credentialLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: env.isProd ? 10 : 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: "RATE_LIMITED", message: "Too many attempts, try again later" } },
});

const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: env.isProd ? 60 : 1000,
  standardHeaders: true,
  legacyHeaders: false,
});

router.post("/login", credentialLimiter, validate(loginSchema), ctrl.login);
router.post("/refresh", refreshLimiter, ctrl.refresh);
router.post("/logout", ctrl.logout);

router.get("/me", verifyToken, ctrl.me);
router.post("/change-password", verifyToken, credentialLimiter, validate(changePasswordSchema), ctrl.changePassword);

/* Two-factor authentication (TOTP) */
router.get("/2fa/status", verifyToken, ctrl.twoFactorStatus);
router.post("/2fa/setup", verifyToken, ctrl.setup2FA);
router.post("/2fa/confirm", verifyToken, validate(codeSchema), ctrl.confirm2FA);
router.post("/2fa/disable", verifyToken, credentialLimiter, validate(passwordOnlySchema), ctrl.disable2FA);

/* Active sessions */
router.get("/sessions", verifyToken, ctrl.sessions);
router.delete("/sessions/:id", verifyToken, ctrl.revokeSession);
router.post("/sessions/revoke-all", verifyToken, ctrl.revokeAllSessions);

export default router;
