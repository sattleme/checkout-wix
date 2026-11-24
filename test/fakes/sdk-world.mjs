// The world the fake SDK (checkout-sdk.mjs) answers from, set by the tests: the merchant, the
// registry of invoices (one order, one invoice at a time, as SPEC.md §21 says), the status of each
// invoice, and the failures to throw. Prices convert at RATE (a unit of any currency per bitcoin).

export const RATE = 100000n;

export const world = {};

export function resetWorld() {
  Object.assign(world, {
    merchant: {
      businessName: "Sunrise Bakery",
      minSats: "1",
      maxSats: "10000000",
      onchainAddresses: 40
    },
    team: "ab".repeat(32),
    relays: 3,
    // ref -> the invoices declared for it, the latest last.
    registry: new Map(),
    // paymentHash or address -> the status getStatus gives (else open, then expired).
    statuses: new Map(),
    // Method -> an error (or a function giving one) to throw instead, once or `times` times.
    throws: new Map(),
    // Method -> milliseconds a call takes (it stops at its signal).
    delays: new Map(),
    calls: [],
    warnings: [],
    // A function changing createInvoice's answer (an SDK that would answer another price).
    tamper: null,
    made: 0
  });
}

resetWorld();

export class FakeSdkError extends Error {
  constructor(code, retryable, fields) {
    super(`fake SDK error: ${code}`);
    this.name = "SattlemeError";
    this.code = code;
    this.retryable = retryable;
    Object.assign(this, fields || {});
  }
}

/** Makes `method` throw `error` the next `times` calls (default once). */
export function failNext(method, error, times) {
  world.throws.set(method, { error, left: times || 1 });
}

/** Sets the status getStatus gives for the invoice. */
export function setStatus(invoice, status) {
  world.statuses.set(invoice.paymentHash || invoice.onchainAddress, status);
}

export function invoicesOf(ref) {
  return world.registry.get(ref) || [];
}
