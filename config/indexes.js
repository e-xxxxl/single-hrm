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

export default migrateIndexes;
