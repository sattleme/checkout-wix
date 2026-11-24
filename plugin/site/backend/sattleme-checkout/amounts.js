// The price of a Wix payment, as the SDK takes it: a decimal string in a currency of
// checkout-spec's currencies.json (SPEC.md §25), exactly the amount Wix records as due, never a
// float and never rounded. Wix gives it in its own minor units (currencies.js); the specification
// may give the currency fewer decimals (13 currencies have 0 there), so an amount that does not
// fit them is refused, not rounded.

/* global BigInt */

import { wixDigits } from "./currencies.js";

const MAX_MINOR = BigInt(Number.MAX_SAFE_INTEGER); // SPEC.md §25: minor from 1 to 2^53 − 1

/**
 * The price of Wix's `totalAmount` (a string of minor units, Wix's fraction digits) in `currency`,
 * for a currency of `specDigits` decimals (the SDK's currencyDigits; null: not one of the
 * specification's). `{ price: { amount, currency, minor, digits } }`, or `{ refused }`:
 * "currency" (not Wix's, or not the specification's), "amount" (not a positive whole number of
 * minor units), or "precision" (more decimals than the specification's currency has).
 */
export function priceOf(totalAmount, currency, specDigits) {
  const fromWix = wixDigits(currency);
  if (fromWix === null || typeof specDigits !== "number") return { refused: "currency" };
  const minorText = minorUnits(totalAmount);
  if (minorText === null) return { refused: "amount" };
  const wixMinor = BigInt(minorText);
  if (wixMinor <= 0n) return { refused: "amount" };
  let minor;
  if (specDigits >= fromWix) {
    minor = wixMinor * 10n ** BigInt(specDigits - fromWix);
  } else {
    const divisor = 10n ** BigInt(fromWix - specDigits);
    if (wixMinor % divisor !== 0n) return { refused: "precision" };
    minor = wixMinor / divisor;
  }
  if (minor > MAX_MINOR) return { refused: "amount" };
  return {
    price: {
      amount: decimal(minor, specDigits),
      currency,
      minor: minor.toString(),
      digits: specDigits
    }
  };
}

/** Wix's minor units as a string of digits: a string of digits, or a safe whole number. */
function minorUnits(value) {
  if (typeof value === "string" && /^[0-9]{1,18}$/.test(value)) return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
  return null;
}

/** `minor` written with exactly `digits` decimals: 2450n, 2 → "24.50". */
export function decimal(minor, digits) {
  const text = minor.toString().padStart(digits + 1, "0");
  return digits === 0 ? text : `${text.slice(0, -digits)}.${text.slice(-digits)}`;
}

/**
 * Whether two decimal strings are the same number ("12.3" and "12.30"); false for anything that is
 * not a plain decimal (a sign, an exponent, a float).
 */
export function sameDecimal(a, b) {
  const pattern = /^([0-9]+)(?:\.([0-9]+))?$/;
  const x = typeof a === "string" ? pattern.exec(a) : null;
  const y = typeof b === "string" ? pattern.exec(b) : null;
  if (!x || !y) return false;
  const norm = (m) => {
    const whole = m[1].replace(/^0+(?=[0-9])/, "");
    const fraction = (m[2] || "").replace(/0+$/, "");
    return `${whole}.${fraction}`;
  };
  return norm(x) === norm(y);
}

/**
 * Whether an invoice the SDK gives for this order (invoice_pending, order_paid) is of `price`: the
 * same currency and minor units. An invoice in sats, or of another price, is not.
 */
export function invoiceMatches(invoice, price) {
  const fiat = invoice && invoice.fiat;
  return (
    !!fiat &&
    fiat.currency === price.currency &&
    String(fiat.minor) === price.minor &&
    fiat.digits === price.digits
  );
}

/** A plain decimal string ("24.50"): its digits as a whole number and its scale; else null. */
function parseDecimal(text) {
  const match = typeof text === "string" ? /^([0-9]{1,18})(?:\.([0-9]{1,18}))?$/.exec(text) : null;
  if (!match) return null;
  const fraction = match[2] || "";
  return { units: BigInt(match[1] + fraction), scale: fraction.length };
}

/** `value` (units at its scale) in units of scale `scale` (no lower than its own). */
function scaled(value, scale) {
  return value.units * 10n ** BigInt(scale - value.scale);
}

/**
 * What a Wix order still has due for this payment, against the invoice's `price`: its total now
 * (priceSummary.total) less what its other payments paid (balanceSummary.paid: a gift card, say),
 * in its currency. `{ same, total, due, currency }` (decimal strings; `same` when it is the
 * price, in its currency), or null when Wix gives no total that is a plain decimal.
 */
export function orderDue(order, price) {
  const summary = order && order.priceSummary;
  const total = parseDecimal(summary && summary.total ? summary.total.amount : undefined);
  const balance = order && order.balanceSummary;
  const paidText = balance && balance.paid && balance.paid.amount ? balance.paid.amount : "0";
  const paid = parseDecimal(paidText);
  if (!total || !paid) return null;
  const currency = typeof order.currency === "string" ? order.currency : price.currency;
  const scale = Math.max(total.scale, paid.scale, price.digits);
  const due = scaled(total, scale) - scaled(paid, scale);
  const invoice = BigInt(price.minor) * 10n ** BigInt(scale - price.digits);
  return {
    same: currency === price.currency && due === invoice,
    total: decimal(scaled(total, total.scale), total.scale),
    due: due < 0n ? `-${decimal(-due, scale)}` : decimal(due, scale),
    currency
  };
}
