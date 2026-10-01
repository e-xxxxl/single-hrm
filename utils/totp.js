import crypto from "node:crypto";

/**
 * RFC 6238 TOTP (SHA-1, 6 digits, 30-second step) implemented with node crypto
 * so the platform needs no external 2FA dependency. Compatible with Google
 * Authenticator, Authy, 1Password, etc.
 */

const DIGITS = 6;
const STEP_SECONDS = 30;
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function generateSecret(bytes = 20) {
  const buf = crypto.randomBytes(bytes);
  return base32Encode(buf);
}

export function otpauthURL({ secret, label, issuer = "CRM+HRM" }) {
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(label)}?${params.toString()}`;
}

export function generateToken(secret, forTime = Date.now()) {
  const counter = Math.floor(forTime / 1000 / STEP_SECONDS);
  return hotp(base32Decode(secret), counter);
}

/** Verify a token, tolerating ±`window` steps of clock drift. */
export function verifyToken(secret, token, window = 1) {
  if (!secret || !token) return false;
  const clean = String(token).replace(/\D/g, "");
  if (clean.length !== DIGITS) return false;
  const counter = Math.floor(Date.now() / 1000 / STEP_SECONDS);
  const key = base32Decode(secret);
  for (let i = -window; i <= window; i += 1) {
    if (timingSafeEqualStr(hotp(key, counter + i), clean)) return true;
  }
  return false;
}

/** Ten single-use recovery codes, hashed for storage. */
export function generateRecoveryCodes(count = 10) {
  const plain = Array.from({ length: count }, () =>
    crypto.randomBytes(5).toString("hex").replace(/(.{5})(.{5})/, "$1-$2"),
  );
  const hashed = plain.map((c) => hashRecoveryCode(c));
  return { plain, hashed };
}

export function hashRecoveryCode(code) {
  return crypto.createHash("sha256").update(String(code).replace(/[\s-]/g, "").toLowerCase()).digest("hex");
}

/* ------------------------------- internals ------------------------------- */

function hotp(key, counter) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac("sha1", key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(code % 10 ** DIGITS).padStart(DIGITS, "0");
}

function timingSafeEqualStr(a, b) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(str) {
  const clean = String(str).toUpperCase().replace(/=+$/, "").replace(/\s/g, "");
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export default { generateSecret, otpauthURL, generateToken, verifyToken, generateRecoveryCodes, hashRecoveryCode };
