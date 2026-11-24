// Loaded first in every test process (--require): no test reaches the network. Host names other
// than this machine's do not resolve, and the global fetch refuses every request (the SDK's
// requests go to fakes the tests give it).
"use strict";

const dns = require("dns");

const LOCAL = new Set(["localhost", "127.0.0.1", "::1"]);
function refused(hostname) {
  const error = new Error(`network refused in tests: ${hostname}`);
  error.code = "ENOTFOUND";
  return error;
}
const lookup = dns.lookup;
dns.lookup = function guardedLookup(hostname, options, callback) {
  const done = typeof options === "function" ? options : callback;
  if (!LOCAL.has(hostname)) {
    process.nextTick(() => done(refused(hostname)));
    return {};
  }
  return lookup.call(dns, hostname, options, callback);
};
const promisesLookup = dns.promises.lookup;
dns.promises.lookup = async function guardedPromisesLookup(hostname, options) {
  if (!LOCAL.has(hostname)) throw refused(hostname);
  return promisesLookup.call(dns.promises, hostname, options);
};
globalThis.fetch = async function refusedFetch(url) {
  throw new TypeError(`network refused in tests: ${url}`);
};
