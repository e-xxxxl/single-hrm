import mongoose from "mongoose";
import { currentTenantId } from "../../utils/tenantContext.js";
import { AppError } from "../../utils/AppError.js";

/**
 * Tenant-scope plugin — applied automatically (see registerModel.js) to every
 * schema that has an `organizationId` path.
 *
 * While a request's organization is pinned in context (utils/tenantContext.js):
 *   • every query (find, findOne, count, distinct, update*, delete*, replace*)
 *     is narrowed to that organization — including populate()'s child queries,
 *     so a stray foreign id can never pull another organization's document in;
 *     a filter that explicitly names a *different* organization is refused (404);
 *   • every aggregate gets a leading `$match` on the organization;
 *   • updates may not move a document to another organization;
 *   • a new document is stamped with the organization, and saving a document
 *     that belongs to another organization is refused.
 *
 * Always (with or without context), on save/validate:
 *   • every ObjectId reference to another organization-owned model (employee,
 *     department, branch, leave type, reviewer, …) must point at a document in
 *     the *same* organization — a request that smuggles in another tenant's id
 *     is rejected with 400 CROSS_TENANT_REFERENCE.
 */

const QUERY_HOOKS = [
  "countDocuments",
  "distinct",
  "deleteMany",
  "deleteOne",
  "find",
  "findOne",
  "findOneAndDelete",
  "findOneAndReplace",
  "findOneAndUpdate",
  "replaceOne",
  "updateMany",
  "updateOne",
];

/** Normalise an id-ish value to a hex string; `undefined` for operator objects. */
function idString(value) {
  if (value == null) return null;
  if (value instanceof mongoose.Types.ObjectId) return value.toHexString();
  if (typeof value === "string") return value;
  if (typeof value === "object" && value._id) return idString(value._id);
  return undefined;
}

function guardUpdate(update, tenant) {
  if (!update || Array.isArray(update)) return;
  const attempts = [update.organizationId, update.$set?.organizationId, update.$setOnInsert?.organizationId];
  for (const value of attempts) {
    if (value !== undefined && idString(value) !== tenant) {
      throw AppError.forbidden("A record cannot be moved to another organization");
    }
  }
  if (update.$unset && Object.prototype.hasOwnProperty.call(update.$unset, "organizationId")) {
    throw AppError.forbidden("A record cannot be detached from its organization");
  }
}

function collectRefPaths(schema) {
  const refs = [];
  schema.eachPath((path, type) => {
    if (path === "organizationId" || path === "_id") return;
    const ref = type.options?.ref ?? type.caster?.options?.ref;
    if (typeof ref === "string") refs.push({ path, ref });
  });
  return refs;
}

function humanize(modelName) {
  return modelName.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
}

async function assertIdsInOrganization(db, org, ref, path, raw) {
  const values = Array.isArray(raw) ? raw : raw && Array.isArray(raw.$each) ? raw.$each : [raw];
  const ids = [...new Set(values.map(idString).filter(Boolean))];
  if (ids.length === 0) return;

  const Target = db.models[ref];
  if (!Target || !Target.schema.path("organizationId")) return; // e.g. Organization itself

  const valid = ids.every((id) => mongoose.isValidObjectId(id));
  const found = valid ? await Target.countDocuments({ _id: { $in: ids }, organizationId: org }) : 0;
  if (found !== ids.length) {
    throw AppError.badRequest(`Unknown ${humanize(ref)} for this organization`, {
      code: "CROSS_TENANT_REFERENCE",
      details: { path },
    });
  }
}

async function assertRefsInOrganization(doc, refPaths) {
  const org = idString(doc.organizationId);
  if (!org) return;
  for (const { path, ref } of refPaths) {
    if (!doc.isModified(path)) continue;
    await assertIdsInOrganization(doc.constructor.db, org, ref, path, doc.get(path));
  }
}

/** Same check for update queries ($set / $push / $addToSet / bare fields). */
async function assertUpdateRefsInOrganization(query, refPaths, org) {
  const update = query.getUpdate();
  if (!org || !update || Array.isArray(update)) return;
  const sources = [update, update.$set, update.$setOnInsert, update.$push, update.$addToSet].filter(Boolean);
  for (const { path, ref } of refPaths) {
    for (const source of sources) {
      if (source[path] === undefined || source[path] === null) continue;
      await assertIdsInOrganization(query.model.db, org, ref, path, source[path]);
    }
  }
}

const UPDATE_OPS = new Set(["findOneAndUpdate", "updateOne", "updateMany", "replaceOne", "findOneAndReplace"]);

export function tenantScopePlugin(schema, { refGuard = true } = {}) {
  const refPaths = refGuard ? collectRefPaths(schema) : [];

  schema.pre(QUERY_HOOKS, { document: false, query: true }, async function scopeQuery() {
    const tenant = currentTenantId();
    if (tenant) {
      const current = this.getFilter().organizationId;
      if (current === undefined) {
        this.where({ organizationId: tenant });
      } else {
        const named = idString(current);
        if (named === undefined) this.and([{ organizationId: tenant }]);
        else if (named !== tenant) throw AppError.notFound();
      }
      guardUpdate(this.getUpdate(), tenant);
    }
    if (refPaths.length && UPDATE_OPS.has(this.op)) {
      await assertUpdateRefsInOrganization(this, refPaths, tenant || idString(this.getFilter().organizationId));
    }
  });

  schema.pre("aggregate", function scopeAggregate() {
    const tenant = currentTenantId();
    if (!tenant) return;
    const pipeline = this.pipeline();
    const match = { $match: { organizationId: new mongoose.Types.ObjectId(tenant) } };
    // $geoNear / $search must stay the first stage.
    const first = pipeline[0] || {};
    if (first.$geoNear || first.$search) pipeline.splice(1, 0, match);
    else pipeline.unshift(match);
  });

  schema.pre("validate", async function stampAndCheck() {
    const tenant = currentTenantId();
    if (tenant) {
      if (!this.organizationId) this.organizationId = tenant;
      else if (idString(this.organizationId) !== tenant) {
        throw AppError.forbidden("This record belongs to another organization");
      }
    }
    if (refPaths.length) await assertRefsInOrganization(this, refPaths);
  });

  schema.pre("insertMany", function stampMany(next, docs) {
    const tenant = currentTenantId();
    if (!tenant) return next();
    for (const doc of Array.isArray(docs) ? docs : [docs]) {
      if (!doc.organizationId) doc.organizationId = tenant;
      else if (idString(doc.organizationId) !== tenant) {
        return next(AppError.forbidden("This record belongs to another organization"));
      }
    }
    return next();
  });
}

export default tenantScopePlugin;
