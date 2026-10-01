import mongoose from "mongoose";
import { env } from "./env.js";

/**
 * Database connection layer.
 *
 * Every organization's HR data lives in one database; tenant isolation is
 * enforced per document by `organizationId` (see models/plugins/tenantScope.js).
 * Models bind to `hrmConnection` so they can be registered before the
 * connection is open. Call `connectDatabase()` once at server boot.
 */

mongoose.set("strictQuery", true);

const options = {
  serverSelectionTimeoutMS: 20_000,
  socketTimeoutMS: 45_000,
  connectTimeoutMS: 20_000,
  maxPoolSize: 10,
  retryWrites: true,
};

export const hrmConnection = mongoose.createConnection(env.mongoUri, options);

hrmConnection.on("error", (err) => {
  // eslint-disable-next-line no-console
  console.error("[db] connection error:", err.message);
});

/**
 * Wait for the connection to be usable. Rejects with a helpful message if the
 * cluster is unreachable (common Atlas misconfigurations are listed).
 */
export async function connectDatabase() {
  try {
    await hrmConnection.asPromise();
    // eslint-disable-next-line no-console
    console.log(`[db] connected — "${hrmConnection.name}"`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      "[db] could not connect to MongoDB.\n" +
        "  If using Atlas: (1) use the SRV connection string, (2) allow your IP\n" +
        "  under Network Access, (3) verify user / password / database name.\n" +
        `  Original error: ${err.message}`,
    );
    throw err;
  }
}

/** Close the pool — used by the graceful shutdown handler. */
export async function closeDatabase() {
  await hrmConnection.close();
}

export default { hrmConnection, connectDatabase, closeDatabase };
