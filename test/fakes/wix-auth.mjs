// wix-auth: elevate() gives the function back, run with the site's permissions.
export function elevate(fn) {
  return (...args) => fn(...args);
}
