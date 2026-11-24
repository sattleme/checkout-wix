// The names the plugin uses in a Wix site, each of them its own (sattleme-checkout,
// sattlemeCheckout, SattlemeCheckout): another plugin's names never touch them.
// ECMAScript 2020 syntax only, in every file of this folder: the level Wix documents for site code.

export const PLUGIN_VERSION = "1.0.0";
// The SDK the bundle (checkout-sdk.js) holds, and the specification it follows: sdk/PIN.json's
// (the build refuses others).
export const SDK_VERSION = "1.0.0";
export const SPEC_VERSION = "1.0.0";

// Secrets Manager: the integration key (required) and the status page's token (optional).
export const KEY_SECRET = "sattleme-checkout-key";
export const STATUS_TOKEN_SECRET = "sattleme-checkout-status-token";

// The Wix Data collection, readable and writable by the backend only (Admin permissions).
export const COLLECTION = "SattlemeCheckout";

// HTTP functions (backend/http-functions.js): /_functions/<name>. The customer's payment page, the
// merchant's status page, and their stylesheet.
export const PAY_FUNCTION = "sattlemeCheckoutPay";
export const STATUS_FUNCTION = "sattlemeCheckoutStatus";
export const STYLE_FUNCTION = "sattlemeCheckoutStyle";

// The time the customer has to pay an invoice, in minutes: the connection's setting, 1 to 60
// (SPEC.md §17: an invoice lives 60 to 3600 s), 15 suggested to the merchant. Wix does not let a
// field be empty (measured); one that reaches the plugin empty, or none, is taken as 15.
export const DEFAULT_MINUTES_TO_PAY = 15;
export const MIN_MINUTES_TO_PAY = 1;
export const MAX_MINUTES_TO_PAY = 60;
// The checks that try a comment, a notification or a task (one try per check), before going
// without it ("failed", its reason on the status page).
export const REPORT_TRIES = 10;

// A payment check is final 120 s after the invoice's end (SPEC.md §22).
export const GRACE_SECONDS = 120;

// Time budgets, in milliseconds, each well inside its Wix limit (measured on a Wix site: a backend
// request ends at 14 s, Wix calls createTransaction again after about 15 s, a scheduled job is
// stopped after about 305 s). The SDK's own timeouts bound each relay round and HTTP request; the
// deadline bounds the whole call, whatever the number of steps (README, "Time limits"). A check
// holds its payment's lock for its deadline at most: well under LOCK_MS.
export const TIMEOUTS = {
  createTransaction: { relayMs: 3000, httpMs: 3000, deadlineMs: 8000 },
  connect: { relayMs: 3000, httpMs: 3000, deadlineMs: 9000 },
  page: { relayMs: 3000, httpMs: 3000, deadlineMs: 7000 },
  status: { relayMs: 3000, httpMs: 3000, deadlineMs: 7000 },
  job: { relayMs: 4000, httpMs: 4000, deadlineMs: 12000 }
};

// Prices in a currency are converted at the first of these that answers (the SDK asks them one
// after the other): two sources with many currencies, so that one down is no outage, and at most
// two HTTP timeouts in the worst case.
export const RATE_SOURCES = ["coingecko", "coinbase"];

// The background job (backend/jobs.config): one, hourly. A run lasts up to this long (Wix stops a
// job after about 305 s, measured), then leaves what remains to the next run.
export const JOB_LIFE_MS = 290000;

// A lock (an insert of a fixed _id) is taken over once this old: its holder died.
export const LOCK_MS = 60000;
