/**
 * Helpers for list endpoints: consistent pagination, sorting and response
 * envelope so every table in the client behaves the same way.
 */

const MAX_LIMIT = 100;

export function parsePagination(query = {}) {
  let page = Number.parseInt(query.page, 10);
  let limit = Number.parseInt(query.limit, 10);
  if (!Number.isFinite(page) || page < 1) page = 1;
  if (!Number.isFinite(limit) || limit < 1) limit = 20;
  if (limit > MAX_LIMIT) limit = MAX_LIMIT;
  return { page, limit, skip: (page - 1) * limit };
}

/**
 * Parse a sort string like "name" or "-createdAt,name" into a Mongoose sort
 * object, restricted to an allow-list of fields.
 */
export function parseSort(raw, allowed, fallback = { createdAt: -1 }) {
  if (!raw) return fallback;
  const sort = {};
  for (const token of String(raw).split(",")) {
    const dir = token.startsWith("-") ? -1 : 1;
    const field = token.replace(/^-/, "").trim();
    if (allowed.includes(field)) sort[field] = dir;
  }
  return Object.keys(sort).length ? sort : fallback;
}

/** Standard paginated payload. */
export function paginated(items, total, { page, limit }) {
  return {
    data: items,
    meta: {
      page,
      limit,
      total,
      pages: Math.max(1, Math.ceil(total / limit)),
      hasMore: page * limit < total,
    },
  };
}

/** Escape a user string for safe use inside a RegExp. */
export function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export default { parsePagination, parseSort, paginated, escapeRegex };
