import bcrypt from "bcryptjs";
import { User } from "../models/hrm/User.js";
import { Organization } from "../models/hrm/Organization.js";
import { getPlatformSettings } from "../models/hrm/PlatformSetting.js";
import { AppError } from "../utils/AppError.js";
import * as totp from "../utils/totp.js";
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  hashToken,
  durationToMs,
} from "../utils/jwt.js";
import { env } from "../config/env.js";
import { buildAuthContext, invalidateUserState, sessionFromContext } from "./authState.service.js";

const REFRESH_MS = durationToMs(env.refreshTokenTtl);

// A valid bcrypt hash of a random string, used only to equalise failed-login timing.
const DUMMY_HASH = "$2a$12$C6UzMDM.H6dfI/f/IKcEeO.3n1p1qkFz8sQ2wJh5Qy0m3Xk1cV1oK";

/**
 * Refuse sign-in / refresh for an account whose organization is switched off,
 * or while the platform has organization sign-ins disabled for maintenance.
 */
async function assertOrganizationOpen(user) {
  if (!user.organizationId) return null; // Platform Admin
  const org = await Organization.findById(user.organizationId).select("name status");
  if (!org || org.status !== "active") {
    throw AppError.forbidden("Your organization's access to the platform is currently suspended.", {
      code: "ORG_INACTIVE",
    });
  }
  const platform = await getPlatformSettings();
  if (platform.allowOrganizationLogins === false) {
    throw AppError.forbidden("The platform is temporarily unavailable for maintenance. Please try again later.", {
      code: "PLATFORM_MAINTENANCE",
    });
  }
  return org;
}

/** Verify a TOTP code or burn a single-use recovery code. Mutates `user` on recovery use. */
function checkSecondFactor(user, code) {
  const value = String(code || "").trim();
  if (!value) {
    throw AppError.unauthorized("A two-factor code is required", { code: "TOTP_REQUIRED" });
  }
  if (totp.verifyToken(user.twoFactor.secret, value)) return;
  const hash = totp.hashRecoveryCode(value);
  const idx = (user.twoFactor.recoveryCodes || []).indexOf(hash);
  if (idx === -1) throw AppError.unauthorized("Invalid two-factor code", { code: "TOTP_INVALID" });
  user.twoFactor.recoveryCodes.splice(idx, 1);
  user.markModified("twoFactor");
}

function claimsFor(user) {
  return {
    userId: String(user._id),
    organizationId: user.organizationId ? String(user.organizationId) : null,
    tv: user.tokenVersion || 0,
  };
}

/** Issue an access + refresh pair and record the refresh session on `user` (caller saves). */
function issueTokens(user, ctx) {
  const claims = claimsFor(user);
  const accessToken = signAccessToken(claims);
  const refreshToken = signRefreshToken(claims);

  const now = new Date();
  user.sessions = (user.sessions || []).filter((s) => s.expiresAt > now);
  user.sessions.push({
    tokenHash: hashToken(refreshToken),
    userAgent: ctx.userAgent || "",
    ip: ctx.ip || "",
    createdAt: now,
    lastUsedAt: now,
    expiresAt: new Date(now.getTime() + REFRESH_MS),
  });
  return { accessToken, refreshToken, claims };
}

/**
 * Sign in. Email is unique platform-wide, so the account — and therefore its
 * one organization — is identified by the credentials alone. When the account
 * has 2FA enrolled and no code was supplied, fails with 401 TOTP_REQUIRED so
 * the client can prompt for it and resubmit.
 */
export async function login(email, password, ctx = {}) {
  const user = await User.findOne({ email: String(email).toLowerCase().trim() }).select(
    "+passwordHash +twoFactor.secret +twoFactor.recoveryCodes +sessions",
  );

  const genericFail = AppError.unauthorized("Invalid email or password");
  if (!user) {
    // Spend roughly the same time as a real bcrypt comparison so a missing
    // account isn't obviously faster to probe.
    await bcrypt.compare(String(password), DUMMY_HASH);
    throw genericFail;
  }

  const ok = await user.verifyPassword(password);
  if (!ok) throw genericFail;
  if (user.status !== "active") {
    throw AppError.forbidden("This account has been suspended. Contact your administrator.", {
      code: "ACCOUNT_SUSPENDED",
    });
  }

  await assertOrganizationOpen(user);
  if (user.twoFactor?.enabled) checkSecondFactor(user, ctx.totp);

  const { accessToken, refreshToken, claims } = issueTokens(user, ctx);
  user.lastLoginAt = new Date();
  await user.save();
  invalidateUserState(user._id);

  const auth = await buildAuthContext(claims);
  return { user, accessToken, refreshToken, session: sessionFromContext(auth) };
}

/**
 * Rotate a refresh token. The presented token must match a live session; that
 * session is replaced with a hash of the new token (single-use rotation). A
 * token that matches no session is treated as a replay of an already-rotated
 * token: every session is revoked.
 */
export async function refresh(refreshToken, ctx = {}) {
  if (!refreshToken) throw AppError.unauthorized("No refresh token");

  let decoded;
  try {
    decoded = verifyRefreshToken(refreshToken);
  } catch {
    throw AppError.unauthorized("Invalid or expired refresh token");
  }

  const user = await User.findById(decoded.userId).select("+sessions");
  if (!user) throw AppError.unauthorized("Account not found");

  const presentedHash = hashToken(refreshToken);
  const session = (user.sessions || []).find((s) => s.tokenHash === presentedHash);
  if (!session) {
    user.sessions = [];
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    await user.save();
    invalidateUserState(user._id);
    throw AppError.unauthorized("Session no longer valid, please sign in again");
  }
  if (session.expiresAt <= new Date()) {
    user.sessions = user.sessions.filter((s) => s.tokenHash !== presentedHash);
    await user.save();
    throw AppError.unauthorized("Session expired");
  }
  if (user.status !== "active") {
    throw AppError.forbidden("This account has been suspended. Contact your administrator.", {
      code: "ACCOUNT_SUSPENDED",
    });
  }
  await assertOrganizationOpen(user);

  const claims = claimsFor(user);
  const accessToken = signAccessToken(claims);
  const newRefresh = signRefreshToken(claims);
  session.tokenHash = hashToken(newRefresh);
  session.lastUsedAt = new Date();
  if (ctx.userAgent) session.userAgent = ctx.userAgent;
  if (ctx.ip) session.ip = ctx.ip;
  await user.save();

  const auth = await buildAuthContext(claims);
  return { accessToken, refreshToken: newRefresh, session: sessionFromContext(auth) };
}

/** Revoke the session tied to this refresh token. */
export async function logout(refreshToken) {
  if (!refreshToken) return;
  let decoded;
  try {
    decoded = verifyRefreshToken(refreshToken);
  } catch {
    return;
  }
  const user = await User.findById(decoded.userId).select("+sessions");
  if (!user) return;
  const h = hashToken(refreshToken);
  user.sessions = (user.sessions || []).filter((s) => s.tokenHash !== h);
  await user.save();
}

/** Change the caller's own password and revoke every session (including this one). */
export async function changePassword(userId, currentPassword, newPassword) {
  const user = await User.findById(userId).select("+passwordHash +sessions");
  if (!user) throw AppError.unauthorized();
  const ok = await user.verifyPassword(currentPassword);
  if (!ok) throw AppError.badRequest("Current password is incorrect");
  await user.setPassword(newPassword);
  user.sessions = [];
  user.tokenVersion = (user.tokenVersion || 0) + 1;
  await user.save();
  invalidateUserState(user._id);
}

/** Revoke every session for a user and invalidate outstanding access tokens. */
export async function revokeAllSessions(userId) {
  const user = await User.findById(userId).select("+sessions");
  if (!user) return;
  user.sessions = [];
  user.tokenVersion = (user.tokenVersion || 0) + 1;
  await user.save();
  invalidateUserState(user._id);
}

/* ------------------------------ 2FA (TOTP) ----------------------------- */

/** Step 1: generate a secret and return the provisioning URI. Not yet enabled. */
export async function begin2FASetup(userId) {
  const user = await User.findById(userId).select("email name +twoFactor.secret");
  if (!user) throw AppError.unauthorized();
  if (user.twoFactor?.enabled) throw AppError.badRequest("Two-factor is already enabled");

  const secret = totp.generateSecret();
  user.twoFactor.secret = secret;
  user.twoFactor.enabled = false;
  user.markModified("twoFactor");
  await user.save();

  return {
    secret,
    otpauthUrl: totp.otpauthURL({ secret, label: user.email, issuer: env.appName }),
  };
}

/** Step 2: confirm a code from the authenticator app, then enable + issue recovery codes. */
export async function confirm2FASetup(userId, code) {
  const user = await User.findById(userId).select("+twoFactor.secret +twoFactor.recoveryCodes");
  if (!user) throw AppError.unauthorized();
  if (!user.twoFactor?.secret) throw AppError.badRequest("Start the setup first");
  if (user.twoFactor.enabled) throw AppError.badRequest("Two-factor is already enabled");
  if (!totp.verifyToken(user.twoFactor.secret, code)) {
    throw AppError.badRequest("That code is not valid — check your device clock and try again");
  }

  const { plain, hashed } = totp.generateRecoveryCodes();
  user.twoFactor.enabled = true;
  user.twoFactor.recoveryCodes = hashed;
  user.markModified("twoFactor");
  await user.save();
  return { recoveryCodes: plain };
}

/** Disable 2FA — requires the account password. */
export async function disable2FA(userId, password) {
  const user = await User.findById(userId).select("+passwordHash");
  if (!user) throw AppError.unauthorized();
  if (!(await user.verifyPassword(password))) throw AppError.badRequest("Password is incorrect");
  user.twoFactor = { enabled: false, secret: undefined, recoveryCodes: [] };
  user.markModified("twoFactor");
  await user.save();
  return { disabled: true };
}

export async function twoFactorStatus(userId) {
  const user = await User.findById(userId).select("+twoFactor.recoveryCodes");
  return {
    enabled: user?.twoFactor?.enabled === true,
    recoveryCodesRemaining: user?.twoFactor?.recoveryCodes?.length || 0,
  };
}

/* --------------------------- session management ---------------------------- */

export async function listSessions(userId, currentRefreshToken) {
  const user = await User.findById(userId).select("+sessions");
  if (!user) throw AppError.unauthorized();
  const currentHash = currentRefreshToken ? hashToken(currentRefreshToken) : null;
  const now = new Date();
  return (user.sessions || [])
    .filter((s) => s.expiresAt > now)
    .map((s) => ({
      id: s._id,
      userAgent: s.userAgent || "Unknown device",
      ip: s.ip || "",
      createdAt: s.createdAt,
      lastUsedAt: s.lastUsedAt,
      expiresAt: s.expiresAt,
      current: currentHash != null && s.tokenHash === currentHash,
    }))
    .sort((a, b) => new Date(b.lastUsedAt) - new Date(a.lastUsedAt));
}

export async function revokeSession(userId, sessionId) {
  const user = await User.findById(userId).select("+sessions");
  if (!user) throw AppError.unauthorized();
  const before = user.sessions.length;
  user.sessions = user.sessions.filter((s) => String(s._id) !== String(sessionId));
  if (user.sessions.length === before) throw AppError.notFound("Session not found");
  await user.save();
  return { revoked: true };
}

export default {
  login,
  refresh,
  logout,
  changePassword,
  revokeAllSessions,
  begin2FASetup,
  confirm2FASetup,
  disable2FA,
  twoFactorStatus,
  listSessions,
  revokeSession,
};
