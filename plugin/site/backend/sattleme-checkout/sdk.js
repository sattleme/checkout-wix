// The plugin's only door to the sattle.me SDK (@sattleme/checkout, bundled in
// checkout-sdk.js): a client that takes plain values and fails with SdkFailure, plain data; and to
// the QR code encoder bundled with it. The rest of the plugin never touches the SDK's classes: a
// new version of the SDK changes this file alone, and the tests give the plugin a fake of this
// interface.

import * as bundle from "./checkout-sdk.js";

import { describeError, logWarning, redact } from "./safety.js";

/**
 * The bundle's exports: merged into the release's one file, as a module of it; else the CommonJS
 * bundle beside the modules, however Wix's build hands a CommonJS module to an ES module.
 */
function sdkModule() {
  const loaded = /** @type {*} */ (bundle);
  if (typeof loaded.Sattleme === "function") return loaded;
  if (loaded.default && typeof loaded.default.Sattleme === "function") return loaded.default;
  throw new Error("checkout-sdk.js loaded without the SDK's exports");
}

/** An SDK error (SPEC.md §5), or the end of a call's time (code "deadline"), as data. */
export class SdkFailure extends Error {
  constructor(code, retryable, detail) {
    super(`sattle.me SDK: ${code}`);
    this.name = "SdkFailure";
    this.code = code;
    this.retryable = retryable;
    this.detail = detail || {};
  }
}

function failureOf(error, signal) {
  if (signal && signal.aborted) return new SdkFailure("deadline", true, {});
  if (error && typeof error === "object" && typeof error.code === "string") {
    const detail = { message: describeError(error).message };
    // What some errors carry (SPEC.md §5): the invoice the order already has, its paid status,
    // whether the channel is of a newer format, the invalid parameter.
    for (const name of ["invoice", "status", "preimage", "newerFormat", "param"]) {
      if (error[name] !== undefined) detail[name] = error[name];
    }
    return new SdkFailure(error.code, error.retryable === true, detail);
  }
  return new SdkFailure("unexpected", false, { message: describeError(error).message });
}

async function call(run, signal) {
  try {
    return await run();
  } catch (error) {
    throw failureOf(error, signal);
  }
}

/** The decimals of a currency in checkout-spec's currencies.json, or null (SPEC.md §25). */
export function currencyDigits(code) {
  return sdkModule().currencyDigits(code);
}

/**
 * The modules of the QR code of `text` (ISO/IEC 18004, error correction level M), row by row, true
 * for a dark one, without the quiet zone around them.
 */
export function qrModules(text) {
  return sdkModule().qrEncode(text, { ecc: "M", border: 0 }).data;
}

/** Gives Node 18 (Wix's backend) the Web Crypto global the SDK needs (checkout-sdk.js). */
export function prepareRuntime() {
  return sdkModule().installWebCrypto();
}

// For the tests alone (test/integration): the SDK's HTTP client and WebSocket class, its `fetch`
// and `WebSocket` options, pointed at fakes. The plugin otherwise leaves both to the SDK's
// defaults: the global fetch, and the `ws` package the bundle holds.
let transport = null;

export function useTransport(value) {
  transport = value || null;
}

/**
 * A client of the integration `key`. `timeouts`: the SDK's `relayMs` and `httpMs`, and the
 * `rateSources` to ask; `onWarning` hears each warning of the SDK (masked), which also goes to
 * Wix's logs. Throws SdkFailure ("invalid_key", "invalid_option").
 */
export function openClient(key, timeouts, onWarning) {
  const sdk = sdkModule();
  prepareRuntime();
  const logger = {
    warn(message) {
      const text = redact(message).slice(0, 500);
      logWarning(text);
      if (onWarning) onWarning(text);
    }
  };
  let client;
  try {
    const options = {
      key,
      relayTimeoutMs: timeouts.relayMs,
      httpTimeoutMs: timeouts.httpMs,
      rateSource: timeouts.rateSources,
      logger
    };
    if (transport) Object.assign(options, transport);
    client = new sdk.Sattleme(options);
  } catch (error) {
    throw failureOf(error, null);
  }
  return {
    /** The integration key's team and relays: no secret. */
    identity() {
      const view = client.toJSON();
      return { teamPublicKey: view.teamPublicKey, relays: view.relays.length };
    },
    merchant(signal) {
      return call(() => client.merchant({ signal }), signal);
    },
    createInvoice(order, signal) {
      return call(() => client.createInvoice(order, { signal }), signal);
    },
    getStatus(invoice, signal) {
      return call(() => client.getStatus(invoice, { signal }), signal);
    }
  };
}
