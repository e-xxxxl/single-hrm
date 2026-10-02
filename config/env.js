import dotenv from "dotenv";

dotenv.config();

/**
 * Central environment configuration with validation.
 *
 * Every value the application depends on is read and checked here once at
 * boot. If a required variable is missing the process exits immediately with a
 * clear message rather than failing deep inside a request handler later.
 */

const NODE_ENV = process.env.NODE_ENV || "development";
const isProd = NODE_ENV === "production";

/** Read a required string variable. */
function required(name) {
  const value = process.env[name];
  if (value === undefined || value === "") {
    missing.push(name);
    return "";
  }
  return value;
}

/** Read an optional string variable with a fallback. */
function optional(name, fallback = "") {
  const value = process.env[name];
  return value === undefined || value === "" ? fallback : value;
}

/** Read an integer variable with a fallback. */
function int(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    invalid.push(`${name} must be an integer (got "${raw}")`);
    return fallback;
  }
  return parsed;
}

const missing = [];
const invalid = [];

export const env = {
  nodeEnv: NODE_ENV,
  isProd,
  isDev: NODE_ENV === "development",
  isTest: NODE_ENV === "test",

  port: int("PORT", 5000),
  appName: optional("APP_NAME", "HRM Platform"),

  // A single database holds every organization's data; isolation is logical
  // (organizationId on every tenant document — see models/plugins/tenantScope.js).
  mongoUri: required("MONGODB_URI"),

  // Auth
  jwtAccessSecret: required("JWT_ACCESS_SECRET"),
  jwtRefreshSecret: required("JWT_REFRESH_SECRET"),
  accessTokenTtl: optional("ACCESS_TOKEN_TTL", "2h"),
  refreshTokenTtl: optional("REFRESH_TOKEN_TTL", "7d"),
  refreshCookieName: optional("REFRESH_COOKIE_NAME", "hrm_rt"),
  // How long a user's status / role / organization status may be served from
  // the in-process cache before the auth middleware re-reads it. Deactivating
  // an organization or suspending a user takes effect within this window.
  authCacheTtlMs: int("AUTH_CACHE_TTL_MS", 10_000),
  // bcrypt work factor for password hashes. Keep 12+ in production; the test
  // suite lowers it so hundreds of hashes don't dominate the run time.
  bcryptRounds: Math.max(4, int("BCRYPT_ROUNDS", 12)),

  // CORS — comma-separated list of allowed browser origins.
  clientOrigins: optional("CLIENT_ORIGINS", "http://localhost:5173")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),

  // Cookie behaviour differs between local dev (http, same site) and prod
  // (https, cross site on a different domain).
  cookieSecure: optional("COOKIE_SECURE", isProd ? "true" : "false") === "true",
  cookieSameSite: optional("COOKIE_SAMESITE", isProd ? "none" : "lax"),
  cookieDomain: optional("COOKIE_DOMAIN", ""),

  // File uploads. "local" keeps bytes on disk under UPLOAD_DIR and streams them
  // through the auth-gated download route; "cloudinary" stores them as
  // *authenticated* assets and hands out short-lived signed URLs.
  storageDriver: optional("STORAGE_DRIVER", "local"),
  uploadDir: optional("UPLOAD_DIR", "uploads"),
  maxUploadBytes: int("MAX_UPLOAD_BYTES", 10 * 1024 * 1024),
  cloudName: optional("CLOUD_NAME", ""),
  cloudApiKey: optional("CLOUD_API_KEY", ""),
  cloudApiSecret: optional("CLOUD_API_SECRET", ""),
  // Root folder inside the Cloudinary account; files land in
  // <folder>/<organizationId>/<purpose>/. Slashes at the ends are ignored.
  cloudinaryFolder: optional("CLOUDINARY_FOLDER", "hrm").replace(/^\/+|\/+$/g, "") || "hrm",

  // Reverse geocoding for GPS attendance. When unset the API stores raw
  // coordinates and leaves the address blank rather than failing.
  geocodeProvider: optional("GEOCODE_PROVIDER", "nominatim"),
  geocodeApiKey: optional("GEOCODE_API_KEY", ""),
  nominatimUrl: optional("NOMINATIM_URL", "https://nominatim.openstreetmap.org"),

  // Outbound email (notifications). Optional in dev — messages are logged.
  smtpHost: optional("SMTP_HOST", ""),
  smtpPort: int("SMTP_PORT", 587),
  smtpUser: optional("SMTP_USER", ""),
  smtpPass: optional("SMTP_PASS", ""),
  mailFrom: optional("MAIL_FROM", "HRM Platform <no-reply@localhost>"),

  // Seed (used only by scripts/seed.js)
  seedPlatformAdminEmail: optional("SEED_PLATFORM_ADMIN_EMAIL", "platform@hrm.local"),
  seedPassword: optional("SEED_PASSWORD", ""),
};

if (!["local", "cloudinary"].includes(env.storageDriver)) {
  invalid.push(`STORAGE_DRIVER must be "local" or "cloudinary" (got "${env.storageDriver}")`);
}
if (env.storageDriver === "cloudinary" && !(env.cloudName && env.cloudApiKey && env.cloudApiSecret)) {
  invalid.push("STORAGE_DRIVER=cloudinary requires CLOUD_NAME, CLOUD_API_KEY and CLOUD_API_SECRET");
}
if (env.isProd && (env.jwtAccessSecret.startsWith("replace-me") || env.jwtRefreshSecret.startsWith("replace-me"))) {
  invalid.push("JWT_ACCESS_SECRET / JWT_REFRESH_SECRET still hold the placeholder values");
}

if (missing.length || invalid.length) {
  const lines = ["Environment configuration error:"];
  if (missing.length) {
    lines.push(`  Missing required variables: ${missing.join(", ")}`);
  }
  for (const problem of invalid) lines.push(`  ${problem}`);
  lines.push("  Copy server/.env.example to server/.env and fill in the values.");
  // eslint-disable-next-line no-console
  console.error(lines.join("\n"));
  process.exit(1);
}

export default env;
