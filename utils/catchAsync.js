/**
 * Wrap an async route handler so a rejected promise is forwarded to Express's
 * error middleware instead of becoming an unhandled rejection.
 *
 *   router.get("/", catchAsync(async (req, res) => { ... }));
 */
export function catchAsync(handler) {
  return function wrapped(req, res, next) {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

export default catchAsync;
