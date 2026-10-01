import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";

/**
 * Access token: short-lived, carries the full authorization context so request
 * handlers never need a DB round-trip to authorize.
 *
 * payload: { userId, name, role, organizationId, organizationName, permissions[] }
 */
export function signAccessToken(payload) {
  return jwt.sign(payload, env.jwtAccessSecret, {
    expiresIn: env.accessTokenTtl,
    subject: String(payload.userId),
  });
}

export function verifyAccessToken(token) {
  return jwt.verify(token, env.jwtAccessSecret);
}

/**
 * Refresh token: opaque to the client, long-lived, delivered in an httpOnly
 * cookie. We sign a minimal JWT (so expiry is self-describing) and additionally
 * store a sha256 hash of the token string against a server-side session so it
 * can be revoked and rotated.
 */
export function signRefreshToken(payload) {
  return jwt.sign(payload, env.jwtRefreshSecret, {
    expiresIn: env.refreshTokenTtl,
    subject: String(payload.userId),
    jwtid: crypto.randomUUID(),
  });
}

export function verifyRefreshToken(token) {
  return jwt.verify(token, env.jwtRefreshSecret);
}

export function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/** Convert a jwt-style duration ("7d", "15m", "3600") to milliseconds. */
export function durationToMs(value) {
  if (typeof value === "number") return value * 1000;
  const m = /^(\d+)\s*(ms|s|m|h|d)?$/.exec(String(value).trim());
  if (!m) return 0;
  const n = Number(m[1]);
  const unit = m[2] || "s";
  const table = { ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return n * table[unit];
}

export default {
  signAccessToken,
  verifyAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  hashToken,
  durationToMs,
};
