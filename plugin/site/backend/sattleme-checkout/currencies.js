// Wix's fraction digits of each currency: how many of an amount's minor units Wix's
// createTransaction gives (`order.description.totalAmount`, a string of minor units). From Wix's
// table "Currencies", https://dev.wix.com/docs/api-reference/business-management/payments/payment-service-provider-service-plugin/currencies,
// as read on 14 October 2026 (161 currencies). They are Wix's, not the specification's: an
// amount is converted from these to the decimals of checkout-spec's currencies.json (the SDK's
// currencyDigits), exactly or not at all (amounts.js).

const BY_DIGITS = {
  0: ["BIF CLP DJF GNF ISK JPY KMF KRW PYG RWF UGX VND VUV XAF XOF XPF"].join(" "),
  2: [
    "AED AFN ALL AMD ANG AOA ARS AUD AWG AZN BAM BBD BDT BGN BMD BND BOB BOV BRL BSD BTN BWP",
    "BYN BZD CAD CDF CHE CHF CHW CNY COP COU CRC CUC CUP CVE CZK DKK DOP DZD EGP ERN ETB EUR",
    "FJD FKP GBP GEL GHS GIP GMD GTQ GYD HKD HNL HRK HTG HUF IDR ILS INR IRR JMD KES KGS KHR",
    "KPW KYD KZT LAK LBP LKR LRD LSL MAD MDL MGA MKD MMK MNT MOP MRU MUR MVR MWK MXN MXV MYR",
    "MZN NAD NGN NIO NOK NPR NZD PAB PEN PGK PHP PKR PLN QAR RON RSD RUB SAR SBD SCR SDG SEK",
    "SGD SHP SLL SOS SRD SSP STN SVC SYP SZL THB TJS TMT TOP TRY TTD TWD TZS UAH USD UYU UZS",
    "VES WST XCD YER ZAR ZMW"
  ].join(" "),
  3: ["BHD IQD JOD KWD LYD OMR TND"].join(" ")
};

const DIGITS = {};
for (const digits of Object.keys(BY_DIGITS)) {
  for (const code of BY_DIGITS[digits].split(" ")) DIGITS[code] = Number(digits);
}

/** Wix's fraction digits of `code`, or null for a currency Wix's table does not have. */
export function wixDigits(code) {
  return typeof code === "string" && Object.prototype.hasOwnProperty.call(DIGITS, code)
    ? DIGITS[code]
    : null;
}
