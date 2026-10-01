/**
 * Run a Zod schema against part of the request and replace it with the parsed
 * (and coerced) value. A ZodError is forwarded to the global error handler,
 * which renders it as a 422 with field-level details.
 *
 *   router.post("/", validate(schema), handler)          // body
 *   router.get("/", validate(schema, "query"), handler)  // query string
 */
export function validate(schema, source = "body") {
  return function runValidation(req, _res, next) {
    const result = schema.safeParse(req[source]);
    if (!result.success) return next(result.error);
    req[source] = result.data;
    next();
  };
}

export default validate;
