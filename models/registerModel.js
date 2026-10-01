import { tenantScopePlugin } from "./plugins/tenantScope.js";

/**
 * Register a schema on a specific connection, reusing an existing compiled model
 * if one is already present. This keeps `node --watch` reloads from throwing
 * "Cannot overwrite model once compiled".
 *
 * Any schema with an `organizationId` path is organization-owned and gets the
 * tenant-scope plugin automatically — isolation is applied by construction,
 * not by remembering to opt in. `tenant` passes plugin options through
 * (e.g. `{ refGuard: false }` for the append-only audit log).
 */
export function registerModel(connection, name, schema, { tenant = {} } = {}) {
  if (connection.models[name]) return connection.models[name];
  if (schema.path("organizationId")) schema.plugin(tenantScopePlugin, tenant);
  return connection.model(name, schema);
}

export default registerModel;
