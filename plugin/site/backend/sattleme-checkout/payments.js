// The payment of an order, from its first invoice to its last event to Wix: createTransaction's
// work, each check of its payment (the customer's payment page, the background job), and what Wix
// and the merchant are told. Every change of a payment happens under its lock (store.js).
//
// A payment (store.js, kind "payment") is one Wix order's: its reference, its invoice, its state,
// the proof of its payment, and its Wix transactions (each attempt of Wix to charge the order;
// on Wix, a new attempt makes a new order, so one in practice). Its state:
//   "new"          its reference is drawn and kept, no invoice yet (or its creation failed);
//   "open"         its invoice may still be paid (SDK: open);
//   "unconfirmed"  paid on-chain, not 3 confirmations deep yet (SDK: unconfirmed);
//   "paid"         paid (SDK: paid), the order still waiting for it: Wix approves the transaction;
//   "expired"      never paid (SDK: expired, nothing received): Wix declines it (3035);
//   "attention"    the merchant must act: an underpayment expired, a payment of an order canceled
//                  meanwhile, or whose total changed after its invoice was made (paid at the
//                  invoice's amount, never completed so), an invoice of another amount, a payment
//                  still unconfirmed 90 days after its invoice's end. Wix keeps it pending (5009);
//                  the order gets a comment, and the site's owner a task and a notification. Also
//                  a paid order that Wix still shows unpaid after its approval (verifyRecorded), or
//                  whose approval Wix kept refusing: Wix is told nothing more.
// "paid", "expired" and "attention" are final. A final payment is settled once Wix and the
// merchant were told, and a paid order was read back as paid; then nothing touches it again,
// and its locks are removed.
//
// Wix's events (submitEvent), each sent once, never two contradictory ones: pending (5009) at most
// once, from the invoice's first check, then approved or declined (3035) at most once, each
// transaction its own. They go to the transaction Wix waits on: the latest it did not refuse; once
// paid, the one that was current then (data.paidTx), which alone gets the approval, whatever
// transaction Wix makes of the order after it (refused: already paid). An approval Wix keeps
// refusing for a minute, two tries at least, is given up: the merchant is told, as of a paid order
// Wix did not record. createTransaction's answer counts as an event too.
//
// What Wix and the merchant are told goes through an outbox: the payment is saved with what a
// check is about to send marked "sending", then sent, then saved as sent. A later check that finds
// "sending" (the save after it refused, or past Wix Data's time limit, or its lock's lease over)
// does not tell twice: an event counts as sent (an approval is read back, verifyRecorded), a
// comment or a task is looked for on the order or among the dashboard's tasks and made only if it
// is not there, a notification counts as sent.

/* global BigInt */

import { invoiceMatches, orderDue, priceOf } from "./amounts.js";
import {
  DEFAULT_MINUTES_TO_PAY,
  GRACE_SECONDS,
  KEY_SECRET,
  MAX_MINUTES_TO_PAY,
  MIN_MINUTES_TO_PAY,
  PAY_FUNCTION,
  RATE_SOURCES,
  REPORT_TRIES,
  STATUS_FUNCTION
} from "./constants.js";
import { wixDigits } from "./currencies.js";
import { LANGUAGES, clip, languageOf, pickLanguage, t, textOf, tn } from "./i18n.js";
import { newRef, noteOf, randomHex, sameSecret, transactionIdOf } from "./refs.js";
import { describeError, logError, logInfo, logWarning, redact } from "./safety.js";
import { SdkFailure, currencyDigits, openClient } from "./sdk.js";
import * as store from "./store.js";
import * as wix from "./wix.js";

const MINUTE = 60000;
const DAY = 24 * 60 * MINUTE;
// A payment still not final this long after its invoice's end needs the merchant, as one whose
// events and comments could not be delivered for as long is given up (pretix's 90 days too).
const GIVE_UP_MS = 90 * DAY;
// Tries of a comment, a notification or a task (one per check), before going without.
const TRIES = REPORT_TRIES;
// What a report makes, in this order.
const STEPS = ["comment", "notice", "task"];
// A task made by a check whose save was refused is looked for among the tasks made since its
// outbox's time, this much before (Wix's clock and the site's may differ).
const TASK_LOOKBACK_MS = 10 * MINUTE;
// An approval Wix refuses is given up after this many tries over this long at least (the customer
// waits on the payment page meanwhile; the job's next run, hourly, when they left): the merchant
// is told then, as of a paid order Wix did not record.
const APPROVAL_TRIES = 2;
const APPROVAL_PATIENCE_MS = MINUTE;
// Lookups of a paid order before its approval (checkOrder): the check that finds it paid, and the
// next one, at the job's next run when the customer left the page.
const ORDER_LOOKUPS = 2;
// createTransaction waits this long at most for a lock another call holds. Wix asks again, with
// the same transaction, when it had no answer within about 15 s (measured), and may wait 7 s
// before calling the plugin at all (measured, for a connection): the call it asks again may still
// be making the invoice, so its repetition waits longer for that call's answer, within Wix's 14 s.
const LOCK_WAIT_MS = 2500;
const REPEAT_WAIT_MS = 9000;
// The lease a side effect must still have (store.leaseLeft).
const MARGIN_MS = 3000;
// A line cut to fit a text Wix limits (fitLines) keeps this many characters at least, else it is
// left out.
const MIN_CUT = 40;
// A paid order is read back this long after its approval at the earliest, then once more this long
// after that at the earliest (at the job's runs, hourly, or a check of its page), until Wix shows
// it paid: Wix showed a paid order Paid within a minute (measured).
const VERIFY_AFTER_MS = 2 * MINUTE;
const VERIFY_EVERY_MS = 30 * MINUTE;
const VERIFY_LOOKUPS = 2;
// An order's payment status (Wix eCommerce, Order.paymentStatus): paid, or paid then refunded;
// or not paid. Any other (none, UNSPECIFIED) says nothing.
const RECORDED = ["PAID", "PARTIALLY_REFUNDED", "FULLY_REFUNDED"];
const UNRECORDED = [
  "NOT_PAID",
  "PENDING",
  "PARTIALLY_PAID",
  "PENDING_MERCHANT",
  "CANCELED",
  "DECLINED"
];

// Wix's reason codes (Payment Provider service plugin, "Reason Codes").
export const REASON = {
  pending: 5009,
  expired: 3035,
  amount: 3001,
  currency: 3003,
  general: 6000,
  refund: 3022,
  accountInvalid: 2002,
  authorization: 2004,
  accountCurrency: 2009
};

const FINAL = ["paid", "expired", "attention"];

export function isFinal(data) {
  return FINAL.indexOf(data.state) !== -1;
}

function positive(sats) {
  return typeof sats === "string" && /^[0-9]+$/.test(sats) && BigInt(sats) > 0n;
}

/**
 * The transaction Wix's events go to: the one the payment was paid through (data.paidTx), else the
 * latest one createTransaction did not refuse (Wix waits on it), or null.
 */
function eventTarget(data) {
  const paid = data.paidTx ? findTransaction(data, data.paidTx) : null;
  if (paid) return paid;
  for (let i = data.transactions.length - 1; i >= 0; i -= 1) {
    if (data.transactions[i].refused !== true) return data.transactions[i];
  }
  return null;
}

function findTransaction(data, wixTransactionId) {
  return data.transactions.find((tx) => tx.wixTransactionId === wixTransactionId) || null;
}

/** The transaction of a payment page's key, or null. */
export function transactionOfKey(data, key) {
  if (typeof key !== "string" || !/^[0-9a-f]{32}$/.test(key)) return null;
  return data.transactions.find((tx) => sameSecret(tx.pageKey, key)) || null;
}

/* ---------------------------------------------------------------------------------------------
 * The context of a call: the integration key, read once from the Secrets Manager; one SDK client;
 * the merchant's language; the site's URL. Each call (a request, a job's run) makes its own.
 */

export function newContext(timeouts) {
  let key;
  let client = null;
  let language = null;
  let site;
  return {
    timeouts,
    async key() {
      if (key === undefined) key = await wix.readSecret(KEY_SECRET);
      return key;
    },
    /** The SDK client; SdkFailure "no_key" when the Secrets Manager has no key. */
    async client() {
      if (!client) {
        const value = await this.key();
        if (!value) throw new SdkFailure("no_key", false, {});
        client = openClient(
          value,
          { relayMs: timeouts.relayMs, httpMs: timeouts.httpMs, rateSources: RATE_SOURCES },
          rememberWarning
        );
      }
      return client;
    },
    /** The merchant's language: the site's (as connectAccount saw it), one of the plugin's. */
    async language() {
      if (!language) {
        const merchant = await store.readConfig("merchant").catch(() => null);
        language = pickLanguage(
          (merchant && merchant.language) || (await wix.siteLanguage()) || "en"
        );
      }
      return language;
    },
    /** The site's URL of HTTP functions ("https://…/_functions"), as its status page saw it. */
    async siteUrl() {
      if (site === undefined) {
        const saved = await store.readConfig("site").catch(() => null);
        site = saved && typeof saved.baseUrl === "string" ? saved.baseUrl : null;
      }
      return site;
    }
  };
}

/** A warning of the SDK telling it is out of date (SPEC.md §12): kept for the status page. */
function rememberWarning(text) {
  if (!/newer format/i.test(text)) return;
  store.remember("warning", text, { kind: "sdk", text, at: Date.now() }).catch((error) => {
    logError("could not keep a warning of the SDK", error);
  });
}

/**
 * An invoice of 1 000 sats or more made without a deposit address: payable in Lightning only. The
 * SDK says nothing when the lot of addresses is empty or has no free address (SPEC.md §31,
 * "Leasing an address"): kept for the status page, one item for all of them (the last one's
 * reference, and their count), so that an empty lot does not fill the list.
 */
async function rememberLightningOnly(data) {
  logWarning("an invoice was made without an on-chain address: Lightning only");
  await store
    .remember("warning", "lightningOnly", {
      kind: "lightningOnly",
      ref: data.ref,
      at: Date.now()
    })
    .catch((error) => logError("could not keep a warning", error));
}

function deadline(ms) {
  return AbortSignal.timeout(Math.max(100, ms));
}

/* ---------------------------------------------------------------------------------------------
 * Wix's answers to createTransaction, and the reasons of a refusal.
 */

// What each failure of createInvoice means for the payment's transaction.
const REFUSALS = {
  unsupported_currency: { reasonCode: REASON.currency, errorCode: "CURRENCY_NOT_SUPPORTED" },
  bounds: { reasonCode: REASON.amount, errorCode: "AMOUNT_OUT_OF_BOUNDS" },
  onchain_unavailable: { reasonCode: REASON.general, errorCode: "ONCHAIN_UNAVAILABLE" },
  revoked: { reasonCode: REASON.general, errorCode: "INTEGRATION_REMOVED" },
  invalid_key: { reasonCode: REASON.general, errorCode: "INVALID_KEY" },
  no_key: { reasonCode: REASON.general, errorCode: "KEY_MISSING" },
  no_site: { reasonCode: REASON.general, errorCode: "SITE_ADDRESS_UNKNOWN" },
  channel_not_found: { reasonCode: REASON.general, errorCode: "CHANNEL_NOT_FOUND" },
  newer_format: { reasonCode: REASON.general, errorCode: "UPDATE_PLUGIN" },
  network: { reasonCode: REASON.general, errorCode: "TRY_AGAIN" },
  rate: { reasonCode: REASON.general, errorCode: "TRY_AGAIN" },
  deadline: { reasonCode: REASON.general, errorCode: "TRY_AGAIN" },
  busy: { reasonCode: REASON.general, errorCode: "TRY_AGAIN" },
  invalid_invoice: { reasonCode: REASON.general, errorCode: "INVALID_INVOICE" },
  currency: { reasonCode: REASON.currency, errorCode: "CURRENCY_NOT_SUPPORTED" },
  amount: { reasonCode: REASON.amount, errorCode: "INVALID_AMOUNT" },
  precision: { reasonCode: REASON.amount, errorCode: "AMOUNT_NOT_EXACT" },
  paid: { reasonCode: REASON.general, errorCode: "ALREADY_PAID" },
  attention: { reasonCode: REASON.general, errorCode: "NEEDS_MERCHANT" },
  unexpected: { reasonCode: REASON.general, errorCode: "GENERAL_ERROR" }
};

/** The reason of a failure of the SDK, as REFUSALS names it. */
function reasonOf(failure) {
  const code = failure && failure.code;
  if (code === "invalid_order") {
    const param = failure.detail && failure.detail.param;
    return param === "sats" || param === "fiat" ? "bounds" : "unexpected";
  }
  if (code === "channel_not_found" && failure.detail && failure.detail.newerFormat) {
    return "newer_format";
  }
  return Object.prototype.hasOwnProperty.call(REFUSALS, code) ? code : "unexpected";
}

/** A refusal of a payment: Wix declines it, the merchant reads why (status page, logs). */
async function refusal(reason, language, facts, pluginTransactionId) {
  const refused = REFUSALS[reason] || REFUSALS.unexpected;
  const answer = {
    reasonCode: refused.reasonCode,
    errorCode: refused.errorCode,
    errorMessage: t(language, `refusal.${reason}`, facts)
  };
  if (pluginTransactionId) answer.pluginTransactionId = pluginTransactionId;
  logWarning(`payment refused: ${reason} (${refused.errorCode})`);
  const key = `${facts.orderKey || "-"}:${reason}`;
  await store
    .remember("refusal", key, {
      at: Date.now(),
      reason,
      errorCode: refused.errorCode,
      currency: facts.currency || null,
      orderId: facts.orderId || null
    })
    .catch((error) => logError("could not keep a refusal", error));
  return answer;
}

/** Wix sends the customer to the payment page. */
function pageAnswer(tx, pageUrl) {
  return { pluginTransactionId: tx.pluginTransactionId, redirectUrl: pageUrl };
}

function pendingAnswer(tx) {
  tx.sent = "pending";
  tx.sentAt = Date.now();
  return { pluginTransactionId: tx.pluginTransactionId, reasonCode: REASON.pending };
}

function approvedAnswer(data, tx) {
  tx.sent = "approved";
  tx.sentAt = Date.now();
  data.paidTx = tx.wixTransactionId;
  expectRecorded(data, tx.sentAt);
  return { pluginTransactionId: tx.pluginTransactionId };
}

/* ---------------------------------------------------------------------------------------------
 * createTransaction (Payment Provider service plugin): the invoice of the order, and the address
 * of its payment page (http.js), where Wix sends the customer.
 */

function httpsUrl(value) {
  return typeof value === "string" && value.length <= 2048 && /^https:\/\/[^\s"<>]+$/.test(value)
    ? value
    : null;
}

function newPayment(paymentId, orderKey, orderId, now) {
  return {
    _id: paymentId,
    kind: "payment",
    active: false,
    dueAt: now,
    data: {
      v: 1,
      orderKey,
      orderId,
      orderNumber: null,
      contactId: null,
      ref: null,
      note: null,
      price: null,
      invoice: null,
      state: "new",
      received: "0",
      rest: null,
      confirmations: null,
      txids: [],
      proof: null,
      attention: null,
      report: null,
      orderChecked: false,
      orderLookups: 0,
      recorded: null,
      transactions: [],
      // Transactions made so far (the list keeps the last 20): the next one's number.
      txCount: 0,
      lockGen: 0,
      checks: 0,
      lastCheck: null,
      lastError: null,
      finalAt: null,
      createdAt: now,
      updatedAt: now
    }
  };
}

function addTransaction(data, options, now) {
  const urls = (options.order && options.order.returnUrls) || {};
  const buyer = options.order && options.order.description && options.order.description.buyerInfo;
  data.txCount = (data.txCount || 0) + 1;
  const tx = {
    wixTransactionId: options.wixTransactionId,
    // The order's reference and the transaction's number: what Wix shows on its payment line.
    pluginTransactionId: transactionIdOf(data.ref, data.txCount),
    n: data.txCount,
    // The key of this transaction's payment page (http.js): the customer's alone.
    pageKey: randomHex(16),
    returnUrls: {
      successUrl: httpsUrl(urls.successUrl),
      pendingUrl: httpsUrl(urls.pendingUrl),
      errorUrl: httpsUrl(urls.errorUrl),
      cancelUrl: httpsUrl(urls.cancelUrl)
    },
    // The order's language, when the plugin has it; else none: its page follows the browser's.
    language: languageOf(buyer && buyer.buyerLanguage),
    at: now,
    sent: "none",
    sentAt: null,
    answer: null
  };
  data.transactions = data.transactions.concat([tx]).slice(-20);
  return tx;
}

/** The address of the transaction's payment page (http.js), on the site's own URL. */
function pageUrlOf(siteUrl, paymentId, tx) {
  return `${siteUrl}/${PAY_FUNCTION}?o=${paymentId}&k=${tx.pageKey}`;
}

function samePrice(a, b) {
  return !!a && !!b && a.currency === b.currency && a.minor === b.minor && a.digits === b.digits;
}

function setAttention(data, reason, now, detail) {
  data.state = "attention";
  data.attention = { reason, at: now, detail: detail || {} };
  data.report = {
    kind: "attention",
    comment: data.orderId ? "todo" : "none",
    notice: "todo",
    task: "todo",
    tries: 0
  };
  data.finalAt = now;
}

function setPaid(data, now) {
  data.state = "paid";
  data.report = {
    kind: "paid",
    comment: data.orderId ? "todo" : "none",
    notice: "none",
    task: "none",
    tries: 0
  };
  data.finalAt = now;
}

/**
 * What a paid status says came, in sats: on-chain and mixed, its `received` (in Lightning too, by
 * invoices of the rest: SPEC.md §3); in Lightning alone, which has no `received`, the invoice's
 * amount, never "0".
 */
function paidReceived(status, invoice) {
  return status.method === "lightning" ? invoice.sats : status.received;
}

function proofOf(status, now) {
  const proof = { method: status.method, at: now };
  if (status.method === "lightning") proof.preimage = status.preimage;
  if (status.method === "onchain" || status.method === "mixed") {
    proof.received = status.received;
    proof.txids = status.txids.slice(0, 50);
  }
  if (status.method === "mixed") proof.preimages = status.preimages.slice(0, 50);
  return proof;
}

/**
 * The answer to a createTransaction of an order whose payment is under way (another transaction,
 * or this one after a failure), or null when it needs a new invoice. A final payment takes no new
 * transaction: a paid order is never charged twice, and one that needs the merchant waits for
 * them. A payment under way takes it over: the latest transaction is the one Wix waits on.
 */
async function answerFromState(data, tx, price, now, facts, pageUrl) {
  switch (data.state) {
    case "paid":
    case "attention":
      // Refused: Wix's events never go to it; a paid order's approval goes to the transaction it
      // was paid through.
      Object.assign(tx, { sent: "declined", refused: true });
      return refusal(
        data.state === "paid" ? "paid" : "attention",
        facts.language,
        facts,
        tx.pluginTransactionId
      );
    case "unconfirmed":
      // The page says that the payment is being confirmed.
      return pageAnswer(tx, pageUrl);
    case "open":
      if (!samePrice(data.price, price)) {
        setAttention(data, "mismatch", now, { invoice: data.invoice && data.invoice.fiat });
        return pendingAnswer(tx);
      }
      return pageAnswer(tx, pageUrl);
    default:
      return null;
  }
}

/** What createInvoice's outcome makes of the payment, and Wix's answer. */
async function invoiceOf(item, tx, ctx, facts, pageUrl) {
  const data = item.data;
  const language = facts.language;
  const order = {
    ref: data.ref,
    fiat: { amount: data.price.amount, currency: data.price.currency },
    note: data.note,
    durationSeconds: facts.minutesToPay * 60
  };
  const now = Date.now();
  try {
    const client = await ctx.client();
    const invoice = await client.createInvoice(order, deadline(ctx.timeouts.deadlineMs));
    if (!invoiceMatches(invoice, data.price)) {
      // The SDK echoes the order's price: never send a customer to pay another amount.
      data.invoice = invoice;
      setAttention(data, "mismatch", now, { invoice: invoice.fiat });
      Object.assign(tx, { sent: "declined", refused: true });
      return refusal("invalid_invoice", language, facts, tx.pluginTransactionId);
    }
    data.invoice = invoice;
    data.state = "open";
    data.received = "0";
    if (!invoice.onchainAddress && BigInt(invoice.sats) >= 1000n) await rememberLightningOnly(data);
    return pageAnswer(tx, pageUrl);
  } catch (failure) {
    const code = failure && failure.code;
    const detail = (failure && failure.detail) || {};
    if (code === "invoice_pending" && detail.invoice) {
      // An invoice of this order may still be paid (SPEC.md §21): this one, on the payment page,
      // whose first check tells whether it is open or being confirmed.
      data.invoice = detail.invoice;
      if (!invoiceMatches(detail.invoice, data.price)) {
        setAttention(data, "mismatch", now, { invoice: detail.invoice.fiat });
        return pendingAnswer(tx);
      }
      data.state = "open";
      return pageAnswer(tx, pageUrl);
    }
    if (code === "order_paid" && detail.invoice && detail.status) {
      // An invoice of this order was paid (SPEC.md §21): the order Wix asks to pay is waiting
      // for it, so it is paid, if the invoice is of its price.
      data.invoice = detail.invoice;
      data.proof = proofOf(detail.status, now);
      data.received = paidReceived(detail.status, detail.invoice);
      if (!invoiceMatches(detail.invoice, data.price)) {
        setAttention(data, "mismatch", now, { invoice: detail.invoice.fiat });
        return pendingAnswer(tx);
      }
      setPaid(data, now);
      data.orderChecked = true;
      return approvedAnswer(data, tx);
    }
    Object.assign(tx, { sent: "declined", refused: true });
    data.lastError = { code: code || "unexpected", at: now };
    return refusal(reasonOf(failure), language, facts, tx.pluginTransactionId);
  }
}

/**
 * createTransaction's work: `options` as Wix gives them (wixTransactionId, order: _id,
 * description: totalAmount, currency, buyerInfo; returnUrls). Wix calls it again, with the same
 * wixTransactionId, when it had no answer within about 15 s: it then gets the same answer.
 */
export async function createTransaction(options, ctx) {
  const timing = stopwatch();
  const language = await ctx.language();
  timing.lap("language");
  const wixTransactionId = options && options.wixTransactionId;
  const order = (options && options.order) || {};
  const description = order.description || {};
  const orderId =
    typeof order._id === "string" && /^[A-Za-z0-9-]{1,100}$/.test(order._id) ? order._id : null;
  const currency = typeof description.currency === "string" ? description.currency : "";
  if (typeof wixTransactionId !== "string" || !/^[A-Za-z0-9-]{1,100}$/.test(wixTransactionId)) {
    return refusal("unexpected", language, { currency });
  }
  const orderKey = orderId || `tx:${wixTransactionId}`;
  // The time to pay, as connectAccount checked and returned it (merchantCredentials).
  const credentials = (options && options.merchantCredentials) || {};
  let minutesToPay = minutesToPayOf(credentials[MINUTES_FIELD]);
  if (minutesToPay === null) {
    logWarning(`the connection's time to pay is not 1 to 60 minutes: ${DEFAULT_MINUTES_TO_PAY}`);
    minutesToPay = DEFAULT_MINUTES_TO_PAY;
  }
  const facts = { orderKey, orderId, currency, language, minutesToPay };

  // The amount Wix records as due, in its minor units: the price, exactly, or no payment.
  const priced = priceOf(description.totalAmount, currency, currencyDigits(currency));
  if (priced.refused) return refusal(priced.refused, language, facts);

  await store.ensureCollection();
  const paymentId = store.paymentIdOf(orderKey);
  let item = await store.readPayment(paymentId);
  const repeated = item && findTransaction(item.data, wixTransactionId);
  if (repeated) logInfo("Wix asked again for a transaction: it gets the same answer");
  if (repeated && repeated.answer) return answerAgain(paymentId, repeated, ctx, language, facts);
  timing.lap("payment");

  if (!(await ctx.key())) return refusal("no_key", language, facts);
  // The payment page is on the site's own address, which its status page keeps.
  const siteUrl = await ctx.siteUrl();
  if (!siteUrl) return refusal("no_site", language, facts);
  const wait = repeated ? REPEAT_WAIT_MS : LOCK_WAIT_MS;
  const taken = await acquire(paymentId, item ? item.data.lockGen : 0, wait, (fresh) => {
    // Made meanwhile by the call Wix asked again.
    const made = fresh && findTransaction(fresh.data, wixTransactionId);
    return made && made.answer ? { tx: made } : null;
  });
  if (taken.result) return answerAgain(paymentId, taken.result.tx, ctx, language, facts);
  if (!taken.held) return refusal("busy", language, facts);
  const held = taken.held;
  timing.lap("lock");
  // How the lock ends (releaseLock): nothing written yet.
  let release = "leave";
  try {
    const now = Date.now();
    item = taken.item || newPayment(paymentId, orderKey, orderId, now);
    const data = item.data;
    let tx = findTransaction(data, wixTransactionId);
    // Made meanwhile by the call Wix asked again.
    if (tx && tx.answer) return await answerAgain(paymentId, tx, ctx, language, facts);
    if (!data.ref) {
      // Drawn at the order's first transaction: Wix's id of each is this reference, numbered.
      data.ref = newRef(orderKey);
      data.note = noteOf(orderKey);
    }
    if (!tx) tx = addTransaction(data, options, now);
    const pageUrl = pageUrlOf(siteUrl, paymentId, tx);

    // Wix's answer, of one of several shapes (for the type checker of Wix's editor).
    /** @type {object} */
    let answer = await answerFromState(data, tx, priced.price, now, facts, pageUrl);
    if (!answer) {
      // A new invoice: the order's first, or the next after one expired unpaid (SPEC.md §21).
      data.price = priced.price;
      if (data.state === "expired") {
        Object.assign(data, {
          state: "new",
          invoice: null,
          received: "0",
          rest: null,
          confirmations: null,
          txids: [],
          finalAt: null
        });
      }
      // The reference is kept with the order before its first invoice is asked for. Its lock
      // stays this one's meanwhile: another call that reads the payment now finds it held.
      data.lockGen = held.gen;
      await saveHeld(item, held);
      answer = await invoiceOf(item, tx, ctx, facts, pageUrl);
      timing.lap("invoice");
    }
    tx.answer = answer;
    schedule(item, Date.now());
    await eraseIfAsked(item);
    item.data.lockGen = held.gen + 1;
    item.data.updatedAt = Date.now();
    await saveHeld(item, held);
    // An inactive payment (refused, settled): no check follows, none of its locks is read again.
    release = item.active ? "done" : "all";
    timing.lap("records");
    logInfo(`a transaction answered in ${timing.text()}`);
    return answer;
  } catch (error) {
    release = "failed";
    throw error;
  } finally {
    await releaseLock(held, release);
  }
}

/**
 * The answer a transaction got, for Wix's repeated call of it: as it was, or, the payment erased,
 * its payment page's address made again from the page's key (erasePayment keeps no copy of it).
 */
async function answerAgain(paymentId, tx, ctx, language, facts) {
  if (!tx.answer.page) return tx.answer;
  const siteUrl = await ctx.siteUrl();
  if (!siteUrl) return refusal("no_site", language, facts);
  return pageAnswer(tx, pageUrlOf(siteUrl, paymentId, tx));
}

// Locks taken over or read again before one is held (acquire).
const ACQUIRE_TRIES = 4;

/**
 * Locks payment `paymentId` (store.js), from generation `fromGen`, waiting up to `waitMs` for
 * another holder: `{ held, item }`, the payment read under the lock (from Wix Data's primary;
 * null when there is none yet); `{ result }` when, read again after another holder was done, the
 * payment needs no lock (`settled(item)`, that call's result, or null); `{ busy: true }`.
 */
async function acquire(paymentId, fromGen, waitMs, settled) {
  const end = Date.now() + waitMs;
  let gen = fromGen;
  for (let tries = 0; tries < ACQUIRE_TRIES; tries += 1) {
    const taken = await store.lock(paymentId, gen, Math.max(0, end - Date.now()));
    if (taken.busy) return { busy: true };
    let item;
    if (taken.held) {
      item = await store.readPayment(paymentId);
      if (!item || store.holdsLatest(taken.held, item.data.lockGen)) {
        return { held: taken.held, item };
      }
      // A generation the payment had passed, from a lockGen read before another holder was done.
      await releaseLock(taken.held, "stale");
    } else {
      // Freed: another holder is done; the payment as it left it.
      item = await store.readPayment(paymentId);
    }
    const result = settled(item);
    if (result) return { result };
    gen = item ? item.data.lockGen : 0;
  }
  return { busy: true };
}

/**
 * Saves payment `item` under `held`, with enough of its lease left for the request to be done
 * before anyone may take the lock over (store.WRITE_MARGIN_MS); else throws, saving nothing.
 */
async function saveHeld(item, held) {
  if (!store.leaseLeft(held, store.WRITE_MARGIN_MS)) {
    throw new Error("a payment's lock ran out of time before its record was saved");
  }
  await store.savePayment(item);
}

/**
 * Ends `held` (store.js): "done", its payment saved with lockGen past it (its lock items removed);
 * "all", saved too, no check follows (all its lock items removed); "leave", nothing written (its
 * own item removed, while its lease runs); "stale", a generation its payment had passed (removed);
 * "failed", a write failed (marked released, nothing removed).
 */
function releaseLock(held, how) {
  const ended =
    how === "done"
      ? store.unlock(held)
      : how === "all"
        ? store.dropLocks(held)
        : how === "stale"
          ? store.dropLock(held)
          : how === "failed"
            ? store.abandon(held)
            : store.leave(held);
  return ended.catch((error) => logError("could not release a lock", error));
}

/* ---------------------------------------------------------------------------------------------
 * The check of a payment: its status from the SDK (getStatus), what it makes of the payment, and
 * what Wix and the merchant are told. From the customer's payment page, and from the background
 * job.
 */

/** Applies the SDK's `status` of the payment's invoice. */
function applyStatus(data, status, now) {
  switch (status.state) {
    case "open":
      data.state = "open";
      data.received = status.received;
      // What the payment page shows of the rest of an underpayment.
      data.rest = status.rest
        ? { sats: status.rest.sats, bolt11: status.rest.bolt11, paymentUri: status.rest.paymentUri }
        : null;
      break;
    case "unconfirmed":
      data.state = "unconfirmed";
      data.rest = null;
      data.received = status.received;
      data.confirmations = status.confirmations;
      data.txids = status.txids.slice(0, 50);
      break;
    case "paid": {
      data.proof = proofOf(status, now);
      data.received = paidReceived(status, data.invoice);
      data.state = "paid";
      // Its approval goes to the transaction Wix waits on now, whatever comes after.
      const target = eventTarget(data);
      data.paidTx = target ? target.wixTransactionId : null;
      // 3 confirmations or more, on the explorer the SDK read (mempool.space, or the merchant's
      // Bitcoin node): no longer counted.
      data.confirmations = null;
      data.finalAt = now;
      // Approved once the order is known to wait for it (deliver).
      break;
    }
    case "expired":
      data.received = status.received;
      if (positive(status.received)) {
        // Underpaid, then expired: the merchant received it, and settles it with the customer.
        setAttention(data, "underpaid", now, {
          received: status.received,
          due: data.invoice.sats,
          address: data.invoice.onchainAddress
        });
      } else {
        data.state = "expired";
        data.finalAt = now;
      }
      break;
    default:
      throw new Error(`a payment status of an unknown state: ${status.state}`);
  }
}

/**
 * The event the transaction Wix waits on (eventTarget) gets in the payment's state, if any;
 * `fresh` when this check read the invoice's status (never an event from a check that failed).
 */
function wantedEvent(data, fresh) {
  switch (data.state) {
    case "paid":
      return data.report ? "approved" : null;
    case "expired":
      return "declined";
    case "attention":
      // Paid, but Wix did not record it, or refused its approval: Wix is told nothing more.
      return data.attention && data.attention.reason === "unrecorded" ? null : "pending";
    case "unconfirmed":
      return "pending";
    case "open":
      // The customer has the payment page: pending, from its first check that reads the invoice,
      // which the page makes as it opens. Measured, with a background check 40 to 50 s after the
      // customer's click: when a second order of the same cart was placed before an order's first
      // event, Wix kept that order's "Paid offline" line, and its later events added a line beside
      // it (pending, paid) or none (declined), 7 times in 7; an order whose first event came
      // before the next order of its cart kept one line, as it should.
      return fresh ? "pending" : null;
    default:
      return null;
  }
}

/** Whether `wanted` may follow `sent`: pending once, then one of approved or declined. */
function mayFollow(sent, wanted) {
  if (!wanted || sent === "approved" || sent === "declined") return false;
  return wanted === "pending" ? sent === "none" : true;
}

function eventOf(tx, wanted) {
  const transaction = {
    wixTransactionId: tx.wixTransactionId,
    pluginTransactionId: tx.pluginTransactionId
  };
  if (wanted === "pending") transaction.reasonCode = REASON.pending;
  if (wanted === "declined") {
    Object.assign(transaction, {
      reasonCode: REASON.expired,
      errorCode: "INVOICE_EXPIRED",
      errorMessage: "The sattle.me invoice expired unpaid."
    });
  }
  return transaction;
}

/**
 * The order's number and its customer's contact, for the merchant's texts and task. Wix numbers an
 * order once it is placed: before, its number is 0 (measured), and none is kept.
 */
function keepOrderFacts(data, order) {
  const number = order.number === undefined || order.number === null ? "" : String(order.number);
  if (number !== "" && number !== "0") data.orderNumber = number;
  const contactId = order.buyerInfo && order.buyerInfo.contactId;
  if (typeof contactId === "string" && contactId !== "") data.contactId = contactId;
}

/** A paid payment: is its order still waiting for it (not canceled meanwhile)? */
async function checkOrder(data, now) {
  if (!data.orderId) {
    setPaid(data, now);
    return;
  }
  const looked = await wix.getOrder(data.orderId);
  if (looked.order) {
    data.orderChecked = true;
    keepOrderFacts(data, looked.order);
    // Velo's types list INITIALIZED, APPROVED and CANCELED; Wix's eCommerce API also has PENDING
    // and REJECTED (in preview).
    const status = /** @type {string} */ (looked.order.status);
    if (status === "CANCELED" || status === "REJECTED") {
      setAttention(data, "canceled", now, { orderStatus: status });
      return;
    }
    // Wix lets a merchant edit an order (its items, prices, fees, discounts: "Editing Orders"):
    // one whose total changed after its invoice was made, paid at the invoice's amount, is never
    // completed so: the merchant settles the difference.
    const due = orderDue(looked.order, data.price);
    if (due && !due.same) {
      logWarning(
        `a paid order's total changed since its invoice (${due.due} ${due.currency} due, ` +
          `${data.price.amount} ${data.price.currency} paid): left to the merchant`
      );
      setAttention(data, "changed", now, {
        total: due.total,
        due: due.due,
        currency: due.currency
      });
      return;
    }
    if (!due) logWarning("the total of a paid order could not be read: approved all the same");
    setPaid(data, now);
    return;
  }
  data.orderLookups += 1;
  if (data.orderLookups >= ORDER_LOOKUPS) {
    // Not an order of Wix eCommerce, or Wix cannot say: approved all the same.
    logWarning(`the order of a paid payment could not be read (${looked.error}): approved`);
    data.orderChecked = true;
    setPaid(data, now);
  }
}

/** A paid order of Wix eCommerce, just approved: to be read back (verifyRecorded). */
function expectRecorded(data, at) {
  if (!data.orderId) return;
  data.recorded = { state: "todo", lookups: 0, nextAt: at + VERIFY_AFTER_MS, paymentStatus: null };
}

function isVerifying(data) {
  return data.state === "paid" && !!data.recorded && data.recorded.state === "todo";
}

/**
 * Whether Wix recorded a paid order as paid, read back after its approval. Wix answers the same
 * to every event, whether it applies it or not: measured, two declined events left their orders
 * pending, and a pending event made a second payment line. A paid order Wix shows unpaid is in
 * none of its lists: the merchant is told, as for the payments that need them, and Wix is told
 * nothing more. The last status Wix gave decides; when it gave none, nothing is said but the logs.
 */
async function verifyRecorded(data, now) {
  const recorded = data.recorded;
  recorded.lookups += 1;
  const looked = await wix.getOrder(data.orderId);
  const order = looked.order;
  const status =
    order && typeof order.paymentStatus === "string" ? order.paymentStatus.slice(0, 40) : null;
  if (status) recorded.paymentStatus = status;
  if (status !== null && RECORDED.indexOf(status) !== -1) {
    recorded.state = "yes";
    return;
  }
  if (recorded.lookups < VERIFY_LOOKUPS) {
    recorded.nextAt = now + VERIFY_EVERY_MS;
    return;
  }
  if (UNRECORDED.indexOf(recorded.paymentStatus) === -1) {
    recorded.state = "unknown";
    const why = recorded.paymentStatus || looked.error || "none";
    logWarning(
      `could not tell whether Wix recorded paid order ${data.orderId} (its status: ${why})`
    );
    return;
  }
  recorded.state = "no";
  logWarning(
    `Wix did not record paid order ${data.orderId} as paid (its status: ${recorded.paymentStatus})`
  );
  setAttention(data, "unrecorded", now, { paymentStatus: recorded.paymentStatus });
}

/**
 * Tells Wix and the merchant what the payment's state calls for, each once; `fresh` when this
 * check read the invoice's status. What it is about to send is saved first (the outbox), with
 * enough of the lock's lease left.
 */
async function deliver(item, held, ctx, now, fresh) {
  const data = item.data;
  await settleSending(data);
  if (data.state === "paid" && !data.report && leaseLeft(held)) await checkOrder(data, now);
  if (isVerifying(data) && Date.now() >= data.recorded.nextAt && leaseLeft(held)) {
    await verifyRecorded(data, Date.now());
  }
  // A second round when the first gave an approval up: the merchant's report, at once.
  for (let round = 0; round < 2; round += 1) {
    const report = data.report;
    const tx = eventTarget(data);
    const wanted = wantedEvent(data, fresh);
    const event = tx && mayFollow(tx.sent, wanted) ? wanted : null;
    const steps = report ? STEPS.filter((step) => report[step] === "todo") : [];
    if ((!event && !steps.length) || !store.leaseLeft(held, store.WRITE_MARGIN_MS)) return;
    if (steps.length && data.orderId && (!data.orderNumber || !data.contactId)) {
      // The order's number and customer, for the notification and the task.
      const looked = await wix.getOrder(data.orderId);
      if (looked.order) keepOrderFacts(data, looked.order);
    }
    // A customer whose contact Wix deleted (privacy.js): erased before anything is written of the
    // payment, which then says so, never the address or the transactions the erasure removes.
    if (steps.length) await eraseIfAsked(item);
    // The outbox: what this check is about to send, kept before it does. Its lock stays its own.
    const at = Date.now();
    if (tx && event) Object.assign(tx, { sending: event, sendingAt: at });
    for (const step of steps) if (report) report[step] = "sending";
    if (report && steps.length) report.sendingAt = at;
    data.lockGen = held.gen;
    await saveHeld(item, held);
    if (tx && event) await sendEvent(data, tx, event, held);
    if (report && steps.length) await sendReport(data, report, steps, held, ctx);
    if (data.report === report) return;
  }
}

/**
 * Sends Wix event `wanted` of transaction `tx`, marked "sending" in the outbox. Refused, it is
 * sent again at the next check; not tried (its lease over), the outbox says "sending" and the next
 * check counts it as sent.
 */
async function sendEvent(data, tx, wanted, held) {
  if (!leaseLeft(held)) return;
  try {
    await wix.submitTransactionEvent(eventOf(tx, wanted));
    tx.sent = wanted;
    tx.sentAt = Date.now();
    if (wanted === "approved") expectRecorded(data, tx.sentAt);
  } catch (error) {
    data.lastError = { code: "submit_event", at: Date.now() };
    logError("Wix refused an event of a transaction", error);
    if (wanted === "approved") refusedApproval(data, tx, Date.now());
  }
  tx.sending = null;
  tx.sendingAt = null;
}

/**
 * Counts a refused approval of `tx`; refused APPROVAL_TRIES times over APPROVAL_PATIENCE_MS, it is
 * given up: the merchant is told (a comment with the proof, a task, a notification), as of a paid
 * order Wix did not record, and the customer, who paid, is sent to Wix's success page.
 */
function refusedApproval(data, tx, now) {
  tx.failures = (tx.failures || 0) + 1;
  if (!tx.failedAt) tx.failedAt = now;
  if (tx.failures < APPROVAL_TRIES || now - tx.failedAt < APPROVAL_PATIENCE_MS) return;
  logWarning(
    `Wix refused the approval of paid order ${data.orderId || "-"} ${tx.failures} times: given up, the merchant is told`
  );
  setAttention(data, "unrecorded", now, { approval: "refused" });
}

/**
 * Whether the customer, who paid, waits on the payment page for Wix to be told: the approval of
 * the transaction they paid through not sent yet (nor given up).
 */
export function awaitingWix(data) {
  if (data.state !== "paid") return false;
  const tx = eventTarget(data);
  return !!tx && tx.sent !== "approved" && tx.sending !== "approved";
}

/**
 * Makes the report's `steps` (a comment on the order, a notification to the site's owner, a task in
 * the dashboard), marked "sending" in the outbox. A comment or a task Wix failed may still have
 * been made (its answer past Wix's time limit): it stays "sending", looked for at the next check
 * (settleSending), unless Wix refused it outright (refusedOutright), which is made again; a
 * notification Wix failed is sent again. Each goes without after TRIES checks ("failed"), the
 * reason of its last failure kept for the status page (report.errors).
 */
async function sendReport(data, report, steps, held, ctx) {
  const language = await ctx.language();
  const text = reportText(data, language);
  report.tries += 1;
  for (const step of steps) {
    if (!leaseLeft(held)) continue;
    try {
      if (step === "comment") {
        await wix.addOrderComment(data.orderId, text);
      } else if (step === "notice") {
        const siteUrl = await ctx.siteUrl();
        const link = siteUrl
          ? { title: t(language, "notice.open"), url: `${siteUrl}/${STATUS_FUNCTION}` }
          : null;
        const body = `${noticeText(data, language)} ${t(language, "notice.details")}`;
        await wix.notifyOwner(t(language, "notice.title"), body, link);
      } else {
        // Wix lists an order only once it is paid: the task is where the merchant finds this one.
        await wix.createTask(
          taskTitle(data, language),
          taskDescription(data, language),
          data.contactId
        );
      }
      report[step] = "done";
      if (report.errors) delete report.errors[step];
    } catch (error) {
      logError(STEP_FAILURES[step], error);
      report.errors = Object.assign({}, report.errors, { [step]: failureText(error) });
      if (report.tries >= TRIES) report[step] = "failed";
      else if (step === "notice" || refusedOutright(error)) report[step] = "todo";
    }
  }
}

/**
 * Whether Wix refused a call outright, before making anything: an invalid argument (measured: a
 * task's description too long, `INVALID_ARGUMENT: "task.description" has size 624, expected 500
 * or less`). Nothing to look for at the next check: it is made again then.
 */
function refusedOutright(error) {
  const described = describeError(error);
  return /\bINVALID_ARGUMENT\b/.test(`${described.code || ""} ${described.message}`);
}

/** Why a call to Wix failed, for the status page: masked, on one line, 160 characters at most. */
function failureText(error) {
  const described = describeError(error);
  const text = described.message || described.code || described.name;
  return clip(redact(text).replace(/\s+/g, " ").trim(), 160);
}

const STEP_FAILURES = {
  comment: "could not comment the order",
  notice: "could not notify the site's owner",
  task: "could not make the merchant's task"
};

/**
 * What an earlier check marked "sending" and could not record as sent or not (its save refused,
 * past Wix Data's time limit, or its lease over): an event counts as sent, Wix's events going once
 * each (an approval is read back from the order, verifyRecorded); a comment is looked for among
 * the order's, a task among those made since; a notification counts as sent (Wix lists none).
 */
async function settleSending(data) {
  for (const tx of data.transactions) {
    if (!tx.sending) continue;
    logWarning(`an event of a transaction may have reached Wix: counted as sent (${tx.sending})`);
    tx.sent = tx.sending;
    tx.sentAt = tx.sendingAt || Date.now();
    tx.sending = null;
    tx.sendingAt = null;
    if (tx.sent === "approved") expectRecorded(data, tx.sentAt);
  }
  const report = data.report;
  if (!report) return;
  if (report.notice === "sending") report.notice = "done";
  for (const step of ["comment", "task"]) {
    if (report[step] !== "sending") continue;
    try {
      const made =
        step === "comment"
          ? await commentMade(data)
          : await taskMade(data, (report.sendingAt || Date.now()) - TASK_LOOKBACK_MS);
      report[step] = made ? "done" : "todo";
    } catch (error) {
      logError(`could not tell whether a ${step} was made`, error);
      report.errors = Object.assign({}, report.errors, { [step]: failureText(error) });
      report.tries += 1;
      if (report.tries >= TRIES) report[step] = "failed";
    }
  }
}

/**
 * Whether `text` (a comment's) is the payment's report: its reference in it, its first line the
 * report's in one of the plugin's languages (to its first value).
 */
function isReportOf(text, data) {
  if (typeof text !== "string" || typeof data.ref !== "string" || !text.includes(data.ref)) {
    return false;
  }
  const key = data.attention ? `report.${data.attention.reason}` : "report.paid";
  const first = text.split("\n")[0];
  return LANGUAGES.some((language) => {
    const source = textOf(key, language);
    return typeof source === "string" && first.startsWith(source.split("{")[0]);
  });
}

/** Whether the order holds the payment's report as a comment. */
async function commentMade(data) {
  const looked = await wix.getOrder(data.orderId);
  if (!looked.order) throw new Error(`the order could not be read (${looked.error})`);
  return wix.orderComments(looked.order).some((message) => isReportOf(message, data));
}

/** Whether a task made since `since` (ms) is the payment's: its description's first line names
 * the payment's reference, in one of the plugin's languages (taskDescription). */
async function taskMade(data, since) {
  const made = await wix.tasksSince(since);
  return made.some((task) => {
    const first = typeof task.description === "string" ? task.description.split("\n")[0] : "";
    return LANGUAGES.some((language) => first === t(language, "report.ref", { ref: data.ref }));
  });
}

/** Whether a report has a comment, a notification or a task left to make, or to look for. */
function reportLeft(report) {
  return STEPS.some((step) => report[step] === "todo" || report[step] === "sending");
}

function leaseLeft(held) {
  return store.leaseLeft(held, MARGIN_MS);
}

const METHODS = { lightning: "Lightning", onchain: "on-chain", mixed: "on-chain + Lightning" };

/** A transaction's page on mempool.space, as the merchant opens it from the comment. */
export function transactionUrl(txid) {
  return /^[0-9a-f]{64}$/.test(txid) ? `https://mempool.space/tx/${txid}` : String(txid);
}

/**
 * What a payment's report says: its comment (reportText) and its task's title (taskTitle). An
 * erased payment's address is named as erased (privacy.js).
 */
function reportFacts(data, language) {
  const address = data.invoice && data.invoice.onchainAddress ? data.invoice.onchainAddress : "";
  return {
    ref: data.ref,
    number: data.orderNumber || data.note || data.ref,
    method: data.proof ? METHODS[data.proof.method] || data.proof.method : "",
    received: data.received,
    // What came of a paid payment (paidReceived), never the invoice's amount for an on-chain one.
    came: data.received,
    due: data.invoice ? data.invoice.sats : "",
    address: data.erased ? t(language, "report.erasedValue") : address,
    price: data.price ? `${data.price.amount} ${data.price.currency}` : "",
    sats: data.invoice ? data.invoice.sats : "",
    // An order's total that changed after its invoice: as Wix gave it.
    total:
      data.attention && data.attention.detail && data.attention.detail.total
        ? `${data.attention.detail.total} ${data.attention.detail.currency}`
        : "",
    invoicePrice:
      data.attention && data.attention.detail && data.attention.detail.invoice
        ? `${data.attention.detail.invoice.amount} ${data.attention.detail.invoice.currency}`
        : "sats"
  };
}

/**
 * `lines` ({ text, essential }) joined by line breaks within `max` characters (wix.LIMITS, counted
 * as UTF-16 code units): every essential line whole, in its place; the others in order while they
 * fit, the first that does not cut at a character boundary ("…", when MIN_CUT characters of it
 * fit), and those after it left out.
 * @param {{ text: string, essential?: boolean }[]} lines
 * @param {number} max
 */
export function fitLines(lines, max) {
  let reserved = lines.reduce((sum, line) => sum + (line.essential ? line.text.length + 1 : 0), 0);
  const kept = [];
  let used = 0;
  let full = false;
  for (const line of lines) {
    const separator = kept.length ? 1 : 0;
    if (line.essential) {
      reserved -= line.text.length + 1;
    } else if (full) {
      continue;
    } else {
      const room = max - used - separator - reserved;
      if (line.text.length > room) {
        full = true;
        if (room < MIN_CUT) continue;
        kept.push(clip(line.text, room));
        used += separator + kept[kept.length - 1].length;
        continue;
      }
    }
    kept.push(line.text);
    used += separator + line.text.length;
  }
  return clip(kept.join("\n"), max);
}

/**
 * The task's title. Wix's dashboard shows a task's title alone, not its description (measured):
 * it says what happened and what to do, within Wix's limit (wix.LIMITS).
 */
export function taskTitle(data, language) {
  if (!data.attention) return clip(noticeText(data, language), wix.LIMITS.taskTitle);
  return clip(
    t(language, `task.${data.attention.reason}`, reportFacts(data, language)),
    wix.LIMITS.taskTitle
  );
}

/**
 * The task's description, within Wix's limit (wix.LIMITS: 500 characters; measured: a longer one
 * is refused, and the task not made): what identifies the payment first, whole (its reference,
 * which the plugin looks for, and its Wix order, which Wix lists only once paid), then the facts
 * (what came of what was due, where, the amount, its rate, the proof), then what the comment
 * says; what does not fit is cut, the comment on the order holding all of it.
 */
export function taskDescription(data, language) {
  const facts = reportFacts(data, language);
  /** @type {{ text: string, essential?: boolean }[]} */
  const lines = [
    { text: t(language, "report.ref", facts), essential: true },
    { text: t(language, "task.order", { orderId: data.orderId || "–" }), essential: true }
  ];
  const detail = (data.attention && data.attention.detail) || {};
  if (detail.received && detail.due) {
    lines.push({ text: t(language, "report.receivedOf", detail) });
    if (detail.address) lines.push({ text: t(language, "report.address", detail) });
  }
  const report = reportLines(data, language);
  for (const line of report.slice(1)) if (!line.ref) lines.push({ text: line.text });
  if (report.length) lines.push({ text: report[0].text });
  return fitLines(lines, wix.LIMITS.taskDescription);
}

/**
 * What the order's comment says: the proof of its payment, or what the merchant must do, within
 * Wix's limit (wix.LIMITS), its first line and its reference whole (the plugin looks for both).
 */
export function reportText(data, language) {
  return fitLines(reportLines(data, language), wix.LIMITS.comment);
}

/** The lines of the order's comment ({ text, essential, ref }), in order. */
function reportLines(data, language) {
  const facts = reportFacts(data, language);
  const lines = [];
  if (data.report && data.report.kind === "paid") {
    lines.push(t(language, "report.paid", facts));
  } else if (data.attention) {
    lines.push(t(language, `report.${data.attention.reason}`, facts));
  }
  // What the invoice asked: its sats for the order's price, at the rate it was converted (an
  // invoice the registry gave back, invoice_pending or order_paid, has no rate: SPEC.md §3).
  const invoice = data.invoice;
  if (invoice && invoice.sats && data.price) {
    lines.push(t(language, "report.amount", { sats: invoice.sats, price: facts.price }));
    const rate = invoice.rate;
    if (rate && rate.price && rate.currency && rate.source) {
      const values = { rate: rate.price, currency: rate.currency, source: rate.source };
      lines.push(t(language, "report.rate", values));
    }
  }
  if (data.proof) {
    lines.push(t(language, "report.method", facts));
    if (data.proof.preimage)
      lines.push(`${t(language, "report.preimage")}: ${data.proof.preimage}`);
    if (data.proof.preimages && data.proof.preimages.length) {
      lines.push(`${t(language, "report.preimages")}: ${data.proof.preimages.join(", ")}`);
    }
    const onchain = data.proof.method === "onchain" || data.proof.method === "mixed";
    if (!data.erased && facts.address && onchain) {
      lines.push(t(language, "report.address", facts));
    }
    if (data.proof.txids && data.proof.txids.length) {
      const links = data.proof.txids.map(transactionUrl).join(", ");
      lines.push(`${t(language, "report.txids")}: ${links}`);
    }
    if (data.proof.received)
      lines.push(t(language, "report.received", { received: data.proof.received }));
    const due = data.invoice && data.invoice.sats;
    if (data.proof.received && due && BigInt(data.proof.received) < BigInt(due)) {
      // Short of the amount, yet paid: the merchant accepted it in its app, within its tolerance
      // or by hand (the merchant's acceptance, SPEC.md §31). Never left to the merchant for it.
      lines.push(t(language, "report.accepted", { received: data.proof.received, due }));
    }
  }
  /** @type {{ text: string, essential: boolean, ref?: boolean }[]} */
  const fitted = lines.map((text, index) => ({ text, essential: index === 0 }));
  // Erased at the customer's request: said, whole, after the first line.
  if (data.erased) fitted.splice(1, 0, { text: t(language, "report.erased"), essential: true });
  fitted.push({ text: t(language, "report.ref", facts), essential: true, ref: true });
  return fitted;
}

/** The notification's text. The order by its number, else by the note ("Wix 8c1b2a3d"), which the
 * merchant's app shows for its sale. */
function noticeText(data, language) {
  const reason = data.attention ? data.attention.reason : "paid";
  return t(language, `notice.${reason}`, { number: data.orderNumber || data.note || data.ref });
}

/**
 * When the payment is checked next; inactive once settled. Its payment page checks it while its
 * customer is on it; the job checks, at its next run, every payment due by then: a payment checked
 * is due again at once, or, when only its order is left to read back, at that time. A settled
 * payment that ended with nothing paid is marked `unpaid`, for the job to remove it sooner.
 */
function schedule(item, now) {
  const data = item.data;
  item.dueAt = now;
  item.unpaid = false;
  if (data.state === "new") {
    item.active = false;
    item.unpaid = true;
    return;
  }
  if (!isFinal(data)) {
    item.active = true;
    return;
  }
  // Only Wix and the merchant left to tell (or the order of a paid payment to read, before its
  // approval, or after it: verifyRecorded).
  const tx = eventTarget(data);
  const toTell =
    (!!tx && mayFollow(tx.sent, wantedEvent(data))) ||
    (!!data.report && reportLeft(data.report)) ||
    (data.state === "paid" && !data.report);
  const verifying = isVerifying(data);
  const tooLong = now - (data.finalAt || now) > GIVE_UP_MS;
  if (tooLong && toTell) logWarning("a payment's events could not be delivered for 90 days");
  item.active = (toTell || verifying) && !tooLong;
  if (verifying && !toTell) item.dueAt = Math.max(now, data.recorded.nextAt);
  item.unpaid = !item.active && endedUnpaid(data);
}

/**
 * Whether a payment ended with nothing paid: its invoice expired, the SDK's status of the stored
 * invoice saying nothing was received in time ("expired: never paid, for good", SPEC.md §3); or it
 * never got an invoice (refused before one). Its record is removed a week after (jobs.js).
 */
function endedUnpaid(data) {
  return (data.state === "expired" && !positive(data.received)) || data.state === "new";
}

/**
 * Why a check failed, for the logs, masked (300 characters at most), on one line ("" for none):
 * the SDK's reason (the host that gave no answer or an error, too few relays that answered, a
 * service's refusal), or the message of an error of the plugin's (an unknown status, the bundle).
 * A service's refusal is its own text: its line breaks would split the log's line.
 */
function checkFailureReason(failure) {
  const message =
    failure && failure.detail ? failure.detail.message : describeError(failure).message;
  // Masked before it is cut: a secret cut in two is no longer found.
  return typeof message === "string"
    ? redact(message).replace(/\s+/g, " ").trim().slice(0, 300)
    : "";
}

/**
 * Whether payment `data` was checked less than `ms` ago (its status, or, final, what Wix and the
 * merchant are told): its page checks it at most that often, decided from a read, without a lock.
 */
export function checkedWithin(data, ms, now) {
  if (!ms || typeof data.lastCheck !== "number") return false;
  const age = now - data.lastCheck;
  return age >= 0 && age < ms;
}

/**
 * Checks payment `paymentId` (lock generation from `fromGen`) and tells Wix and the merchant what
 * follows. `minIntervalMs`: no new check of a payment checked this recently (its page); `waitMs`:
 * how long to wait for a check that holds it. `{ item }` after the check (or as it was, when it
 * needs none), `{ busy: true }` when another check holds the payment.
 */
export async function checkPayment(
  paymentId,
  fromGen,
  ctx,
  { waitMs = 0, minIntervalMs = 0 } = {}
) {
  const needsNone = (item) =>
    !item || !item.active || checkedWithin(item.data, minIntervalMs, Date.now()) ? { item } : null;
  const taken = await acquire(paymentId, fromGen, waitMs, needsNone);
  if (taken.result) return taken.result;
  if (!taken.held) return { busy: true, item: null };
  const held = taken.held;
  const item = taken.item;
  // How the lock ends (releaseLock): nothing written yet.
  let release = "leave";
  try {
    // Settled, or checked a moment ago by a check this one waited for.
    if (needsNone(item)) return { item };
    const data = item.data;
    let now = Date.now();
    let fresh = false;
    data.lastCheck = now;
    if (!isFinal(data) && data.invoice) {
      data.checks += 1;
      try {
        const client = await ctx.client();
        const ms = Math.min(ctx.timeouts.deadlineMs, held.until - now - store.WRITE_MARGIN_MS);
        applyStatus(data, await client.getStatus(data.invoice, deadline(ms)), Date.now());
        data.lastError = null;
        fresh = true;
      } catch (failure) {
        data.lastError = { code: (failure && failure.code) || "unexpected", at: Date.now() };
        const reason = checkFailureReason(failure);
        logWarning(`a payment check failed: ${data.lastError.code}${reason ? ` (${reason})` : ""}`);
      }
      now = Date.now();
      const end = (data.invoice.expiresAt + GRACE_SECONDS) * 1000;
      if (!isFinal(data) && now - end > GIVE_UP_MS) setAttention(data, "stale", now, {});
    }
    await deliver(item, held, ctx, Date.now(), fresh);
    schedule(item, Date.now());
    await eraseIfAsked(item);
    data.lockGen = held.gen + 1;
    data.updatedAt = Date.now();
    await saveHeld(item, held);
    release = item.active ? "done" : "all";
    return { item, checked: true };
  } catch (error) {
    release = "failed";
    throw error;
  } finally {
    await releaseLock(held, release);
  }
}

/**
 * The Wix page the payment page sends the customer to once the payment is final: a customer who
 * paid, success, though Wix did not record it (the merchant is told); an invoice that expired
 * unpaid, error; one that needs the merchant, pending.
 */
export function finalTarget(data, tx) {
  const urls = tx.returnUrls;
  const pending = urls.pendingUrl || urls.successUrl;
  if (data.attention && data.attention.reason === "unrecorded") return urls.successUrl;
  switch (data.state) {
    case "paid":
      return urls.successUrl;
    case "expired":
      return urls.errorUrl || urls.cancelUrl || pending;
    default:
      return pending;
  }
}

/* ---------------------------------------------------------------------------------------------
 * What a payment keeps of its customer (privacy.js): their Wix contact's id, and, paid on-chain,
 * the deposit address and the transactions, which lead to their coins on the blockchain (the
 * payment URIs hold the address too). Erased once the payment is settled, when Wix deleted the
 * contact; its reference, amounts, rate, dates, states and Lightning proofs stay, for the
 * merchant's accounting, as pretix's data shredder leaves them.
 */

/**
 * Erases from a final payment `data` what leads to its customer (above), and every copy a final
 * payment no longer needs of how it was paid: the contact's id; the deposit address, the payment
 * URI (the wallet link, which holds the address), the Lightning invoice and its verify URL, the
 * checkout link's addresses; the transactions; the rest of an underpayment; and the payment page's
 * address as createTransaction answered it (a repeated call of Wix gets it made again from the
 * page's key). What stays answers the payment's page (the transactions' keys and Wix's return
 * addresses: "Payment incomplete", or Wix's page of the order's state) and the merchant: the
 * reference, the order, the amounts, the rate, the dates, the states, the Lightning proofs (payment
 * hash, preimages), the Wix events and the reports' states.
 */
export function erasePayment(data, now, anonymize) {
  data.contactId = null;
  data.txids = [];
  data.rest = null;
  if (data.invoice) {
    Object.assign(data.invoice, {
      onchainAddress: null,
      paymentUri: null,
      bolt11: null,
      verifyUrl: null,
      checkoutUrl: null,
      redirectUrl: null
    });
  }
  if (data.proof && data.proof.txids) data.proof.txids = [];
  if (data.attention && data.attention.detail && data.attention.detail.address) {
    data.attention.detail.address = null;
  }
  for (const tx of data.transactions) {
    if (tx.answer && typeof tx.answer.redirectUrl === "string") {
      tx.answer = { pluginTransactionId: tx.answer.pluginTransactionId, page: true };
    }
  }
  data.erased = { at: now, anonymize: !!anonymize };
}

/**
 * A final payment (its invoice no longer checked: nothing asks about its address any more):
 * erased, if Wix deleted its customer's contact meanwhile (kept as an erasure: privacy.js); before
 * any comment, task or notification of it is written (deliver), and as it is saved.
 */
async function eraseIfAsked(item) {
  const data = item.data;
  if (!isFinal(data) || data.erased || typeof data.contactId !== "string") return;
  const erasure = await store.recall("erasure", data.contactId);
  if (erasure) erasePayment(data, Date.now(), erasure.anonymize);
}

/**
 * Changes payment `paymentId` under its lock (privacy.js): `change(data)` returns whether it
 * changed anything; a payment settled is erased then, if its customer asked. `{ changed, erased }`,
 * `{ busy: true }` while another call holds it, `{ missing: true }` for none.
 */
export async function changePayment(paymentId, change, { waitMs = 5000 } = {}) {
  const before = await store.readPayment(paymentId);
  if (!before) return { missing: true };
  const taken = await acquire(paymentId, before.data.lockGen, waitMs, (item) =>
    item ? null : { missing: true }
  );
  if (taken.result) return taken.result;
  if (!taken.held) return { busy: true };
  const held = taken.held;
  // How the lock ends (releaseLock): nothing written yet.
  let release = "leave";
  try {
    const item = taken.item;
    if (!item) return { missing: true };
    const changed = change(item.data) === true;
    const wasErased = !!item.data.erased;
    await eraseIfAsked(item);
    const erased = !wasErased && !!item.data.erased;
    item.data.lockGen = held.gen + 1;
    if (changed || erased) item.data.updatedAt = Date.now();
    await saveHeld(item, held);
    release = item.active ? "done" : "all";
    return { changed, erased, item };
  } catch (error) {
    release = "failed";
    throw error;
  } finally {
    await releaseLock(held, release);
  }
}

/* ---------------------------------------------------------------------------------------------
 * connectAccount (Payment Provider service plugin): the merchant connects the plugin from the
 * site's payment settings. The key is read from the Secrets Manager and checked with merchant().
 */

const CONNECT_FAILURES = {
  no_key: { reasonCode: REASON.authorization, errorCode: "KEY_MISSING" },
  invalid_key: { reasonCode: REASON.authorization, errorCode: "INVALID_KEY" },
  revoked: { reasonCode: REASON.accountInvalid, errorCode: "INTEGRATION_REMOVED" },
  newer_format: { reasonCode: REASON.general, errorCode: "UPDATE_PLUGIN" },
  channel_not_found: { reasonCode: REASON.accountInvalid, errorCode: "CHANNEL_NOT_FOUND" },
  network: { reasonCode: REASON.general, errorCode: "TRY_AGAIN" },
  deadline: { reasonCode: REASON.general, errorCode: "TRY_AGAIN" },
  unexpected: { reasonCode: REASON.general, errorCode: "GENERAL_ERROR" }
};

/** The connection's first field: the name of the secret that holds the key (its -config.js). */
export const SECRET_NAME_FIELD = "keySecretName";
/** Its second field: the minutes the customer has to pay an invoice. */
export const MINUTES_FIELD = "minutesToPay";

/**
 * The minutes to pay of the connection's field: a whole number from 1 to 60, spaces around it
 * left aside; DEFAULT_MINUTES_TO_PAY when it is empty or absent; null for anything else.
 */
export function minutesToPayOf(value) {
  if (value === undefined || value === null) return DEFAULT_MINUTES_TO_PAY;
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (text === "") return DEFAULT_MINUTES_TO_PAY;
  if (!/^[0-9]{1,2}$/.test(text)) return null;
  const minutes = Number(text);
  return minutes >= MIN_MINUTES_TO_PAY && minutes <= MAX_MINUTES_TO_PAY ? minutes : null;
}

/**
 * How long a call and each of its steps took, for the logs: "1234 ms (language 5, key 210, …)".
 * Wix gives up on a connection that takes too long, though it may succeed here: measured, the
 * first after publishing took 21 s or more, and Wix said it failed.
 */
function stopwatch() {
  const startedAt = Date.now();
  let last = startedAt;
  const steps = [];
  return {
    lap(name) {
      const now = Date.now();
      steps.push(`${name} ${now - last}`);
      last = now;
    },
    text() {
      return `${Date.now() - startedAt} ms (${steps.join(", ")})`;
    }
  };
}

/**
 * A refused connection. Wix shows its own message, not this one, and then refused the payment
 * method until a connection succeeded, without calling the plugin (measured): the refusal is kept,
 * with its time, for the status page.
 */
async function connectRefused(reasonCode, errorCode, errorMessage, timing) {
  logWarning(`connection refused: ${errorCode}, after ${timing.text()}`);
  await store
    .ensureCollection()
    .then(() => store.saveConfig("connection", { refusedAt: Date.now(), errorCode }))
    .catch((error) => logError("could not keep a refused connection", error));
  return { reasonCode, errorCode, errorMessage };
}

export async function connectAccount(options, ctx) {
  const timing = stopwatch();
  const language = await ctx.language();
  timing.lap("language");
  const credentials = (options && options.credentials) || {};
  const typed =
    typeof credentials[SECRET_NAME_FIELD] === "string" ? credentials[SECRET_NAME_FIELD].trim() : "";
  if (typed.startsWith("sattleme_ck_")) {
    // The key itself, typed where Wix keeps it: refused, never echoed nor kept.
    return connectRefused(
      REASON.authorization,
      "KEY_TYPED",
      t(language, "connect.keyTyped"),
      timing
    );
  }
  if (typed !== KEY_SECRET) {
    return connectRefused(
      REASON.authorization,
      "SECRET_NAME",
      t(language, "connect.secretName"),
      timing
    );
  }
  const minutesToPay = minutesToPayOf(credentials[MINUTES_FIELD]);
  if (minutesToPay === null) {
    // Wix's reason codes have none for a setting: 6000, with the plugin's own code.
    return connectRefused(REASON.general, "MINUTES_TO_PAY", t(language, "connect.minutes"), timing);
  }
  const currency = options && typeof options.currency === "string" ? options.currency : null;
  if (currency && (wixDigits(currency) === null || currencyDigits(currency) === null)) {
    return connectRefused(
      REASON.accountCurrency,
      "CURRENCY_NOT_SUPPORTED",
      t(language, "connect.currency", { currency }),
      timing
    );
  }
  // The payment page is on the site's own address, which its status page keeps.
  if (!(await ctx.siteUrl())) {
    return connectRefused(
      REASON.general,
      "SITE_ADDRESS_UNKNOWN",
      t(language, "connect.noSite"),
      timing
    );
  }
  try {
    const client = await ctx.client();
    timing.lap("key");
    const merchant = await client.merchant(deadline(ctx.timeouts.deadlineMs));
    timing.lap("merchant");
    const identity = client.identity();
    await store.saveConfig("merchant", {
      businessName: merchant.businessName,
      minSats: merchant.minSats,
      maxSats: merchant.maxSats,
      onchainAddresses: merchant.onchainAddresses,
      teamPublicKey: identity.teamPublicKey,
      relays: identity.relays,
      minutesToPay,
      language: pickLanguage((await wix.siteLanguage()) || language),
      connectedAt: Date.now()
    });
    timing.lap("records");
    logInfo(`connected in ${timing.text()}`);
    return {
      credentials: { [SECRET_NAME_FIELD]: KEY_SECRET, [MINUTES_FIELD]: String(minutesToPay) },
      accountId: identity.teamPublicKey,
      accountName: tn(language, "connect.accountName", merchant.onchainAddresses, {
        business: clip(merchant.businessName, 60),
        min: merchant.minSats,
        max: merchant.maxSats,
        addresses: String(merchant.onchainAddresses)
      })
    };
  } catch (failure) {
    const reason = reasonOf(failure);
    const failed = CONNECT_FAILURES[reason] || CONNECT_FAILURES.unexpected;
    const messageKey = CONNECT_FAILURES[reason] ? reason : "unexpected";
    return connectRefused(
      failed.reasonCode,
      failed.errorCode,
      t(language, `connect.${messageKey}`),
      timing
    );
  }
}
