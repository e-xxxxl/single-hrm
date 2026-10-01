import { AppError } from "../utils/AppError.js";
import { hasPermission, roleRank } from "../utils/permissions.js";

/**
 * checkPermission — second link in the auth chain. Must run after verifyToken.
 *
 *   router.post("/", verifyToken, checkPermission("employee:write"), handler)
 *
 * Pass one permission, or several with `mode`:
 *   checkPermission(["a", "b"])                 → needs ALL
 *   checkPermission(["a", "b"], { mode: "any" }) → needs ANY
 */
export function checkPermission(required, { mode = "all" } = {}) {
  const list = Array.isArray(required) ? required : [required];
  return function guard(req, _res, next) {
    if (!req.auth) return next(AppError.unauthorized());
    const perms = req.auth.permissions;
    const ok =
      mode === "any"
        ? list.some((p) => hasPermission(perms, p))
        : list.every((p) => hasPermission(perms, p));
    if (!ok) {
      return next(
        AppError.forbidden("You do not have permission to perform this action", {
          details: { required: list, mode },
        }),
      );
    }
    next();
  };
}

/**
 * requireRole — restrict to an explicit set of roles, or to roles at least as
 * senior as `minRole` (lower rank number = more senior).
 */
export function requireRole(...roles) {
  return function guard(req, _res, next) {
    if (!req.auth) return next(AppError.unauthorized());
    if (!roles.includes(req.auth.role)) {
      return next(AppError.forbidden("This action is restricted to: " + roles.join(", ")));
    }
    next();
  };
}

export function minRole(role) {
  const ceiling = roleRank(role);
  return function guard(req, _res, next) {
    if (!req.auth) return next(AppError.unauthorized());
    if (roleRank(req.auth.role) > ceiling) {
      return next(AppError.forbidden(`Requires ${role} or higher`));
    }
    next();
  };
}

export default { checkPermission, requireRole, minRole };
