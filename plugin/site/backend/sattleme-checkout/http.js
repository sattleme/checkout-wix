// The plugin's public addresses (HTTP functions, exported by backend/http-functions.js):
//
// - /_functions/sattlemeCheckoutPay?o=<payment>&k=<key>: the customer's payment page, where Wix
//   sends them (createTransaction). The key is the customer's transaction's own (32 hex, drawn by
//   createTransaction), so the address reaches that payment alone. Each view checks the payment
//   (getStatus, at most every 5 s per payment: a view within 5 s of the last check, decided from
//   its read of the payment, shows that check, and writes nothing), then shows its invoice while
//   it can be paid or is being confirmed, or, once the payment is final, sends the customer to the
//   Wix page of its state: success when paid (once Wix was told: until then, the page says the
//   order is being recorded), pending when it needs the merchant, error when the invoice expired.
//   An underpayment that expired shows what came of what was due, and the way to Wix's pending
//   page, never a way to pay again.
//   It reveals nothing else, and changes nothing but what the check finds: a replay only checks
//   again, a forged request finds no payment. Never marked paid because of a request (SPEC.md
//   §27): only a check's paid status does that.
//
// - /_functions/sattlemeCheckoutStatus: the status page, for the merchant. GET shows a form; POST
//   with the status token (Secrets Manager, sattleme-checkout-status-token) shows the page. The
//   token goes in the form's body, never in an address (history, logs, referrers). The page also
//   keeps the site's URL, which the payment pages' addresses need.
//
// - /_functions/sattlemeCheckoutStyle: the pages' stylesheet (pages.js).

import { badRequest, forbidden, notFound, ok, response } from "wix-http-functions";

import {
  PLUGIN_VERSION,
  SDK_VERSION,
  SPEC_VERSION,
  STATUS_TOKEN_SECRET,
  TIMEOUTS
} from "./constants.js";
import { acceptedLanguage, t } from "./i18n.js";
import {
  HTML_HEADERS,
  STYLESHEET,
  STYLE_HEADERS,
  messagePage,
  paymentPage,
  statusPage,
  tokenPage,
  underpaidPage
} from "./pages.js";
import {
  awaitingWix,
  checkPayment,
  checkedWithin,
  finalTarget,
  isFinal,
  newContext,
  transactionOfKey
} from "./payments.js";
import { sameSecret } from "./refs.js";
import { logError } from "./safety.js";
import * as store from "./store.js";
import { readSecret, siteTimeZone } from "./wix.js";

// A payment page checks its payment at most this often, and waits this long at most for a check
// that holds it (another view's, a background job's), reading its lock.
const PAGE_CHECK_EVERY_MS = 5000;
const PAGE_LOCK_WAIT_MS = 2000;

function header(request, name) {
  const headers = (request && request.headers) || {};
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === name) return String(headers[key]).slice(0, 500);
  }
  return null;
}

function html(make, body) {
  return make({ headers: HTML_HEADERS, body });
}

function invalidLink(request) {
  const language = acceptedLanguage(header(request, "accept-language"));
  return html(notFound, messagePage(language, "link.title", "link.invalid"));
}

/**
 * GET /_functions/sattlemeCheckoutPay: the payment page. It checks the payment, then shows its
 * invoice, or sends the customer to the Wix page of its final state.
 */
export async function payRequest(request) {
  const query = (request && request.query) || {};
  const paymentId = query.o;
  const key = query.k;
  if (!store.isPaymentId(paymentId) || typeof key !== "string" || !/^[0-9a-f]{32}$/.test(key)) {
    return invalidLink(request);
  }
  let item = await store.readPayment(paymentId).catch(() => null);
  let tx = item ? transactionOfKey(item.data, key) : null;
  if (!tx || !item.data.invoice) return invalidLink(request);
  // Checked within 5 s (another view, a tab, the button, a script with the address): shown as
  // that check left it, without a lock: a read, no write.
  if (item.active && !checkedWithin(item.data, PAGE_CHECK_EVERY_MS, Date.now())) {
    try {
      const result = await checkPayment(paymentId, item.data.lockGen, newContext(TIMEOUTS.page), {
        waitMs: PAGE_LOCK_WAIT_MS,
        minIntervalMs: PAGE_CHECK_EVERY_MS
      });
      if (result.item) {
        item = result.item;
        tx = transactionOfKey(item.data, key) || tx;
      }
    } catch (error) {
      logError("the check of a payment page failed", error);
    }
  }
  const data = item.data;
  if (data.state === "attention" && data.attention && data.attention.reason === "underpaid") {
    // Underpaid, then expired: the order is not paid, and nothing more can pay it. What came, as
    // the merchant's note says it; Wix's pending page says nothing of it.
    const language = tx.language || acceptedLanguage(header(request, "accept-language"));
    return html(
      ok,
      underpaidPage(language, {
        received: data.received,
        sats: data.invoice.sats,
        back: tx.returnUrls.pendingUrl || tx.returnUrls.successUrl
      })
    );
  }
  // Paid, Wix not told yet (its approval refused, to be sent again): the customer waits here, as
  // Wix's success page before its approval would leave the order unpaid.
  if (isFinal(data) && !awaitingWix(data)) {
    const target = finalTarget(data, tx);
    if (!target) return invalidLink(request);
    return response({
      status: 303,
      headers: { Location: target, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
      body: ""
    });
  }
  const language = tx.language || acceptedLanguage(header(request, "accept-language"));
  return html(ok, paymentPage(language, paymentView(data, tx, paymentId, key)));
}

/** What the payment page shows of a payment that can be paid, or is being confirmed. */
function paymentView(data, tx, paymentId, key) {
  const invoice = data.invoice;
  const now = Math.floor(Date.now() / 1000);
  // The rest of an on-chain underpayment, while the invoice can be paid (SDK: open).
  const rest = data.state === "open" ? data.rest : null;
  return {
    paymentId,
    key,
    state: data.state,
    sats: invoice.sats,
    price: data.price ? `${data.price.amount} ${data.price.currency}` : null,
    secondsLeft: Math.max(0, invoice.expiresAt - now),
    received: data.received,
    rest: rest ? { sats: rest.sats, bolt11: rest.bolt11, paymentUri: rest.paymentUri } : null,
    paymentUri: invoice.paymentUri,
    bolt11: invoice.bolt11,
    address: invoice.onchainAddress,
    confirmations: data.confirmations,
    back: tx.returnUrls.pendingUrl || tx.returnUrls.successUrl
  };
}

/**
 * The Node.js version the site's backend runs ("v18.17.1"), which Wix does not document: shown on
 * the status page, for the merchant and the tests on a real site; "?" when the runtime does not say.
 */
export function nodeVersion() {
  const version = typeof process === "object" && process && process.version;
  return typeof version === "string" && /^v[0-9]{1,3}(\.[0-9]{1,4}){2}$/.test(version)
    ? version
    : "?";
}

/** GET /_functions/sattlemeCheckoutStyle: the pages' stylesheet. */
export function styleRequest() {
  return ok({ headers: STYLE_HEADERS, body: STYLESHEET });
}

/** GET /_functions/sattlemeCheckoutStatus: the form that asks for the token. */
export async function statusForm() {
  const ctx = newContext(TIMEOUTS.status);
  return html(ok, tokenPage(await ctx.language()));
}

/** POST /_functions/sattlemeCheckoutStatus: the status page, with the right token. */
export async function statusRequest(request) {
  const ctx = newContext(TIMEOUTS.status);
  const language = await ctx.language();
  const expected = await readSecret(STATUS_TOKEN_SECRET);
  if (!expected || expected.length < 32) {
    return html(forbidden, tokenPage(language, t(language, "status.noToken")));
  }
  let token = null;
  try {
    token = new URLSearchParams(await request.body.text()).get("t");
  } catch (error) {
    return html(badRequest, tokenPage(language, t(language, "status.wrongToken")));
  }
  if (!sameSecret(token, expected)) {
    return html(forbidden, tokenPage(language, t(language, "status.wrongToken")));
  }
  await store.ensureCollection();
  const site = await keepSiteUrl(request.baseUrl);
  return html(ok, statusPage(language, await statusView(ctx, site)));
}

/** Keeps the site's URL of HTTP functions, an https one, for the payment pages' addresses. */
async function keepSiteUrl(baseUrl) {
  const url = typeof baseUrl === "string" ? baseUrl.replace(/\/+$/, "") : "";
  const valid = /^https:\/\/[^\s"'<>?#\\]+\/_functions$/.test(url) && url.length <= 1500;
  if (valid) await store.saveConfig("site", { baseUrl: url, savedAt: Date.now() });
  return { url: url || null, valid };
}

async function merchantView(ctx) {
  try {
    const client = await ctx.client();
    const merchant = await client.merchant(AbortSignal.timeout(ctx.timeouts.deadlineMs));
    return {
      ok: true,
      business: merchant.businessName,
      min: merchant.minSats,
      max: merchant.maxSats,
      addresses: String(merchant.onchainAddresses)
    };
  } catch (failure) {
    return { ok: false, code: (failure && failure.code) || "unexpected" };
  }
}

function paymentRow(item) {
  const data = item.data;
  return {
    ref: data.ref,
    state: data.state,
    received: data.received,
    due: data.invoice ? data.invoice.sats : null,
    address: data.invoice && data.invoice.onchainAddress ? data.invoice.onchainAddress : null,
    expiresAt: data.invoice ? data.invoice.expiresAt * 1000 : null,
    lastCheck: data.lastCheck,
    error: data.lastError ? data.lastError.code : null,
    orderId: data.orderId,
    reason: data.attention ? data.attention.reason : null,
    task: data.report && data.report.task ? data.report.task : null,
    // Why the task failed last, and how many checks tried it (payments.js, sendReport).
    taskError:
      data.report && data.report.errors && typeof data.report.errors.task === "string"
        ? data.report.errors.task
        : null,
    tries: data.report && typeof data.report.tries === "number" ? data.report.tries : 0,
    at: data.attention ? data.attention.at : null
  };
}

async function statusView(ctx, site) {
  const keyPresent = !!(await ctx.key());
  const [merchant, connection, connected, runs, active, recent, refusals, warnings, timeZone] =
    await Promise.all([
      keyPresent ? merchantView(ctx) : Promise.resolve(null),
      store.readConfig("connection").catch(() => null),
      store.readConfig("merchant").catch(() => null),
      store.latest("run", 24),
      store.activePayments(50),
      store.latest("payment", 100),
      store.latest("refusal", 20),
      store.latest("warning", 10),
      siteTimeZone()
    ]);
  // The last connection in the payment settings, when it was refused: Wix may refuse the payment
  // method until one succeeds (payments.js, connectRefused).
  const connectedAt =
    connected && typeof connected.connectedAt === "number" ? connected.connectedAt : 0;
  const refusedConnection =
    connection && typeof connection.refusedAt === "number" && connection.refusedAt > connectedAt
      ? { at: connection.refusedAt, code: String(connection.errorCode) }
      : null;
  return {
    now: Date.now(),
    versions: { plugin: PLUGIN_VERSION, sdk: SDK_VERSION, spec: SPEC_VERSION, node: nodeVersion() },
    // The site's time zone, which the page's times are in (pages.js).
    timeZone,
    keyPresent,
    merchant,
    // The time to pay of the last connection that succeeded.
    minutesToPay:
      connected && typeof connected.minutesToPay === "number" ? connected.minutesToPay : null,
    refusedConnection,
    site,
    runs: runs
      .map((item) => item.data)
      .filter((run) => run && typeof run.startedAt === "number")
      .sort((a, b) => b.startedAt - a.startedAt),
    open: active.filter((item) => !isFinal(item.data)).map(paymentRow),
    attention: recent
      .filter((item) => item.data.state === "attention")
      .slice(0, 20)
      .map(paymentRow),
    refusals: refusals.map((item) => item.data),
    warnings: warnings.map((item) => Object.assign({ at: item.dueAt }, item.data))
  };
}
