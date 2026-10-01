import { AppError } from "../utils/AppError.js";
import { runWithTenant } from "../utils/tenantContext.js";
import { PLATFORM_ROLE } from "../utils/permissions.js";

/**
 * scopeToOrg — organization guard. Must run after verifyToken.
 *
 * Refuses callers that have no organization (the Platform Admin), then pins the
 * caller's organization — taken from `req.auth`, i.e. from their user record —
 * for the rest of the request:
 *
 *   req.orgId                     → ObjectId string of the caller's organization
 *   req.scoped(extra?)            → { organizationId, ...extra } filter object
 *   req.assertSameOrg(doc)        → throws 404 if doc belongs to another org
 *   req.withOrg(payload)          → payload with organizationId stamped in
 *
 * and runs the downstream handlers inside `runWithTenant(orgId)`, which makes
 * the tenant-scope Mongoose plugin pin every query, aggregate and save on an
 * organization-owned model to this organization (models/plugins/tenantScope.js).
 */
function passwordChangeRequired() {
  return AppError.forbidden("Change your temporary password before continuing", {
    code: "PASSWORD_CHANGE_REQUIRED",
  });
}

export function scopeToOrg(req, _res, next) {
  if (!req.auth) return next(AppError.unauthorized());
  if (req.auth.mustChangePassword) return next(passwordChangeRequired());
  if (!req.auth.organizationId) {
    return next(
      AppError.forbidden("This area is only available to members of an organization", {
        code: "ORG_CONTEXT_REQUIRED",
      }),
    );
  }

  const orgId = req.auth.organizationId;
  req.orgId = orgId;

  req.scoped = (extra = {}) => ({ organizationId: orgId, ...extra });

  req.withOrg = (payload = {}) => ({ ...payload, organizationId: orgId });

  req.assertSameOrg = (doc) => {
    if (!doc) throw AppError.notFound();
    const docOrg = String(doc.organizationId?._id ?? doc.organizationId ?? "");
    if (docOrg !== String(orgId)) {
      // Do not reveal that the record exists in another org.
      throw AppError.notFound();
    }
    return doc;
  };

  return runWithTenant(orgId, () => next());
}

/** Platform guard — only the Platform Admin may continue. Runs after verifyToken. */
export function requirePlatformAdmin(req, _res, next) {
  if (!req.auth) return next(AppError.unauthorized());
  if (req.auth.role !== PLATFORM_ROLE || req.auth.organizationId) {
    return next(AppError.forbidden("This area is restricted to platform administrators"));
  }
  if (req.auth.mustChangePassword) return next(passwordChangeRequired());
  return next();
}

export default { scopeToOrg, requirePlatformAdmin };
