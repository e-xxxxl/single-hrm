import { env } from "../config/env.js";
import { durationToMs } from "./jwt.js";

const MAX_AGE = durationToMs(env.refreshTokenTtl);

/** Options shared by set + clear so the browser matches the cookie for removal. */
function baseOptions() {
  const opts = {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: env.cookieSameSite,
    path: "/api/auth",
  };
  if (env.cookieDomain) opts.domain = env.cookieDomain;
  return opts;
}

export function setRefreshCookie(res, token) {
  res.cookie(env.refreshCookieName, token, { ...baseOptions(), maxAge: MAX_AGE });
}

export function clearRefreshCookie(res) {
  res.clearCookie(env.refreshCookieName, baseOptions());
}

export function readRefreshCookie(req) {
  return req.cookies?.[env.refreshCookieName] || null;
}

export default { setRefreshCookie, clearRefreshCookie, readRefreshCookie };
