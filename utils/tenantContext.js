import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Request-scoped tenant context.
 *
 * `scopeToOrg` runs the rest of an organization request inside
 * `runWithTenant(orgId, …)`. The tenant-scope Mongoose plugin reads it back so
 * every query / aggregate / save on an organization-owned model is pinned to
 * that organization — even one a service forgot to filter, and even the child
 * queries `populate()` issues. Services still pass `orgId` explicitly; this is
 * the second, structural line of defence.
 *
 * Code that runs outside a request (seed, scheduler, platform admin routes)
 * has no tenant in context and must filter explicitly, as it always has.
 */
const storage = new AsyncLocalStorage();

export function runWithTenant(organizationId, fn) {
  return storage.run({ organizationId: organizationId ? String(organizationId) : null }, fn);
}

/** The organization id pinned to the current async context, or null. */
export function currentTenantId() {
  return storage.getStore()?.organizationId ?? null;
}

/**
 * Run `fn` with tenant pinning switched off. Only for the rare, deliberate
 * platform-wide lookup made during an organization request (e.g. checking that
 * a login email is not already taken by an account in another organization).
 *
 * `fn` must *execute* its queries (`.exec()` / await inside) — Mongoose queries
 * are lazy, and one returned unexecuted runs later, back in the tenant context.
 */
export function withoutTenantScope(fn) {
  return storage.run({ organizationId: null }, fn);
}

export default { runWithTenant, currentTenantId, withoutTenantScope };
