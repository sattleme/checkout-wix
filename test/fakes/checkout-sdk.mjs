// A fake of the plugin's bundle of the SDK (checkout-sdk.js), with its exports the plugin uses
// (Sattleme, currencyDigits, installWebCrypto; and qrEncode, the bundle's QR code encoder itself),
// answering from the world the tests set (sdk-world.mjs). Its errors carry what the SDK's do
// (SPEC.md §5: code, retryable, and the invoice, status, preimage, newerFormat or param of some);
// an aborted call rejects with its signal's reason, as the SDK's do.

import { CURRENCY_DIGITS } from "../../node_modules/@sattleme/checkout/dist/currencies.js";

export { encode as qrEncode } from "../../node_modules/uqr/dist/index.mjs";

import { FakeSdkError, RATE, world } from "./sdk-world.mjs";

export { FakeSdkError as SattlemeError };

export function currencyDigits(code) {
  return Object.prototype.hasOwnProperty.call(CURRENCY_DIGITS, code) ? CURRENCY_DIGITS[code] : null;
}

export function installWebCrypto() {
  return true;
}

const seconds = () => Math.floor(Date.now() / 1000);

function pause(ms, signal) {
  if (!ms) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    if (signal) {
      signal.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(signal.reason);
      });
    }
  });
}

async function enter(method, args, signal) {
  world.calls.push({ method, args: JSON.parse(JSON.stringify(args)) });
  if (signal && signal.aborted) throw signal.reason;
  await pause(world.delays.get(method), signal);
  const thrown = world.throws.get(method);
  if (thrown && thrown.left > 0) {
    thrown.left -= 1;
    throw typeof thrown.error === "function" ? thrown.error(args) : thrown.error;
  }
}

function hex(n, length) {
  return n.toString(16).padStart(length, "0").slice(-length);
}

function declared(invoice) {
  const copy = Object.assign({}, invoice, { declaredAt: invoice.createdAt });
  delete copy.rate;
  delete copy.checkoutUrl;
  delete copy.redirectUrl;
  return copy;
}

function statusOf(invoice) {
  const set = world.statuses.get(invoice.paymentHash || invoice.onchainAddress);
  if (set) return typeof set === "function" ? set(seconds()) : set;
  return seconds() <= invoice.expiresAt + 120
    ? { state: "open", expiresAt: invoice.expiresAt, received: "0", rest: null }
    : { state: "expired", received: "0" };
}

export class Sattleme {
  constructor(options) {
    if (typeof options.key !== "string" || !options.key.startsWith("sattleme_ck_")) {
      throw new FakeSdkError("invalid_key", false);
    }
    this.options = options;
    world.clientOptions = Object.assign({}, options, { key: "[key]", logger: !!options.logger });
  }

  toJSON() {
    return {
      teamPublicKey: world.team,
      relays: Array.from({ length: world.relays }, (_, i) => `wss://relay-${i}.test`)
    };
  }

  async merchant({ signal } = {}) {
    await enter("merchant", {}, signal);
    for (const text of world.warnings) this.options.logger.warn(text);
    return Object.assign({}, world.merchant);
  }

  async createInvoice(order, { signal } = {}) {
    await enter("createInvoice", order, signal);
    const now = seconds();
    const earlier = (world.registry.get(order.ref) || []).slice(-1)[0];
    if (earlier) {
      const status = statusOf(earlier);
      if (status.state === "paid") {
        throw new FakeSdkError("order_paid", false, {
          invoice: declared(earlier),
          status,
          preimage: status.method === "lightning" ? status.preimage : null
        });
      }
      if (status.state !== "expired") {
        world.made += 1;
        throw new FakeSdkError("invoice_pending", false, { invoice: declared(earlier) });
      }
    }
    const digits = currencyDigits(order.fiat.currency);
    const minor = BigInt(order.fiat.amount.replace(".", ""));
    const unit = 10n ** BigInt(digits);
    const sats = (minor * 100000000n + RATE * unit - 1n) / (RATE * unit);
    const inBounds =
      sats >= BigInt(world.merchant.minSats) && sats <= BigInt(world.merchant.maxSats);
    const onchain = sats >= 1000n && world.merchant.onchainAddresses > 0;
    if (!inBounds && !onchain) throw new FakeSdkError("invalid_order", false, { param: "fiat" });
    world.made += 1;
    const n = BigInt(world.made);
    const invoice = {
      ref: order.ref,
      bolt11: inBounds ? `lnbc${sats}n1fake${hex(n, 8)}` : null,
      paymentHash: inBounds ? hex(n, 64) : null,
      verifyUrl: inBounds ? `https://breez.tips/lnurlp/verify/${hex(n, 64)}` : null,
      onchainAddress: onchain ? `bc1p${hex(n, 58)}` : null,
      paymentUri: onchain ? `bitcoin:bc1p${hex(n, 58)}?amount=x` : `lightning:lnbc${sats}n1fake`,
      sats: sats.toString(),
      fiat: {
        amount: order.fiat.amount,
        currency: order.fiat.currency,
        minor: minor.toString(),
        digits
      },
      rate: {
        source: "coingecko",
        currency: order.fiat.currency,
        price: RATE.toString(),
        fetchedAt: now,
        time: now
      },
      note: order.note || order.ref,
      createdAt: now,
      expiresAt: now + (order.durationSeconds || 900),
      checkoutUrl: null,
      redirectUrl: null
    };
    world.registry.set(order.ref, (world.registry.get(order.ref) || []).concat([invoice]));
    // Declared, then the answer is slow (the call's deadline may end first): "createInvoice.after".
    await pause(world.delays.get("createInvoice.after"), signal);
    const answer = JSON.parse(JSON.stringify(invoice));
    return world.tamper ? world.tamper(answer) : answer;
  }

  async getStatus(invoice, { signal } = {}) {
    await enter("getStatus", { ref: invoice.ref, paymentHash: invoice.paymentHash }, signal);
    return JSON.parse(JSON.stringify(statusOf(invoice)));
  }
}
