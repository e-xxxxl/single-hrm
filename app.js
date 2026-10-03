import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import morgan from "morgan";

import { env } from "./config/env.js";
import { connectDatabase, closeDatabase, hrmConnection } from "./config/db.js";
import { migrateIndexes, migrateBranding } from "./config/indexes.js";
import { logger } from "./utils/logger.js";
import api from "./routes/index.js";
import { notFound, errorHandler } from "./middleware/errorHandler.js";
import { sanitizeRequest } from "./middleware/sanitize.js";
import { startHrScheduler } from "./services/maintenance.service.js";

const app = express();

app.set("trust proxy", 1);
// "simple" parses ?a[b]=c as the literal key "a[b]" — query strings can never
// produce nested objects (and so never Mongo operators) in the first place.
app.set("query parser", "simple");
app.disable("x-powered-by");

app.use(
  cors({
    origin(origin, cb) {
      // Allow same-origin / server-to-server (no Origin header) and any
      // configured client origin.
      if (!origin || env.clientOrigins.includes(origin)) return cb(null, true);
      cb(new Error(`Origin ${origin} not allowed by CORS`));
    },
    credentials: true,
  }),
);

app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
});

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(sanitizeRequest);
if (!env.isTest) app.use(morgan(env.isProd ? "combined" : "dev"));

app.get("/", (_req, res) => {
  res.json({ ok: true, service: "hrm-api", docs: "/api/health" });
});

app.use("/api", api);

app.use(notFound);
app.use(errorHandler);

export async function start({ port = env.port } = {}) {
  await connectDatabase();
  await migrateIndexes(hrmConnection); // models are registered by the route imports above
  await migrateBranding(hrmConnection);

  if (!env.isTest) startHrScheduler();
  const server = app.listen(port, () => {
    logger.info(`API listening on :${server.address().port} (${env.nodeEnv})`);
    logger.info(`CORS origins: ${env.clientOrigins.join(", ")}`);
  });

  const shutdown = (signal) => {
    logger.info(`${signal} received — shutting down`);
    server.close(async () => {
      await closeDatabase();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  return server;
}

export default app;
