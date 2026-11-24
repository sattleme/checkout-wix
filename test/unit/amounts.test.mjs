// The price of a payment (amounts.js): Wix's minor units to the SDK's exact decimal string, or a
// refusal, never a float and never rounded (SPEC.md §25).

import assert from "node:assert/strict";
import { test } from "node:test";

import { site } from "../helpers.mjs";

const { decimal, invoiceMatches, priceOf, sameDecimal } = await site(
  "sattleme-checkout/amounts.js"
);
const { wixDigits } = await site("sattleme-checkout/currencies.js");
const { currencyDigits } = await site("sattleme-checkout/sdk.js");

const price = (amount, currency) => priceOf(amount, currency, currencyDigits(currency));

test("a price is the exact decimal of Wix's minor units", () => {
  assert.deepEqual(price("2450", "CHF"), {
    price: { amount: "24.50", currency: "CHF", minor: "2450", digits: 2 }
  });
  assert.deepEqual(price("5", "EUR").price, {
    amount: "0.05",
    currency: "EUR",
    minor: "5",
    digits: 2
  });
  assert.deepEqual(price("1500", "JPY").price, {
    amount: "1500",
    currency: "JPY",
    minor: "1500",
    digits: 0
  });
  assert.deepEqual(price("12345", "KWD").price, {
    amount: "12.345",
    currency: "KWD",
    minor: "12345",
    digits: 3
  });
  // A safe whole number is read as the string of its digits.
  assert.equal(price(2450, "CHF").price.amount, "24.50");
  // The largest amount the specification allows: 2^53 - 1 minor units.
  assert.equal(price("9007199254740991", "CHF").price.minor, "9007199254740991");
});

test("a currency the specification gives fewer decimals than Wix: exact, or refused", () => {
  // ALL: 2 decimals at Wix, 0 in checkout-spec's currencies.json.
  assert.equal(wixDigits("ALL"), 2);
  assert.equal(currencyDigits("ALL"), 0);
  assert.deepEqual(price("199000", "ALL").price, {
    amount: "1990",
    currency: "ALL",
    minor: "1990",
    digits: 0
  });
  assert.deepEqual(price("199050", "ALL"), { refused: "precision" });
  // IQD: 3 decimals at Wix, 0 in the specification.
  assert.deepEqual(price("25000", "IQD").price.amount, "25");
  assert.deepEqual(price("25001", "IQD"), { refused: "precision" });
});

test("what is not an amount, or not a currency of both, is refused", () => {
  for (const amount of [
    "0",
    "",
    "-1",
    "12.5",
    "1e3",
    " 12",
    "12 ",
    "0x10",
    "1234567890123456789"
  ]) {
    assert.deepEqual(price(amount, "CHF"), { refused: "amount" }, amount);
  }
  for (const amount of [12.5, -1, Number.MAX_SAFE_INTEGER + 2, NaN, null, undefined, {}]) {
    assert.deepEqual(price(amount, "CHF"), { refused: "amount" }, String(amount));
  }
  assert.deepEqual(price("9007199254740992", "CHF"), { refused: "amount" });
  // BTC is not one of Wix's currencies; XYZ of nobody's; CHE (a funds code) not the specification's.
  for (const currency of ["BTC", "XYZ", "chf", "", null, "CHE", "BOV", "USN"]) {
    assert.deepEqual(price("100", currency), { refused: "currency" }, String(currency));
  }
});

test("Wix's and the specification's decimals differ for these currencies only", () => {
  const codes = (
    "AED AFN ALL AMD ANG AOA ARS AUD AWG AZN BAM BBD BDT BGN BHD BIF BMD BND BOB BOV BRL BSD BTN " +
    "BWP BYN BZD CAD CDF CHE CHF CHW CLP CNY COP COU CRC CUC CUP CVE CZK DJF DKK DOP DZD EGP ERN ETB " +
    "EUR FJD FKP GBP GEL GHS GIP GMD GNF GTQ GYD HKD HNL HRK HTG HUF IDR ILS INR IQD IRR ISK JMD JOD " +
    "JPY KES KGS KHR KMF KPW KRW KWD KYD KZT LAK LBP LKR LRD LSL LYD MAD MDL MGA MKD MMK MNT MOP MRU " +
    "MUR MVR MWK MXN MXV MYR MZN NAD NGN NIO NOK NPR NZD OMR PAB PEN PGK PHP PKR PLN PYG QAR RON RSD " +
    "RUB RWF SAR SBD SCR SDG SEK SGD SHP SLL SOS SRD SSP STN SVC SYP SZL THB TJS TMT TND TOP TRY TTD " +
    "TWD TZS UAH UGX USD UYU UZS VES VND VUV WST XAF XCD XOF XPF YER ZAR ZMW"
  ).split(" ");
  assert.equal(codes.length, 161);
  const differ = [];
  const missing = [];
  for (const code of codes) {
    assert.notEqual(wixDigits(code), null, code);
    const spec = currencyDigits(code);
    if (spec === null) missing.push(code);
    else if (spec !== wixDigits(code)) differ.push(`${code} ${wixDigits(code)}>${spec}`);
  }
  // Wix gives more decimals than the merchant's app uses: amounts with them are refused.
  assert.deepEqual(differ, [
    "AFN 2>0",
    "ALL 2>0",
    "IQD 3>0",
    "IRR 2>0",
    "KPW 2>0",
    "LAK 2>0",
    "LBP 2>0",
    "MGA 2>0",
    "MMK 2>0",
    "RSD 2>0",
    "SOS 2>0",
    "SYP 2>0",
    "YER 2>0"
  ]);
  // Funds codes, and currencies no longer in ISO 4217 List One (ANG, BGN, CUC, HRK, SLL): Wix still
  // lists them, the merchant's app never prices in them.
  assert.deepEqual(missing, ["ANG", "BGN", "BOV", "CHE", "CHW", "COU", "CUC", "HRK", "MXV", "SLL"]);
});

test("decimals and comparisons", () => {
  assert.equal(decimal(2450n, 2), "24.50");
  assert.equal(decimal(5n, 3), "0.005");
  assert.equal(decimal(7n, 0), "7");
  assert.equal(sameDecimal("12.3", "12.30"), true);
  assert.equal(sameDecimal("012.30", "12.3"), true);
  assert.equal(sameDecimal("12.3", "12.31"), false);
  assert.equal(sameDecimal("1e1", "10"), false);
  const p = price("2450", "CHF").price;
  assert.equal(
    invoiceMatches({ fiat: { currency: "CHF", minor: "2450", digits: 2, amount: "24.50" } }, p),
    true
  );
  assert.equal(
    invoiceMatches({ fiat: { currency: "CHF", minor: "2451", digits: 2, amount: "24.51" } }, p),
    false
  );
  assert.equal(
    invoiceMatches({ fiat: { currency: "EUR", minor: "2450", digits: 2, amount: "24.50" } }, p),
    false
  );
  assert.equal(invoiceMatches({ fiat: null, sats: "35502" }, p), false);
});
