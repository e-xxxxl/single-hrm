/**
 * Start the API against a throwaway in-memory MongoDB and seed the demo
 * organizations. For local development only — no data survives a restart.
 *
 *   npm run dev:mem
 *
 * Requires the devDependency `mongodb-memory-server`. Seeded logins use
 * SEED_PASSWORD, or DEFAULT_DEV_PASSWORD from scripts/seed.js when unset
 * (listed in README.md).
 */
import "dotenv/config"; // load server/.env first so the fallbacks below never shadow it
import { MongoMemoryServer } from "mongodb-memory-server";

// A standalone server (no replica-set election to wait for); the app uses no transactions.
const mongo = await MongoMemoryServer.create({ instance: { launchTimeout: 120_000 } });

process.env.MONGODB_URI = mongo.getUri("hrm_db");
process.env.NODE_ENV = process.env.NODE_ENV || "development";
process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || "dev-only-access-secret-change-me";
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || "dev-only-refresh-secret-change-me";

// eslint-disable-next-line no-console
console.log("[dev:mem] in-memory MongoDB ready");

const { start } = await import("../app.js");
await start();

try {
  const { seed, DEFAULT_DEV_PASSWORD } = await import("./seed.js");
  await seed({ password: process.env.SEED_PASSWORD || DEFAULT_DEV_PASSWORD, demo: true });
  // eslint-disable-next-line no-console
  console.log("[dev:mem] seeded demo organizations — see README.md for the sign-in accounts");
} catch (err) {
  // eslint-disable-next-line no-console
  console.error("[dev:mem] seed failed:", err);
}

async function stop() {
  await mongo.stop();
  process.exit(0);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
