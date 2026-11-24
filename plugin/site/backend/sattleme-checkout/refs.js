// An order's reference (SPEC.md §17) and the other identifiers the plugin makes.

import crypto from "crypto";

const REF_PATTERN = /^[A-Za-z0-9._:-]{1,64}$/;

export function randomHex(bytes) {
  return crypto.randomBytes(bytes).toString("hex");
}

export function sha256Hex(text) {
  return crypto.createHash("sha256").update(String(text), "utf8").digest("hex");
}

/** Constant-time comparison of two strings, through their SHA-256. */
export function sameSecret(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const x = crypto.createHash("sha256").update(a, "utf8").digest();
  const y = crypto.createHash("sha256").update(b, "utf8").digest();
  return crypto.timingSafeEqual(x, y);
}

/**
 * The part of a reference that names the order: its Wix id as it is (a UUID: 36 characters of
 * hex and "-"), or a hash of anything else. Never personal: an id Wix makes.
 */
function orderPart(orderKey) {
  return /^[A-Za-z0-9-]{1,36}$/.test(orderKey) ? orderKey : sha256Hex(orderKey).slice(0, 32);
}

/**
 * A new reference for an order (SPEC.md §17), drawn on the server at the order's first invoice:
 * the order's id, to find it, then 128 random bits of the CSPRNG (base64url, 22 characters), so
 * that nothing else that holds the key (another shop, this site restored from a backup or copied)
 * ever makes the same one for another order. "wix.<36>.<22>": 63 characters at most.
 */
export function newRef(orderKey) {
  const ref = `wix.${orderPart(orderKey)}.${crypto.randomBytes(16).toString("base64url")}`;
  if (!REF_PATTERN.test(ref)) throw new Error("a reference out of SPEC.md §17's pattern");
  return ref;
}

/** What the invoice shows to the customer and the merchant (SPEC.md §17, `note`): no personal data. */
export function noteOf(orderKey) {
  return `Wix ${orderPart(orderKey).slice(0, 8)}`;
}

/**
 * Wix's id of the plugin's transaction `n` (1, 2…) of the order of reference `ref` (Wix's
 * pluginTransactionId): the reference, then the transaction's number, so that the merchant
 * finds the sale in the sattle.me app from Wix's payment line: "wix.<order id>.<22>.1".
 */
export function transactionIdOf(ref, n) {
  const id = `${ref}.${n}`;
  if (typeof ref !== "string" || !REF_PATTERN.test(ref) || !Number.isSafeInteger(n) || n < 1) {
    throw new Error("a transaction id of no reference");
  }
  return id;
}
