// @wix/essentials (Wix's JavaScript SDK): auth.elevate gives the function back.
export const auth = {
  elevate(fn) {
    return (...args) => fn(...args);
  }
};
