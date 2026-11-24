// wix-http-functions: the response helpers, as plain objects.
function make(status) {
  return (options = {}) => ({ status, headers: options.headers || {}, body: options.body });
}
export const ok = make(200);
export const badRequest = make(400);
export const forbidden = make(403);
export const notFound = make(404);
export const serverError = make(500);
export function response(options = {}) {
  return { status: options.status || 200, headers: options.headers || {}, body: options.body };
}
