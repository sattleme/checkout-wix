// The plugin's bundle of the SDK (backend/sattleme-checkout/checkout-sdk.js of a Wix site): the
// pinned @sattleme/checkout (sdk/), unchanged, with what it imports (`ws`, @noble/*), and the QR
// code encoder of the payment page (uqr), as one CommonJS file of ECMAScript 2020; and the one
// addition a Wix site's backend needs, measured there: Node 18.17.1 keeps the Web Crypto API in
// its `crypto` module, and has no `globalThis.crypto`, which the SDK and @noble/* read. The bundle
// holds no key and contacts nothing by itself.

import { webcrypto } from "crypto";

export * from "@sattleme/checkout";
export { encode as qrEncode } from "uqr";

/**
 * Gives this runtime the Web Crypto global, Node's own (`require("crypto").webcrypto`), when it
 * has none; never replaces one. Whether `globalThis.crypto.getRandomValues` is then there.
 */
export function installWebCrypto() {
  if (!globalThis.crypto || typeof globalThis.crypto.getRandomValues !== "function") {
    Object.defineProperty(globalThis, "crypto", {
      value: webcrypto,
      configurable: true,
      enumerable: false,
      writable: true
    });
  }
  return !!globalThis.crypto && typeof globalThis.crypto.getRandomValues === "function";
}
