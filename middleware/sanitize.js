/**
 * Strip MongoDB operator keys (`$gt`, `$ne`, `$where`, …) and dotted keys from
 * everything the client controls, so a value that a service drops straight
 * into a filter (`?status[$ne]=x`, `{ "email": { "$gt": "" } }`) can only ever
 * be a literal. Zod validators already reject most of this on the routes that
 * use them; this covers every route uniformly.
 */
function clean(value, depth = 0) {
  if (depth > 20 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => clean(v, depth + 1));
  if (Buffer.isBuffer(value) || value instanceof Date) return value;
  for (const key of Object.keys(value)) {
    if (key.startsWith("$") || key.includes(".")) {
      delete value[key];
    } else {
      value[key] = clean(value[key], depth + 1);
    }
  }
  return value;
}

export function sanitizeRequest(req, _res, next) {
  if (req.body && typeof req.body === "object") req.body = clean(req.body);
  if (req.query && typeof req.query === "object") clean(req.query);
  if (req.params && typeof req.params === "object") clean(req.params);
  next();
}

export default sanitizeRequest;
