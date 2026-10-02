import { User } from "../models/hrm/User.js";
import { Organization } from "../models/hrm/Organization.js";
import { AppError } from "../utils/AppError.js";
import { resolvePermissions, PLATFORM_ROLE, ORG_ADMIN_ROLE } from "../utils/permissions.js";
import { env } from "../config/env.js";

/**
 * Builds the authorization context for a request from the *database*, not from
 * the token alone. The access token only proves who the caller is; their
 * organization, role, permissions and the organization's status are re-read
 * here (through a short-lived in-process cache) so that:
 *
 *   • suspending a user or deactivating an organization cuts access within
 *     AUTH_CACHE_TTL_MS instead of when the token eventually expires;
 *   • a role / permission change applies to the very next requests;
 *   • the organization a request acts in is always the one on the user
 *     record — nothing the client sends can change it.
 */

const userCache = new Map(); // userId → { value, expires }
const orgCache = new Map(); // orgId → { value, expires }

function cached(map, key, loader) {
  const hit = map.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  const value = loader();
  map.set(key, { value, expires: Date.now() + env.authCacheTtlMs });
  // Drop a failed load so the next request retries rather than caching the error.
  Promise.resolve(value).catch(() => map.delete(key));
  return value;
}

function loadUser(userId) {
  return cached(userCache, String(userId), () =>
    User.findById(userId)
      .select(
        "organizationId role status tokenVersion permissionsGrant permissionsRevoke name email employee mustChangePassword",
      )
      .lean()
      .exec(), // cache a Promise — a Mongoose Query re-executes (and throws) if awaited twice
  );
}

function loadOrg(orgId) {
  return cached(orgCache, String(orgId), () =>
    Organization.findById(orgId).select("name code status logoUrl brandColor payrollStrategy").lean().exec(),
  );
}

/** Forget a user's cached state (call after changing their role / status / password). */
export function invalidateUserState(userId) {
  userCache.delete(String(userId));
}

/** Forget an organization's cached state (call after changing its status or branding). */
export function invalidateOrgState(orgId) {
  orgCache.delete(String(orgId));
}

/** Shape the session payload the client receives (also used by /auth/me). */
export function sessionFromContext(ctx) {
  return {
    role: ctx.role,
    scope: ctx.scope,
    organizationId: ctx.organizationId,
    organizationName: ctx.organizationName,
    organizationCode: ctx.organizationCode,
    organizationLogoUrl: ctx.organizationLogoUrl,
    organizationBrandColor: ctx.organizationBrandColor,
    organizationStrategy: ctx.organizationStrategy,
    employeeId: ctx.employeeId,
    mustChangePassword: ctx.mustChangePassword,
    isPlatformUser: ctx.isPlatformUser,
    actingAs: ctx.actingAs,
    permissions: ctx.permissions,
  };
}

/**
 * Validate verified token claims against current state and return `req.auth`.
 * Throws 401 when the session is no longer valid and 403 when the account or
 * its organization has been switched off.
 */
export async function buildAuthContext(claims) {
  const user = await loadUser(claims.userId);
  if (!user) throw AppError.unauthorized("Account not found");
  if (user.status !== "active") {
    throw AppError.forbidden("This account has been suspended. Contact your administrator.", {
      code: "ACCOUNT_SUSPENDED",
    });
  }
  if ((user.tokenVersion || 0) !== (claims.tv || 0)) {
    throw AppError.unauthorized("Session expired, please sign in again", { code: "SESSION_REVOKED" });
  }
  if (String(user.organizationId || "") !== String(claims.organizationId || "")) {
    throw AppError.unauthorized("Session no longer valid, please sign in again", { code: "SESSION_REVOKED" });
  }

  // Platform Admin "entered" mode: the token may carry `act` (an organization
  // id, put there only by POST /auth/enter-org). It is honoured for the
  // Platform Admin role only; the context then is that one organization with
  // Org Admin access. The account itself still has no organization.
  const isPlatformUser = user.role === PLATFORM_ROLE;
  const actingAs = Boolean(claims.act);
  if (actingAs && !isPlatformUser) {
    throw AppError.unauthorized("Session no longer valid, please sign in again", { code: "SESSION_REVOKED" });
  }

  let org = null;
  const orgId = actingAs ? claims.act : user.organizationId;
  if (orgId) {
    org = await loadOrg(orgId);
    if (!org || org.status !== "active") {
      throw AppError.forbidden(
        actingAs
          ? "That organization is not active. Switch to another organization or back to the platform console."
          : "Your organization's access to the platform is currently suspended.",
        { code: actingAs ? "ACT_ORG_INACTIVE" : "ORG_INACTIVE" },
      );
    }
  }

  return {
    userId: String(user._id),
    name: user.name,
    email: user.email,
    role: actingAs ? ORG_ADMIN_ROLE : user.role,
    scope: isPlatformUser && !actingAs ? "platform" : "organization",
    isPlatformUser,
    actingAs,
    organizationId: org ? String(org._id) : null,
    organizationName: org?.name ?? null,
    organizationCode: org?.code ?? null,
    organizationLogoUrl: org?.logoUrl ?? null,
    organizationBrandColor: org?.brandColor ?? "blue",
    organizationStrategy: org?.payrollStrategy ?? null,
    employeeId: !actingAs && user.employee ? String(user.employee) : null,
    mustChangePassword: user.mustChangePassword === true,
    permissions: actingAs
      ? resolvePermissions(ORG_ADMIN_ROLE)
      : resolvePermissions(user.role, { grant: user.permissionsGrant, revoke: user.permissionsRevoke }),
  };
}

export default { buildAuthContext, invalidateUserState, invalidateOrgState, sessionFromContext };
