import { env } from "../config/env.js";

/**
 * Minimal leveled logger. Structured enough to grep in production logs, quiet
 * enough not to drown out real signal in development.
 */

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const threshold = LEVELS[env.isProd ? "info" : "debug"];

function emit(level, args) {
  if (LEVELS[level] > threshold) return;
  const ts = new Date().toISOString();
  const prefix = `${ts} ${level.toUpperCase()}`;
  // eslint-disable-next-line no-console
  const sink = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  sink(prefix, ...args);
}

export const logger = {
  error: (...args) => emit("error", args),
  warn: (...args) => emit("warn", args),
  info: (...args) => emit("info", args),
  debug: (...args) => emit("debug", args),
};

export default logger;
