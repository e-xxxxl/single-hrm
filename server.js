/**
 * Process entry point (npm start / PM2). The app itself lives in app.js so
 * tests and the in-memory dev bootstrap can import it without booting.
 */
import { start } from "./app.js";
import { logger } from "./utils/logger.js";

start().catch((err) => {
  logger.error("Failed to start server:", err);
  process.exit(1);
});