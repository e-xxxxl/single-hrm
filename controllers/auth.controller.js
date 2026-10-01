import * as authService from "../services/auth.service.js";
import { sessionFromContext } from "../services/authState.service.js";
import { User } from "../models/hrm/User.js";
import { Organization } from "../models/hrm/Organization.js";
import { catchAsync } from "../utils/catchAsync.js";
import { AppError } from "../utils/AppError.js";
import { setRefreshCookie, clearRefreshCookie, readRefreshCookie } from "../utils/cookies.js";

function requestContext(req) {
  return {
    ip: req.ip,
    userAgent: req.get("user-agent") || "",
  };
}

/**
 * POST /api/auth/login — verify credentials (+ 2FA code when enrolled) and
 * issue the access token + refresh cookie. The organization comes from the
 * account itself; the client never names one.
 */
export const login = catchAsync(async (req, res) => {
  const { email, password, totp } = req.body;
  const { user, accessToken, refreshToken, session } = await authService.login(email, password, {
    ...requestContext(req),
    totp,
  });
  setRefreshCookie(res, refreshToken);
  res.json({ data: { user, accessToken, session } });
});

/** POST /api/auth/refresh — rotate the refresh token, return a new access token. */
export const refresh = catchAsync(async (req, res) => {
  const token = readRefreshCookie(req);
  const { accessToken, refreshToken, session } = await authService.refresh(token, requestContext(req));
  setRefreshCookie(res, refreshToken);
  res.json({ data: { accessToken, session } });
});

/** POST /api/auth/logout — revoke this session. */
export const logout = catchAsync(async (req, res) => {
  const token = readRefreshCookie(req);
  await authService.logout(token);
  clearRefreshCookie(res);
  res.json({ data: { ok: true } });
});

/**
 * GET /api/auth/me — the caller's profile, session context and (for
 * organization users) the organization profile the UI brands itself with.
 * Everything comes from `req.auth`, which is rebuilt from the database.
 */
export const me = catchAsync(async (req, res) => {
  const user = await User.findById(req.auth.userId);
  if (!user) throw AppError.unauthorized();

  let organization = null;
  if (req.auth.organizationId) {
    organization = await Organization.findById(req.auth.organizationId).select(
      "name code industry logoUrl brandColor payrollStrategy email phone address settings.timezone settings.currency",
    );
  }

  res.json({ data: { user, session: sessionFromContext(req.auth), organization } });
});

/** POST /api/auth/change-password — caller changes own password. */
export const changePassword = catchAsync(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  await authService.changePassword(req.auth.userId, currentPassword, newPassword);
  clearRefreshCookie(res);
  res.json({ data: { ok: true } });
});

/* -------------------------------- 2FA -------------------------------- */

export const twoFactorStatus = catchAsync(async (req, res) => {
  res.json({ data: await authService.twoFactorStatus(req.auth.userId) });
});

export const setup2FA = catchAsync(async (req, res) => {
  res.json({ data: await authService.begin2FASetup(req.auth.userId) });
});

export const confirm2FA = catchAsync(async (req, res) => {
  res.json({ data: await authService.confirm2FASetup(req.auth.userId, req.body.code) });
});

export const disable2FA = catchAsync(async (req, res) => {
  res.json({ data: await authService.disable2FA(req.auth.userId, req.body.password) });
});

/* --------------------------- sessions --------------------------- */

export const sessions = catchAsync(async (req, res) => {
  res.json({ data: await authService.listSessions(req.auth.userId, readRefreshCookie(req)) });
});

export const revokeSession = catchAsync(async (req, res) => {
  res.json({ data: await authService.revokeSession(req.auth.userId, req.params.id) });
});

export const revokeAllSessions = catchAsync(async (req, res) => {
  await authService.revokeAllSessions(req.auth.userId);
  clearRefreshCookie(res);
  res.json({ data: { ok: true } });
});

export default {
  login,
  refresh,
  logout,
  me,
  changePassword,
  twoFactorStatus,
  setup2FA,
  confirm2FA,
  disable2FA,
  sessions,
  revokeSession,
  revokeAllSessions,
};
