import { ZodError } from "zod";
import mongoose from "mongoose";
import { AppError } from "../utils/AppError.js";
import { logger } from "../utils/logger.js";
import { env } from "../config/env.js";

/** 404 handler — mounted after all routes. */
export function notFound(req, res, next) {
  next(AppError.notFound(`Route not found: ${req.method} ${req.originalUrl}`));
}

/**
 * Global error handler. Normalises the many error shapes the stack can produce
 * (Zod, Mongoose validation, duplicate key, cast errors, JWT) into a single
 * JSON envelope: { error: { code, message, details? } }.
 */
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  let status = 500;
  let code = "INTERNAL_ERROR";
  let message = "Something went wrong";
  let details;

  if (err instanceof AppError) {
    status = err.statusCode;
    code = err.code;
    message = err.message;
    details = err.details;
  } else if (err instanceof ZodError) {
    status = 422;
    code = "VALIDATION_ERROR";
    message = "Request validation failed";
    details = err.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
  } else if (err instanceof mongoose.Error.ValidationError) {
    status = 422;
    code = "VALIDATION_ERROR";
    message = "Document validation failed";
    details = Object.values(err.errors).map((e) => ({ path: e.path, message: e.message }));
  } else if (err instanceof mongoose.Error.CastError) {
    status = 400;
    code = "BAD_REQUEST";
    message = `Invalid value for "${err.path}"`;
  } else if (err && err.code === 11000) {
    status = 409;
    code = "CONFLICT";
    const field = Object.keys(err.keyValue || {})[0] || "field";
    message = `A record with that ${field} already exists`;
    details = err.keyValue;
  } else if (err && (err.name === "JsonWebTokenError" || err.name === "TokenExpiredError")) {
    status = 401;
    code = "UNAUTHORIZED";
    message = err.name === "TokenExpiredError" ? "Session expired" : "Invalid token";
  } else if (err instanceof Error) {
    message = err.message || message;
  }

  if (status >= 500) {
    logger.error(`${req.method} ${req.originalUrl} —`, err);
  } else {
    logger.warn(`${req.method} ${req.originalUrl} — ${status} ${code}: ${message}`);
  }

  const body = { error: { code, message } };
  if (details !== undefined) body.error.details = details;
  if (!env.isProd && status >= 500 && err instanceof Error) {
    body.error.stack = err.stack;
  }

  res.status(status).json(body);
}

export default { notFound, errorHandler };
