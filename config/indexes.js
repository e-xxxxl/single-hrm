import { logger } from "../utils/logger.js";

/**
 * One-off index migrations for databases created before an index definition
 * changed. Mongoose never alters an existing index, so an old definition would
 * keep applying (and a new one fail to build) until it is dropped.
 *
 * Idempotent: does nothing once the collection already has the new index.
 */
const REPLACED = [
  // `code` used to be a plain sparse unique index → a second code-less record per organization collided.
  { model: "Department", name: "organizationId_1_code_1" },
  { model: "Branch", name: "organizationId_1_code_1" },
];

export async function migrateIndexes(connection) {
  for (const { model, name } of REPLACED) {
    const Model = connection.models[model];
    if (!Model) continue;
    try {
      const indexes = await Model.collection.indexes().catch(() => []); // collection may not exist yet
      const old = indexes.find((i) => i.name === name && !i.partialFilterExpression);
      if (old) {
        await Model.collection.dropIndex(name);
        logger.info(`[db] replaced index ${model}.${name}`);
      }
      await Model.createIndexes();
    } catch (err) {
      logger.warn(`[db] index migration for ${model} failed: ${err.message}`);
    }
  }
}

/**
 * One-off: the four organizations were first seeded with placeholder theme
 * colours; they now use colours taken from their logos. Only an organization
 * still on its original placeholder is changed — a colour someone picked in
 * Settings is never overwritten.
 */
const BRANDING = [
  { code: "ESIAT", from: "blue", to: "navy" },
  { code: "PWWE", from: "green", to: "plum" },
  { code: "SJI", from: "purple", to: "forest" },
];

export async function migrateBranding(connection) {
  const Organization = connection.models.Organization;
  if (!Organization) return;
  for (const { code, from, to } of BRANDING) {
    try {
      const res = await Organization.updateOne({ code, brandColor: from }, { $set: { brandColor: to } });
      if (res.modifiedCount) logger.info(`[db] ${code} theme colour ${from} → ${to}`);
    } catch (err) {
      logger.warn(`[db] branding migration for ${code} failed: ${err.message}`);
    }
  }
}

export default migrateIndexes;
