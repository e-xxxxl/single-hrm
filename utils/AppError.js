/**
 * Operational error carrying an HTTP status code and an optional machine-readable
 * code / details payload. Thrown anywhere in the request lifecycle and rendered
 * by the global error handler.
 */
export class AppError extends Error {
  constructor(statusCode, message, { code, details } = {}) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code || httpCode(statusCode);
    this.details = details;
    this.isOperational = true;
    Error.captureStackTrace?.(this, this.constructor);
  }

  static badRequest(message = "Bad request", opts) {
    return new AppError(400, message, opts);
  }
  static unauthorized(message = "Authentication required", opts) {
    return new AppError(401, message, opts);
  }
  static forbidden(message = "You do not have permission to perform this action", opts) {
    return new AppError(403, message, opts);
  }
  static notFound(message = "Resource not found", opts) {
    return new AppError(404, message, opts);
  }
  static conflict(message = "Resource already exists", opts) {
    return new AppError(409, message, opts);
  }
  static unprocessable(message = "Validation failed", opts) {
    return new AppError(422, message, opts);
  }
  static tooMany(message = "Too many requests", opts) {
    return new AppError(429, message, opts);
  }
  static internal(message = "Something went wrong", opts) {
    return new AppError(500, message, opts);
  }
}

function httpCode(status) {
  const map = {
    400: "BAD_REQUEST",
    401: "UNAUTHORIZED",
    403: "FORBIDDEN",
    404: "NOT_FOUND",
    409: "CONFLICT",
    422: "VALIDATION_ERROR",
    429: "RATE_LIMITED",
    500: "INTERNAL_ERROR",
  };
  return map[status] || "ERROR";
}

export default AppError;
