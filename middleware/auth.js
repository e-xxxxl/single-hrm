import { verifyAccessToken } from "../utils/jwt.js";
import { AppError } from "../utils/AppError.js";
import { buildAuthContext } from "../services/authState.service.js";

/**
 * verifyToken — first link in the auth chain.
 *
 * Reads the bearer access token, verifies its signature and expiry, then
 * rebuilds the authorization context from current database state (see
 * services/authState.service.js) and attaches it to `req.auth`:
 *
 *   { userId, name, email, role, scope, organizationId, organizationName,
 *     organizationCode, organizationLogoUrl, organizationBrandColor,
 *     organizationStrategy, employeeId, permissions[] }
 *
 * `req.auth.organizationId` is the ONLY source of a request's organization.
 * No handler may read an organization id from the body, query or URL and treat
 * it as the caller's organization.
 */
export async function verifyToken(req, _res, next) {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");

  if (scheme !== "Bearer" || !token) {
    return next(AppError.unauthorized("Missing bearer token"));
  }

  try {
    const claims = verifyAccessToken(token); // errorHandler maps JsonWebTokenError / TokenExpiredError
    req.auth = await buildAuthContext(claims);
    return next();
  } catch (err) {
    return next(err);
  }
}

export default { verifyToken };
