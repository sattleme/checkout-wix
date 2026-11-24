// The plugin with the fake SDK (test/fakes/checkout-sdk.mjs): createTransaction, connectAccount and
// refundTransaction as Wix calls them, every payment status of SPEC.md §3 in a check, every error of
// §5, and what Wix and the merchant are told.

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { beforeEach, test } from "node:test";
import { fileURLToPath } from "node:url";

import * as acorn from "acorn";

import {
  FakeSdkError,
  failNext,
  invoicesOf,
  resetWorld,
  setStatus,
  world
} from "../fakes/sdk-world.mjs";
import { dataError } from "../fakes/state.mjs";
import {
  KEY,
  clock,
  freshSite,
  newOrder,
  payments,
  items,
  site,
  state,
  transactionOptions,
  SITE_URL
} from "../helpers.mjs";

const provider = await site(
  "service-plugins/payment-provider/sattlemeCheckout/sattlemeCheckout.js"
);
const { getConfig } = await site(
  "service-plugins/payment-provider/sattlemeCheckout/sattlemeCheckout-config.js"
);
const { checkPayment, newContext } = await site("sattleme-checkout/payments.js");
const wixData = (await import("wix-data")).default;
const { TIMEOUTS } = await site("sattleme-checkout/constants.js");

// The connection's first field, as the merchant fills it (README, "Configuration").
const CONNECT = { keySecretName: "sattleme-checkout-key" };
// A paid order is read back 2 minutes after its approval at the earliest, then once more 30
// minutes later at the earliest (payments.js, verifyRecorded): at the job's runs, hourly.
const VERIFY_MS = 2 * 60000 + 1000;
const READ_AGAIN_MS = 30 * 60000 + 1000;

beforeEach(() => {
  freshSite();
  resetWorld();
});

/** A payment's record, by its order. */
function paymentOf(order) {
  return payments().find((p) => p.data.orderId === order._id);
}

async function check(order) {
  const item = paymentOf(order);
  return checkPayment(item._id, item.data.lockGen, newContext(TIMEOUTS.job));
}

async function created(order, options) {
  const answer = await provider.createTransaction(transactionOptions(order, options));
  assert.ok(answer.redirectUrl, JSON.stringify(answer));
  return { answer, invoice: invoicesOf(paymentOf(order).data.ref).slice(-1)[0] };
}

function eventsOf(answer) {
  return state.events.filter((e) => e.pluginTransactionId === answer.pluginTransactionId);
}

test("getConfig: the provider, its hosted page, two fields that hold no secret", () => {
  const config = getConfig();
  assert.equal(config.title, "sattle.me Checkout");
  assert.deepEqual(config.paymentMethods, [
    { hostedPage: { title: "Bitcoin (Lightning / on-chain)" } }
  ]);
  // Wix shows no checkbox field (measured): text fields, the secret's name and the time to pay.
  assert.deepEqual(
    config.credentialsFields.map((field) => field.simpleField.name),
    ["keySecretName", "minutesToPay"]
  );
  assert.match(config.credentialsFields[0].simpleField.label, /sattleme-checkout-key/);
  // Wix keeps "Connect" disabled while a field is empty (measured): a number to enter, 15 suggested.
  assert.equal(
    config.credentialsFields[1].simpleField.label,
    "Minutes to pay an invoice: enter 1 to 60 (15 suggested)"
  );
  assert.equal(/empty/i.test(JSON.stringify(config)), false);
});

test("createTransaction: the invoice of the order's price, and the address of its payment page", async () => {
  const order = newOrder();
  const options = transactionOptions(order);
  const answer = await provider.createTransaction(options);
  // Wix's transaction id: the order's reference, and the transaction's number.
  assert.equal(answer.pluginTransactionId, `${paymentOf(order).data.ref}.1`);
  assert.equal(answer.reasonCode, undefined);
  const call = world.calls.find((c) => c.method === "createInvoice").args;
  const payment = paymentOf(order);
  // The order alone: no checkout link (the customer pays on the plugin's own page).
  assert.deepEqual(Object.keys(call).sort(), ["durationSeconds", "fiat", "note", "ref"]);
  assert.deepEqual(call.fiat, { amount: "24.50", currency: "CHF" });
  assert.equal(call.durationSeconds, 900);
  assert.equal(call.ref, payment.data.ref);
  assert.match(call.ref, new RegExp(`^wix\\.${order._id}\\.[A-Za-z0-9_-]{22}$`));
  assert.equal(call.note, `Wix ${order._id.slice(0, 8)}`);
  const tx = payment.data.transactions[0];
  // The page's address: the payment and its transaction's own key (128 random bits).
  assert.match(tx.pageKey, /^[0-9a-f]{32}$/);
  assert.equal(
    answer.redirectUrl,
    `${SITE_URL}/sattlemeCheckoutPay?o=${payment._id}&k=${tx.pageKey}`
  );
  assert.equal(payment.data.state, "open");
  assert.equal(payment.active, true);
  assert.equal(tx.sent, "none");
  // Kept with the transaction: Wix's repetition of this call gets it again.
  assert.deepEqual(tx.answer, answer);
  // The client: the key, short timeouts, two rate sources.
  assert.deepEqual(world.clientOptions.rateSource, ["coingecko", "coinbase"]);
  assert.equal(world.clientOptions.relayTimeoutMs, 3000);
  assert.equal(world.clientOptions.httpTimeoutMs, 3000);
  assert.equal(state.events.length, 0);
});

test("the reference is kept with the order before its first invoice is asked for", async () => {
  const order = newOrder();
  failNext("createInvoice", (args) => {
    const kept = paymentOf(order);
    assert.equal(kept.data.ref, args.ref);
    assert.equal(kept.data.state, "new");
    return new FakeSdkError("network", true);
  });
  const answer = await provider.createTransaction(transactionOptions(order));
  assert.equal(answer.reasonCode, 6000);
  assert.equal(answer.errorCode, "TRY_AGAIN");
  // The next attempt of the same order keeps its reference.
  const ref = paymentOf(order).data.ref;
  await created(order);
  assert.equal(paymentOf(order).data.ref, ref);
});

test("Wix asks again for the same transaction: the same answer, one invoice", async () => {
  const order = newOrder();
  const options = transactionOptions(order);
  const first = await provider.createTransaction(options);
  const again = await provider.createTransaction(options);
  assert.deepEqual(again, first);
  assert.equal(world.calls.filter((c) => c.method === "createInvoice").length, 1);
});

test("without the site's URL (its status page never opened): no payment page, the payment refused", async () => {
  freshSite({ siteUrl: null });
  const answer = await provider.createTransaction(transactionOptions(newOrder()));
  assert.deepEqual([answer.reasonCode, answer.errorCode], [6000, "SITE_ADDRESS_UNKNOWN"]);
  assert.match(answer.errorMessage, /sattlemeCheckoutStatus/);
  assert.equal(world.calls.length, 0);
  assert.equal(payments().length, 0);
  assert.equal(items("refusal").length, 1);
});

test("refusals before any invoice: currency, amount, precision, key", async () => {
  const cases = [
    [{ currency: "BTC" }, 3003, "CURRENCY_NOT_SUPPORTED"],
    [{ currency: "CHE" }, 3003, "CURRENCY_NOT_SUPPORTED"],
    [{ amount: "0" }, 3001, "INVALID_AMOUNT"],
    [{ amount: "12.50" }, 3001, "INVALID_AMOUNT"],
    [{ amount: "199050", currency: "ALL" }, 3001, "AMOUNT_NOT_EXACT"]
  ];
  for (const [options, reasonCode, errorCode] of cases) {
    const answer = await provider.createTransaction(transactionOptions(newOrder(), options));
    assert.equal(answer.reasonCode, reasonCode, JSON.stringify(options));
    assert.equal(answer.errorCode, errorCode);
    assert.equal(typeof answer.errorMessage, "string");
  }
  assert.equal(world.calls.length, 0);
  assert.equal(payments().length, 0);
  // In the site's language: French here.
  freshSite();
  state.siteLanguage = "fr";
  const precise = await provider.createTransaction(
    transactionOptions(newOrder(), { amount: "199050", currency: "ALL" })
  );
  assert.match(precise.errorMessage, /décimales/);
  freshSite({ key: null });
  const noKey = await provider.createTransaction(transactionOptions(newOrder()));
  assert.deepEqual([noKey.reasonCode, noKey.errorCode], [6000, "KEY_MISSING"]);
  // Each kept for the status page.
  assert.equal(items("refusal").length, 1);
});

test("every error of the SDK (SPEC.md §5) in createTransaction", async () => {
  const cases = [
    [new FakeSdkError("invalid_key", false), 6000, "INVALID_KEY"],
    [new FakeSdkError("invalid_option", false, { param: "relayTimeoutMs" }), 6000, "GENERAL_ERROR"],
    [new FakeSdkError("invalid_order", false, { param: "fiat" }), 3001, "AMOUNT_OUT_OF_BOUNDS"],
    [new FakeSdkError("invalid_order", false, { param: "note" }), 6000, "GENERAL_ERROR"],
    [new FakeSdkError("revoked", false), 6000, "INTEGRATION_REMOVED"],
    [
      new FakeSdkError("channel_not_found", true, { newerFormat: false }),
      6000,
      "CHANNEL_NOT_FOUND"
    ],
    [new FakeSdkError("channel_not_found", false, { newerFormat: true }), 6000, "UPDATE_PLUGIN"],
    [new FakeSdkError("network", true), 6000, "TRY_AGAIN"],
    [new FakeSdkError("invalid_invoice", false), 6000, "INVALID_INVOICE"],
    [
      new FakeSdkError("unsupported_currency", false, { currency: "CHF" }),
      3003,
      "CURRENCY_NOT_SUPPORTED"
    ],
    [new FakeSdkError("rate", true), 6000, "TRY_AGAIN"],
    [new FakeSdkError("onchain_unavailable", true), 6000, "ONCHAIN_UNAVAILABLE"],
    [new Error("not an error of the SDK"), 6000, "GENERAL_ERROR"]
  ];
  for (const [error, reasonCode, errorCode] of cases) {
    const order = newOrder();
    failNext("createInvoice", error);
    const answer = await provider.createTransaction(transactionOptions(order));
    assert.equal(answer.reasonCode, reasonCode, error.code);
    assert.equal(answer.errorCode, errorCode, error.code);
    assert.equal(answer.pluginTransactionId, `${paymentOf(order).data.ref}.1`);
    const payment = paymentOf(order);
    assert.equal(payment.data.transactions[0].sent, "declined");
    assert.equal(payment.active, false);
  }
  assert.equal(state.events.length, 0);
  // No check follows a refused payment: it keeps no lock item.
  assert.equal(items("lock").length, 0);
});

test("the SDK past createTransaction's deadline: refused in time, the next attempt resumes", async () => {
  world.delays.set("createInvoice", 20000);
  const order = newOrder();
  const start = Date.now();
  const answer = await provider.createTransaction(transactionOptions(order));
  assert.ok(Date.now() - start < 9500, `${Date.now() - start} ms`);
  assert.deepEqual([answer.reasonCode, answer.errorCode], [6000, "TRY_AGAIN"]);
  world.delays.delete("createInvoice");
  await created(order);
});

test("a new transaction of an order under way: the same invoice, on its own payment page", async () => {
  const order = newOrder();
  const { answer: first } = await created(order);
  const payment = paymentOf(order);
  const answer = await provider.createTransaction(transactionOptions(order));
  const [, tx] = paymentOf(order).data.transactions;
  assert.equal(
    answer.redirectUrl,
    `${SITE_URL}/sattlemeCheckoutPay?o=${payment._id}&k=${tx.pageKey}`
  );
  assert.notEqual(answer.redirectUrl, first.redirectUrl);
  assert.equal(invoicesOf(payment.data.ref).length, 1);
  // Numbered: the order's reference, .1 then .2, what Wix shows on each payment line.
  assert.deepEqual(
    [first.pluginTransactionId, answer.pluginTransactionId],
    [`${payment.data.ref}.1`, `${payment.data.ref}.2`]
  );
});

test("invoice_pending: the invoice the SDK gives back, on the payment page (SPEC.md §21)", async () => {
  const order = newOrder();
  const { invoice } = await created(order);
  failNext(
    "createInvoice",
    () =>
      new FakeSdkError("invoice_pending", false, {
        invoice: Object.assign({}, invoice, { declaredAt: invoice.createdAt })
      })
  );
  // The record lost its invoice (as after a failure): the SDK's answer is the truth.
  const payment = paymentOf(order);
  Object.assign(payment.data, { state: "new", invoice: null });
  state.collections.get("SattlemeCheckout").set(payment._id, payment);
  const answer = await provider.createTransaction(transactionOptions(order));
  assert.match(answer.redirectUrl, /\/sattlemeCheckoutPay\?o=p[0-9a-f]{32}&k=[0-9a-f]{32}$/);
  const after = paymentOf(order).data;
  assert.equal(after.state, "open");
  assert.equal(after.invoice.paymentHash, invoice.paymentHash);
  // Being confirmed on-chain: the same page, which tells so once it checks.
  setStatus(invoice, { state: "unconfirmed", received: invoice.sats, confirmations: 1, txids: [] });
  await check(order);
  assert.equal(paymentOf(order).data.state, "unconfirmed");
  const again = await provider.createTransaction(transactionOptions(order));
  assert.match(again.redirectUrl, /\/sattlemeCheckoutPay\?/);
});

test("invoice_pending or order_paid of another amount: pending for the merchant, never paid", async () => {
  const order = newOrder();
  const { invoice } = await created(order, { amount: "2450" });
  const payment = paymentOf(order);
  Object.assign(payment.data, { state: "new", invoice: null });
  state.collections.get("SattlemeCheckout").set(payment._id, payment);
  setStatus(invoice, { state: "paid", method: "lightning", preimage: "aa".repeat(32) });
  const answer = await provider.createTransaction(transactionOptions(order, { amount: "2600" }));
  assert.equal(answer.reasonCode, 5009);
  const after = paymentOf(order);
  assert.equal(after.data.state, "attention");
  assert.equal(after.data.attention.reason, "mismatch");
  assert.equal(after.data.report.notice, "todo");
});

test("order_paid of the order's price: approved at once, with its proof", async () => {
  const order = newOrder();
  const { invoice } = await created(order);
  const payment = paymentOf(order);
  Object.assign(payment.data, { state: "new", invoice: null });
  state.collections.get("SattlemeCheckout").set(payment._id, payment);
  setStatus(invoice, { state: "paid", method: "lightning", preimage: "bb".repeat(32) });
  const answer = await provider.createTransaction(transactionOptions(order));
  assert.deepEqual(Object.keys(answer), ["pluginTransactionId"]);
  const after = paymentOf(order);
  assert.equal(after.data.state, "paid");
  assert.equal(after.data.proof.preimage, "bb".repeat(32));
  // Its answer approves it: its order is read back, as after an approved event.
  assert.equal(after.data.recorded.state, "todo");
  // The comment with the proof follows from the next check.
  await check(order);
  assert.equal(state.comments.length, 1);
  assert.match(state.comments[0].message, new RegExp("bb".repeat(32)));
  assert.equal(state.events.length, 0);
});

test("a new payment of an order paid, or waiting for the merchant: refused, nothing changes", async () => {
  const order = newOrder();
  const { answer, invoice } = await created(order);
  setStatus(invoice, { state: "paid", method: "lightning", preimage: "56".repeat(32) });
  await check(order);
  const again = await provider.createTransaction(transactionOptions(order));
  assert.deepEqual([again.reasonCode, again.errorCode], [6000, "ALREADY_PAID"]);
  assert.deepEqual(
    state.events.map((e) => e.pluginTransactionId),
    [answer.pluginTransactionId]
  );
  assert.equal(paymentOf(order).data.state, "paid");
  const underpaid = newOrder();
  const second = await created(underpaid, { amount: "245000" });
  setStatus(second.invoice, { state: "expired", received: "10" });
  await check(underpaid);
  const third = await provider.createTransaction(
    transactionOptions(underpaid, { amount: "245000" })
  );
  assert.deepEqual([third.reasonCode, third.errorCode], [6000, "NEEDS_MERCHANT"]);
  assert.equal(world.calls.filter((c) => c.method === "createInvoice").length, 2);
});

test("an invoice of another price than the order's: never shown, pending for the merchant", async () => {
  world.tamper = (invoice) =>
    Object.assign(invoice, {
      fiat: Object.assign({}, invoice.fiat, { minor: "1", amount: "0.01" })
    });
  const order = newOrder();
  const answer = await provider.createTransaction(transactionOptions(order));
  assert.deepEqual(
    [answer.reasonCode, answer.errorCode, answer.redirectUrl],
    [6000, "INVALID_INVOICE", undefined]
  );
  const payment = paymentOf(order);
  assert.equal(payment.data.attention.reason, "mismatch");
  await check(order);
  assert.equal(state.events.length, 0);
  assert.equal(state.notifications.length, 1);
});

/** The payment page's address of each transaction of `order`, in their order. */
function pageUrls(order) {
  const payment = paymentOf(order);
  return payment.data.transactions.map(
    (tx) => `${SITE_URL}/sattlemeCheckoutPay?o=${payment._id}&k=${tx.pageKey}`
  );
}

test("a request that reads the payment while another makes its invoice: no second invoice", async () => {
  const order = newOrder();
  world.delays.set("createInvoice", 600);
  const first = provider.createTransaction(transactionOptions(order));
  // The first one kept the reference, and asks the SDK for the invoice.
  while (!paymentOf(order)) await new Promise((resolve) => setTimeout(resolve, 10));
  const second = await provider.createTransaction(transactionOptions(order));
  const one = await first;
  assert.equal(world.calls.filter((c) => c.method === "createInvoice").length, 1);
  // Each transaction its own page (its own key), both of the one invoice.
  assert.deepEqual([one.redirectUrl, second.redirectUrl], pageUrls(order));
});

test("Wix asks again for a transaction while its invoice is being made: the same answer", async () => {
  // Wix asks again, with the same transaction, when it had no answer within about 15 s; the
  // first call may still be making the invoice (4 s here, more than LOCK_WAIT_MS).
  const order = newOrder();
  const options = transactionOptions(order);
  world.delays.set("createInvoice", 4000);
  const lines = [];
  const info = console.info;
  console.info = (line) => lines.push(line);
  let one;
  let again;
  try {
    const first = provider.createTransaction(options);
    while (!paymentOf(order)) await new Promise((resolve) => setTimeout(resolve, 10));
    again = await provider.createTransaction(JSON.parse(JSON.stringify(options)));
    one = await first;
  } finally {
    console.info = info;
  }
  assert.ok(one.redirectUrl);
  assert.deepEqual(again, one);
  assert.equal(world.calls.filter((c) => c.method === "createInvoice").length, 1);
  assert.equal(items("refusal").length, 0);
  // In the logs: the repetition, and how long each step of the first call took.
  assert.ok(
    lines.includes("[sattleme-checkout] Wix asked again for a transaction: it gets the same answer")
  );
  assert.ok(
    lines.some((line) =>
      /^\[sattleme-checkout\] a transaction answered in \d+ ms \(language \d+, payment \d+, lock \d+, invoice \d+, records \d+\)$/.test(
        line
      )
    ),
    lines.join("\n")
  );
});

test("a lock from a payment's stale generation, after its locks were removed, holds nothing", async () => {
  const order = newOrder();
  const { invoice } = await created(order);
  setStatus(invoice, { state: "paid", method: "lightning", preimage: "78".repeat(32) });
  const before = paymentOf(order);
  await check(order);
  // Settled once its order is read back as paid.
  clock.advance(VERIFY_MS);
  await check(order);
  clock.advance(-VERIFY_MS);
  assert.equal(paymentOf(order).data.recorded.state, "yes");
  assert.equal(items("lock").length, 0);
  // A job that read the payment before it was settled checks it with that generation: it holds
  // nothing, reads the payment again, settled, and leaves it.
  const writes = state.writes;
  const late = await checkPayment(before._id, before.data.lockGen, newContext(TIMEOUTS.job));
  assert.equal(late.checked, undefined);
  assert.equal(late.item.active, false);
  assert.equal(state.events.length, 1);
  // Its lock, of a removed generation, is removed too: an insert and a removal.
  assert.equal(items("lock").length, 0);
  assert.equal(state.writes - writes, 2);
});

test("a payment checked again and again keeps no lock item between its checks", async () => {
  const order = newOrder();
  await created(order);
  for (let i = 0; i < 12; i += 1) await check(order);
  assert.equal(paymentOf(order).data.lockGen, 13);
  assert.deepEqual(items("lock"), []);
});

test("two requests at once for one order: one invoice, a page for each", async () => {
  const order = newOrder();
  world.delays.set("createInvoice", 300);
  const [a, b] = await Promise.all([
    provider.createTransaction(transactionOptions(order)),
    provider.createTransaction(transactionOptions(order))
  ]);
  assert.equal(world.calls.filter((c) => c.method === "createInvoice").length, 1);
  assert.deepEqual([a.redirectUrl, b.redirectUrl].sort(), pageUrls(order).sort());
  assert.notEqual(a.pluginTransactionId, b.pluginTransactionId);
});

test("every payment status (SPEC.md §3) in a check, and Wix's events", async () => {
  const preimage = "cd".repeat(32);
  const cases = [
    // [status, state after, events (reason codes; null: approved), comment?, notification?]
    [
      (i) => ({ state: "open", expiresAt: i.expiresAt, received: "0", rest: null }),
      "open",
      [5009],
      false,
      false
    ],
    [
      (i) => ({
        state: "open",
        expiresAt: i.expiresAt,
        received: "1000",
        rest: { sats: "2", bolt11: null, paymentUri: null }
      }),
      "open",
      [5009],
      false,
      false
    ],
    [
      () => ({ state: "unconfirmed", received: "2450", confirmations: 1, txids: ["t1"] }),
      "unconfirmed",
      [5009],
      false,
      false
    ],
    [() => ({ state: "paid", method: "lightning", preimage }), "paid", [null], true, false],
    [
      () => ({ state: "paid", method: "onchain", received: "2450", txids: ["t1", "t2"] }),
      "paid",
      [null],
      true,
      false
    ],
    [
      () => ({
        state: "paid",
        method: "mixed",
        received: "2450",
        txids: ["t1"],
        preimages: [preimage]
      }),
      "paid",
      [null],
      true,
      false
    ],
    [() => ({ state: "expired", received: "0" }), "expired", [3035], false, false],
    [() => ({ state: "expired", received: "1200" }), "attention", [5009], true, true]
  ];
  for (const [status, after, events, comment, notification] of cases) {
    freshSite();
    resetWorld();
    const order = newOrder();
    const { answer, invoice } = await created(order, { amount: "245000" });
    setStatus(invoice, status(invoice));
    const result = await check(order);
    assert.equal(result.checked, true);
    const payment = paymentOf(order);
    assert.equal(payment.data.state, after, JSON.stringify(status(invoice)));
    assert.deepEqual(
      eventsOf(answer).map((e) => (e.reasonCode === undefined ? null : e.reasonCode)),
      events
    );
    assert.equal(state.comments.length, comment ? 1 : 0, after);
    assert.equal(state.notifications.length, notification ? 1 : 0, after);
    // Checked again: nothing more is sent.
    if (payment.active) await check(order);
    assert.equal(eventsOf(answer).length, events.length);
  }
});

test("the proof of a payment is kept on the order: method, preimages, transactions, received", async () => {
  const order = newOrder();
  const { invoice } = await created(order, { amount: "245000" });
  setStatus(invoice, {
    state: "paid",
    method: "mixed",
    received: "2450",
    txids: ["aa", "bb"],
    preimages: ["01".repeat(32)]
  });
  await check(order);
  const payment = paymentOf(order);
  assert.deepEqual(
    {
      method: payment.data.proof.method,
      received: payment.data.proof.received,
      txids: payment.data.proof.txids,
      preimages: payment.data.proof.preimages
    },
    { method: "mixed", received: "2450", txids: ["aa", "bb"], preimages: ["01".repeat(32)] }
  );
  const comment = state.comments[0].message;
  for (const part of [
    "aa",
    "bb",
    "01".repeat(32),
    "2450",
    payment.data.ref,
    "on-chain + Lightning"
  ]) {
    assert.ok(comment.includes(part), part);
  }
  // Its order read back 2 minutes after its approval: Wix shows it paid. Settled: no more checks,
  // its locks removed.
  assert.equal(payment.active, true);
  assert.equal(payment.data.recorded.state, "todo");
  clock.advance(VERIFY_MS);
  await check(order);
  clock.advance(-VERIFY_MS);
  const settled = paymentOf(order);
  assert.deepEqual(
    [settled.data.recorded.state, settled.data.recorded.paymentStatus],
    ["yes", "PAID"]
  );
  assert.equal(settled.active, false);
  assert.equal(items("lock").length, 0);
  assert.equal(state.events.length, 1);
});

test("a paid order Wix shows paid at its second read: settled then, the merchant not told", async () => {
  const order = newOrder();
  const { invoice } = await created(order);
  setStatus(invoice, { state: "paid", method: "lightning", preimage: "79".repeat(32) });
  state.applyEvents = false;
  await check(order);
  clock.advance(VERIFY_MS);
  await check(order);
  const first = paymentOf(order).data.recorded;
  assert.deepEqual([first.state, first.paymentStatus], ["todo", "NOT_PAID"]);
  state.orders.get(order._id).paymentStatus = "PAID";
  clock.advance(READ_AGAIN_MS);
  await check(order);
  clock.advance(-(VERIFY_MS + READ_AGAIN_MS));
  const payment = paymentOf(order);
  assert.deepEqual([payment.data.recorded.state, payment.data.state], ["yes", "paid"]);
  assert.equal(payment.active, false);
  assert.deepEqual(
    [state.notifications.length, state.tasks.length, state.events.length],
    [0, 0, 1]
  );
});

test("a paid order whose order Wix never gives back: the logs say so, the merchant is not told", async () => {
  const order = newOrder();
  const { invoice } = await created(order);
  setStatus(invoice, { state: "paid", method: "lightning", preimage: "7a".repeat(32) });
  await check(order);
  state.failures.set("getOrder", Infinity);
  // A check before its time reads nothing: 2 reads, 30 minutes apart at least.
  await check(order);
  assert.equal(paymentOf(order).data.recorded.lookups, 0);
  clock.advance(VERIFY_MS);
  await check(order);
  await check(order);
  assert.equal(paymentOf(order).data.recorded.lookups, 1);
  clock.advance(READ_AGAIN_MS);
  await check(order);
  clock.advance(-(VERIFY_MS + READ_AGAIN_MS));
  const payment = paymentOf(order);
  assert.deepEqual([payment.data.recorded.state, payment.data.recorded.lookups], ["unknown", 2]);
  assert.equal(payment.data.state, "paid");
  assert.equal(payment.active, false);
  assert.deepEqual(
    [state.notifications.length, state.tasks.length, state.events.length],
    [0, 0, 1]
  );
});

test("an underpayment that expired: pending, a comment with what was received, due, and where", async () => {
  state.siteLanguage = "en";
  const order = newOrder();
  const { answer, invoice } = await created(order, { amount: "245000" });
  setStatus(invoice, { state: "expired", received: "1200" });
  await check(order);
  assert.deepEqual(
    eventsOf(answer).map((e) => e.reasonCode),
    [5009]
  );
  const [comment] = state.comments;
  assert.equal(comment.orderId, order._id);
  assert.ok(
    comment.message.includes(
      `Received 1200 of ${invoice.sats} sats (on-chain to the deposit address ${invoice.onchainAddress}, ` +
        "and in Lightning by any invoice of the rest that was paid)"
    ),
    comment.message
  );
  assert.ok(comment.message.includes(invoice.onchainAddress));
  const [notification] = state.notifications;
  assert.deepEqual(notification.channels, ["Dashboard", "Mobile"]);
  assert.equal(notification.options.recipients.role, "Owner");
  assert.ok(notification.body.includes(order.number));
  assert.equal(notification.options.actionTarget.url, `${SITE_URL}/sattlemeCheckoutStatus`);
});

test("paid after the order was canceled: never approved; pending, a comment, a notification", async () => {
  const order = newOrder();
  const { answer, invoice } = await created(order);
  state.orders.get(order._id).status = "CANCELED";
  setStatus(invoice, { state: "paid", method: "lightning", preimage: "ef".repeat(32) });
  await check(order);
  assert.deepEqual(
    eventsOf(answer).map((e) => e.reasonCode),
    [5009]
  );
  const payment = paymentOf(order);
  assert.equal(payment.data.attention.reason, "canceled");
  // What the status page shows as received: the invoice's amount, paid in Lightning, never "0".
  assert.equal(payment.data.received, invoice.sats);
  assert.ok(state.comments[0].message.includes("ef".repeat(32)));
  assert.equal(state.notifications.length, 1);
});

test("an order whose total changed after its invoice, paid at the invoice's amount: left to the merchant", async () => {
  // Wix lets a merchant edit an order ("Editing Orders": its items, prices, fees, discounts). The
  // payment found paid, the order's total now is not the invoice's price: never approved; pending,
  // a comment with what was received and the total now, a task, a notification.
  state.siteLanguage = "en";
  const order = newOrder();
  const { answer, invoice } = await created(order);
  state.orders.get(order._id).priceSummary = { total: { amount: "30.00" } };
  setStatus(invoice, { state: "paid", method: "lightning", preimage: "c4".repeat(32) });
  await check(order);
  const payment = paymentOf(order);
  assert.deepEqual([payment.data.state, payment.data.attention.reason], ["attention", "changed"]);
  assert.deepEqual(
    eventsOf(answer).map((e) => e.reasonCode),
    [5009]
  );
  const [comment] = state.comments;
  // Paid in Lightning, which gives no `received`: what came is the invoice's amount, never "0".
  assert.equal(payment.data.received, invoice.sats);
  assert.ok(
    comment.message.startsWith(
      `sattle.me: paid (${invoice.sats} sats received for the invoice's ${invoice.sats} sats, 24.50 CHF), but the order's total is now 30.00 CHF`
    ),
    comment.message
  );
  assert.ok(comment.message.includes("c4".repeat(32)));
  assert.equal(state.tasks.length, 1);
  assert.ok(
    state.tasks[0].title.includes(
      `paid ${invoice.sats} of ${invoice.sats} sats (24.50 CHF), total now 30.00 CHF`
    ),
    state.tasks[0].title
  );
  assert.equal(state.notifications.length, 1);
  assert.equal(payment.active, false);
  // Paid on-chain, short of the amount within the merchant's tolerance: what came, not the
  // invoice's amount.
  const onchain = newOrder();
  const third = await created(onchain);
  state.orders.get(onchain._id).priceSummary = { total: { amount: "30.00" } };
  const came = String((BigInt(third.invoice.sats) * 97n) / 100n);
  setStatus(third.invoice, { state: "paid", method: "onchain", received: came, txids: ["d1"] });
  await check(onchain);
  assert.equal(paymentOf(onchain).data.received, came);
  const onchainComment = state.comments[state.comments.length - 1].message;
  assert.ok(
    onchainComment.startsWith(
      `sattle.me: paid (${came} sats received for the invoice's ${third.invoice.sats} sats, 24.50 CHF)`
    ),
    onchainComment
  );
  assert.ok(onchainComment.includes(`Received ${came} of ${third.invoice.sats} sats`));
  assert.ok(
    state.tasks[state.tasks.length - 1].title.includes(`paid ${came} of ${third.invoice.sats} sats`)
  );
  // The same total, the part a gift card paid aside: approved.
  const giftCard = newOrder();
  const second = await created(giftCard);
  Object.assign(state.orders.get(giftCard._id), {
    priceSummary: { total: { amount: "30" } },
    balanceSummary: { paid: { amount: "5.5" } }
  });
  setStatus(second.invoice, { state: "paid", method: "lightning", preimage: "c5".repeat(32) });
  await check(giftCard);
  assert.deepEqual(
    eventsOf(second.answer).map((e) => (e.reasonCode === undefined ? "approved" : e.reasonCode)),
    ["approved"]
  );
});

test("a paid order Wix cannot read: approved at the second try (the job's next run)", async () => {
  const order = newOrder();
  const { answer, invoice } = await created(order);
  setStatus(invoice, { state: "paid", method: "lightning", preimage: "12".repeat(32) });
  state.failures.set("getOrder", 2);
  await check(order);
  assert.equal(eventsOf(answer).length, 0);
  assert.equal(paymentOf(order).active, true);
  await check(order);
  assert.deepEqual(eventsOf(answer), [
    {
      wixTransactionId: paymentOf(order).data.transactions[0].wixTransactionId,
      pluginTransactionId: answer.pluginTransactionId
    }
  ]);
});

test("an event Wix refuses is sent again at the next check, once", async () => {
  const order = newOrder();
  const { answer, invoice } = await created(order);
  setStatus(invoice, { state: "paid", method: "lightning", preimage: "34".repeat(32) });
  state.failures.set("submitEvent", 1);
  await check(order);
  assert.equal(eventsOf(answer).length, 0);
  const payment = paymentOf(order);
  assert.equal(payment.active, true);
  assert.equal(payment.data.lastError.code, "submit_event");
  // Retried later, without asking the SDK again.
  const calls = world.calls.length;
  await check(order);
  assert.equal(world.calls.length, calls);
  assert.equal(eventsOf(answer).length, 1);
  await check(order).catch(() => {});
  assert.equal(eventsOf(answer).length, 1);
});

/** The next check, `ms` later (the job's next run, or the page's next view). */
async function checkLater(order, ms = 70000) {
  clock.advance(ms);
  try {
    return await check(order);
  } finally {
    clock.advance(-ms);
  }
}

/**
 * Refuses the first save of a payment record that holds what `told(data)` says Wix or the merchant
 * was told: WDE0014 (past the site's writes a minute), or, `applied`, done but answered past Wix
 * Data's time limit (WDE0028).
 */
function refuseSaveOnceTold(told, applied) {
  const save = wixData.save;
  wixData.save = async (name, item, options) => {
    if (item.kind !== "payment" || !told(item.data)) return save.call(wixData, name, item, options);
    wixData.save = save;
    if (!applied) throw dataError("WDE0014", "Requests per minute quota exceeded.");
    await save.call(wixData, name, item, options);
    throw dataError("WDE0028", "Operation time limit exceeded.");
  };
  return () => (wixData.save = save);
}

test("a write refused after Wix and the merchant were told: they are told once (the outbox)", async () => {
  // The audit's case: the approval and the proof comment sent, then the record's save refused, or
  // done but answered past Wix Data's time limit. The check saved what it was about to send
  // first: the next one sends nothing again.
  for (const applied of [false, true]) {
    freshSite();
    resetWorld();
    const order = newOrder();
    const { answer, invoice } = await created(order);
    setStatus(invoice, { state: "paid", method: "lightning", preimage: "cd".repeat(32) });
    const restore = refuseSaveOnceTold(
      (data) => data.transactions.some((tx) => tx.sent === "approved"),
      applied
    );
    try {
      await assert.rejects(check(order), { code: applied ? "WDE0028" : "WDE0014" });
    } finally {
      restore();
    }
    assert.deepEqual([eventsOf(answer).length, state.comments.length], [1, 1]);
    await checkLater(order);
    assert.deepEqual(
      eventsOf(answer).map((e) => e.reasonCode),
      [undefined],
      `applied: ${applied}`
    );
    assert.equal(state.comments.filter((c) => c.message.includes("cd".repeat(32))).length, 1);
    // Its order read back as after any approval: the payment settles.
    await checkLater(order, VERIFY_MS);
    assert.deepEqual(
      [paymentOf(order).data.recorded.state, paymentOf(order).active],
      ["yes", false]
    );
  }
});

test("the outbox's own save refused: nothing told yet, then told once", async () => {
  const order = newOrder();
  const { answer, invoice } = await created(order);
  setStatus(invoice, { state: "paid", method: "lightning", preimage: "ce".repeat(32) });
  state.failures.set("wixData.save", 1);
  await assert.rejects(check(order));
  assert.deepEqual([eventsOf(answer).length, state.comments.length], [0, 0]);
  await checkLater(order);
  assert.deepEqual([eventsOf(answer).length, state.comments.length], [1, 1]);
});

test("an underpayment told, then the record's save refused: one task, one notification, one comment", async () => {
  const order = newOrder();
  const { invoice } = await created(order, { amount: "245000" });
  setStatus(invoice, { state: "expired", received: "20000" });
  const restore = refuseSaveOnceTold((data) => !!data.report && data.report.task === "done");
  try {
    await assert.rejects(check(order), { code: "WDE0014" });
  } finally {
    restore();
  }
  assert.equal(state.tasks.length, 1);
  await checkLater(order);
  assert.deepEqual(
    [state.tasks.length, state.notifications.length, state.comments.length],
    [1, 1, 1]
  );
  assert.equal(paymentOf(order).active, false);
});

test("a comment or task Wix made but answered with an error is not made again; one it refused is", async () => {
  const order = newOrder();
  const { invoice } = await created(order, { amount: "245000" });
  setStatus(invoice, { state: "expired", received: "20000" });
  // Made, then an error (past Wix's time limit): looked for at the next check, and found.
  state.failures.set("addActivities", { times: 1, applied: true });
  state.failures.set("createTask", { times: 1, applied: true });
  // Refused before it was made: sent again.
  state.failures.set("notify", 1);
  await check(order);
  const after = paymentOf(order).data.report;
  assert.deepEqual([after.comment, after.task, after.notice], ["sending", "sending", "todo"]);
  await checkLater(order);
  assert.deepEqual(
    [state.comments.length, state.tasks.length, state.notifications.length],
    [1, 1, 1]
  );
  assert.equal(paymentOf(order).active, false);
  // Refused before they were made: not found, made at the next check.
  const other = newOrder();
  const second = await created(other, { amount: "245000" });
  setStatus(second.invoice, { state: "expired", received: "30000" });
  state.failures.set("addActivities", 1);
  state.failures.set("createTask", 1);
  await check(other);
  await checkLater(other);
  assert.deepEqual([state.comments.length, state.tasks.length], [2, 2]);
  assert.equal(state.comments[1].orderId, other._id);
});

test("a check that tells Wix something writes 4 times: its outbox first", async () => {
  const order = newOrder();
  const made = state.writes;
  await created(order);
  // An invoice made: its lock, its reference kept, its record, its lock removed.
  assert.equal(state.writes - made, 4);
  const before = state.writes;
  await check(order);
  // Its lock, its outbox (the pending event to send), its record, its lock removed.
  assert.equal(state.writes - before, 4);
  const again = state.writes;
  await checkLater(order, 10000);
  assert.equal(state.writes - again, 3);
});

test("a paid order's approval goes to the transaction it was paid through, not to one Wix makes after", async () => {
  const order = newOrder();
  const { answer, invoice } = await created(order);
  await check(order);
  setStatus(invoice, { state: "paid", method: "lightning", preimage: "e1".repeat(32) });
  state.failures.set("submitEvent", 1);
  await checkLater(order, 10000);
  // Wix makes another transaction of the order: refused, already paid; Wix's events never go to it.
  const again = await provider.createTransaction(transactionOptions(order));
  assert.deepEqual([again.reasonCode, again.errorCode], [6000, "ALREADY_PAID"]);
  await checkLater(order, 3600000);
  assert.deepEqual(
    eventsOf(answer).map((e) => (e.reasonCode === undefined ? "approved" : e.reasonCode)),
    [5009, "approved"]
  );
  assert.deepEqual(eventsOf(again), []);
  const [paid, refused] = paymentOf(order).data.transactions;
  assert.deepEqual([paid.refused, refused.refused], [undefined, true]);
  assert.equal(paymentOf(order).data.paidTx, paid.wixTransactionId);
});

test("a check that fails is retried, never sends anything; the next that reads the invoice, pending", async () => {
  const order = newOrder();
  const { answer } = await created(order);
  for (const error of [
    new FakeSdkError("network", true),
    new FakeSdkError("invalid_invoice", false),
    new FakeSdkError("revoked", false)
  ]) {
    failNext("getStatus", error);
    await check(order);
    const payment = paymentOf(order);
    assert.equal(payment.data.lastError.code, error.code);
    assert.equal(payment.active, true);
  }
  assert.equal(eventsOf(answer).length, 0);
  // The invoice read, open: the customer has its page. Pending, once.
  await check(order);
  await check(order);
  assert.deepEqual(
    eventsOf(answer).map((e) => e.reasonCode),
    [5009]
  );
});

test("a check that fails says why in the logs, masked, on one line", async (t) => {
  const order = newOrder();
  const { invoice } = await created(order);
  const lines = [];
  t.mock.method(console, "warn", (line) => lines.push(line));
  const reasons = [
    "No answer from mempool.space",
    `a relay answered ${KEY}`,
    "The payment check was refused: busy\n[sattleme-checkout] forged",
    "x".repeat(400)
  ];
  for (const message of reasons) {
    failNext("getStatus", new FakeSdkError("network", true, { message }));
    await check(order);
  }
  // An error of the plugin's, not of the SDK: its own message.
  setStatus(invoice, { state: "refunded" });
  await check(order);
  // No key: no reason.
  state.secrets.delete("sattleme-checkout-key");
  await check(order);
  assert.deepEqual(
    lines.filter((line) => line.includes("a payment check failed")),
    [
      "[sattleme-checkout] a payment check failed: network (No answer from mempool.space)",
      "[sattleme-checkout] a payment check failed: network (a relay answered [secret])",
      "[sattleme-checkout] a payment check failed: network (The payment check was refused: busy [sattleme-checkout] forged)",
      `[sattleme-checkout] a payment check failed: network (${"x".repeat(300)})`,
      "[sattleme-checkout] a payment check failed: unexpected (a payment status of an unknown state: refunded)",
      "[sattleme-checkout] a payment check failed: no_key"
    ]
  );
});

test("never two contradictory events: pending once, then one final event", async () => {
  const order = newOrder();
  const { answer, invoice } = await created(order, { amount: "245000" });
  const sequence = [
    { state: "unconfirmed", received: "2450", confirmations: 0, txids: ["t"] },
    { state: "open", expiresAt: invoice.expiresAt, received: "0", rest: null },
    { state: "unconfirmed", received: "2450", confirmations: 1, txids: ["t"] },
    { state: "paid", method: "onchain", received: "2450", txids: ["t"] }
  ];
  for (const status of sequence) {
    setStatus(invoice, status);
    await check(order);
  }
  assert.deepEqual(
    eventsOf(answer).map((e) => (e.reasonCode === undefined ? null : e.reasonCode)),
    [5009, null]
  );
});

test("refundTransaction: refused, the merchant refunds from the app", async () => {
  const answer = await provider.refundTransaction({
    pluginTransactionId: "sattleme-x",
    refundAmount: "100"
  });
  assert.equal(answer.reasonCode, 3022);
  assert.equal(answer.errorCode, "REFUND_NOT_ALLOWED");
});

test("connectAccount: the key checked with merchant(); the business, its bounds, its lot", async () => {
  state.siteLanguage = "en";
  const answer = await provider.connectAccount({
    credentials: { keySecretName: "sattleme-checkout-key" },
    country: "CH",
    currency: "CHF"
  });
  assert.deepEqual(answer, {
    credentials: { keySecretName: "sattleme-checkout-key", minutesToPay: "15" },
    accountId: "ab".repeat(32),
    accountName: "Sunrise Bakery · 1 to 10000000 sats · 40 on-chain addresses"
  });
  const merchant = state.collections.get("SattlemeCheckout").get("merchant").data;
  assert.equal(merchant.businessName, "Sunrise Bakery");
  assert.equal(merchant.language, "en");
  // No secret in what Wix keeps, nor in the plugin's records.
  assert.equal(JSON.stringify(answer).includes("sattleme_ck_"), false);
  assert.equal(
    JSON.stringify([...state.collections.get("SattlemeCheckout").values()]).includes(
      "sattleme_ck_"
    ),
    false
  );
});

test("connectAccount: how long each step took, in the logs; never a secret", async () => {
  const lines = [];
  const info = console.info;
  const warn = console.warn;
  console.info = (line) => lines.push(line);
  console.warn = (line) => lines.push(line);
  try {
    await provider.connectAccount({ currency: "CHF", credentials: CONNECT });
    await provider.connectAccount({ currency: "CHF", credentials: { keySecretName: "x" } });
  } finally {
    console.info = info;
    console.warn = warn;
  }
  assert.match(
    lines[0],
    /^\[sattleme-checkout\] connected in \d+ ms \(language \d+, key \d+, merchant \d+, records \d+\)$/
  );
  assert.match(
    lines[1],
    /^\[sattleme-checkout\] connection refused: SECRET_NAME, after \d+ ms \(language \d+\)$/
  );
  assert.equal(lines.join("\n").includes("sattleme_ck_"), false);
});

test("connectAccount refusals: the currency, the key, the SDK's errors", async () => {
  const unsupported = await provider.connectAccount({ currency: "CHE", credentials: CONNECT });
  assert.deepEqual(
    [unsupported.reasonCode, unsupported.errorCode],
    [2009, "CURRENCY_NOT_SUPPORTED"]
  );
  freshSite({ key: null });
  const noKey = await provider.connectAccount({ currency: "CHF", credentials: CONNECT });
  assert.deepEqual([noKey.reasonCode, noKey.errorCode], [2004, "KEY_MISSING"]);
  // Before the status page was opened (no collection, no site address): the payment page would
  // have no address. The refusal is kept, for the status page.
  freshSite({ collection: false });
  const noSite = await provider.connectAccount({ currency: "CHF", credentials: CONNECT });
  assert.deepEqual([noSite.reasonCode, noSite.errorCode], [6000, "SITE_ADDRESS_UNKNOWN"]);
  assert.match(noSite.errorMessage, /sattlemeCheckoutStatus/);
  assert.equal(world.calls.length, 0);
  assert.equal(
    state.collections.get("SattlemeCheckout").get("connection").data.errorCode,
    "SITE_ADDRESS_UNKNOWN"
  );
  freshSite({ key: "not-a-key" });
  const badKey = await provider.connectAccount({ currency: "CHF", credentials: CONNECT });
  assert.deepEqual([badKey.reasonCode, badKey.errorCode], [2004, "INVALID_KEY"]);
  freshSite();
  for (const [error, code] of [
    [new FakeSdkError("revoked", false), "INTEGRATION_REMOVED"],
    [new FakeSdkError("network", true), "TRY_AGAIN"],
    [new FakeSdkError("channel_not_found", false, { newerFormat: true }), "UPDATE_PLUGIN"]
  ]) {
    failNext("merchant", error);
    const answer = await provider.connectAccount({ currency: "CHF", credentials: CONNECT });
    assert.equal(answer.errorCode, code);
    assert.equal(typeof answer.errorMessage, "string");
  }
});

/** The text of a string literal, or of literals joined with +; null for anything else. */
function literalText(node) {
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  if (node.type === "BinaryExpression" && node.operator === "+") {
    const left = literalText(node.left);
    const right = literalText(node.right);
    return left === null || right === null ? null : left + right;
  }
  return null;
}

/**
 * Every warning of the installed SDK (the one the bundle holds) that tells of a record of a newer
 * format than it reads (SPEC.md §12): the literal texts its code passes to a logger's warn().
 */
function newerFormatWarnings() {
  const dist = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "node_modules",
    "@sattleme",
    "checkout",
    "dist"
  );
  const texts = new Set();
  const visit = (node) => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node.type !== "string") return;
    const callee = node.type === "CallExpression" ? node.callee : null;
    if (callee && callee.type === "MemberExpression" && callee.property.name === "warn") {
      const text = node.arguments.length ? literalText(node.arguments[0]) : null;
      if (text !== null && /newer format/.test(text)) texts.add(text);
    }
    for (const value of Object.values(node)) {
      if (value && typeof value === "object") visit(value);
    }
  };
  for (const entry of readdirSync(dist, { recursive: true })) {
    if (!String(entry).endsWith(".js")) continue;
    const code = readFileSync(join(dist, String(entry)), "utf8");
    visit(acorn.parse(code, { ecmaVersion: "latest", sourceType: "module" }));
  }
  return [...texts].sort();
}

test("every warning of the SDK of a newer format is kept for the status page", async () => {
  const texts = newerFormatWarnings();
  // Its channel, its lot of addresses, a lease of them, an order's declarations and leases,
  // witnesses, acceptance records and records of a rest: seven, at checkout-node a891826.
  assert.ok(texts.length >= 7, texts.join("\n"));
  world.warnings = texts;
  await provider.connectAccount({ currency: "CHF", credentials: CONNECT });
  await new Promise((resolve) => setTimeout(resolve, 20));
  const kept = items("warning")
    .map((item) => item.data.text)
    .sort();
  assert.deepEqual(kept, texts);
});

test("connectAccount: the field must name the secret; a key typed there is refused, never kept", async () => {
  for (const credentials of [{}, { keySecretName: "" }, { keySecretName: "my-key" }]) {
    const answer = await provider.connectAccount({ currency: "CHF", credentials });
    assert.deepEqual([answer.reasonCode, answer.errorCode], [2004, "SECRET_NAME"]);
    assert.match(answer.errorMessage, /sattleme-checkout-key/);
  }
  const typed = "sattleme_ck_typed-in-the-field-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
  const answer = await provider.connectAccount({
    currency: "CHF",
    credentials: { keySecretName: typed }
  });
  assert.deepEqual([answer.reasonCode, answer.errorCode], [2004, "KEY_TYPED"]);
  assert.equal(JSON.stringify(answer).includes(typed), false);
  assert.equal(world.calls.length, 0);
  // Kept for the status page: its code and time, never what was typed.
  const kept = state.collections.get("SattlemeCheckout").get("connection").data;
  assert.equal(kept.errorCode, "KEY_TYPED");
  assert.equal(typeof kept.refusedAt, "number");
  assert.equal(
    JSON.stringify([...state.collections.get("SattlemeCheckout").values()]).includes(typed),
    false
  );
  // Spaces around the name are not a mistake.
  const spaced = await provider.connectAccount({
    currency: "CHF",
    credentials: { keySecretName: " sattleme-checkout-key " }
  });
  assert.deepEqual(spaced.credentials, {
    keySecretName: "sattleme-checkout-key",
    minutesToPay: "15"
  });
});

test("connectAccount: the time to pay, 1 to 60 minutes, 15 when empty; anything else refused", async () => {
  state.siteLanguage = "en";
  for (const [typed, kept] of [
    [undefined, "15"],
    ["", "15"],
    ["  ", "15"],
    ["1", "1"],
    [" 30 ", "30"],
    ["05", "5"],
    ["60", "60"]
  ]) {
    const answer = await provider.connectAccount({
      currency: "CHF",
      credentials: { keySecretName: "sattleme-checkout-key", minutesToPay: typed }
    });
    assert.equal(answer.credentials.minutesToPay, kept, String(typed));
    const merchant = state.collections.get("SattlemeCheckout").get("merchant").data;
    assert.equal(merchant.minutesToPay, Number(kept));
  }
  const calls = world.calls.length;
  for (const typed of ["0", "61", "100", "-5", "1.5", "15 min", "quinze", "１５"]) {
    const answer = await provider.connectAccount({
      currency: "CHF",
      credentials: { keySecretName: "sattleme-checkout-key", minutesToPay: typed }
    });
    assert.deepEqual([answer.reasonCode, answer.errorCode], [6000, "MINUTES_TO_PAY"], typed);
    assert.equal(
      answer.errorMessage,
      "The time to pay is a whole number of minutes, from 1 to 60 (empty: 15)."
    );
  }
  // Refused before the key is used.
  assert.equal(world.calls.length, calls);
});

test("createTransaction: the invoice lasts the connection's time to pay", async () => {
  const durations = [];
  for (const minutesToPay of ["5", "60", undefined, "not minutes"]) {
    resetWorld();
    const options = transactionOptions(newOrder());
    options.merchantCredentials = { keySecretName: "sattleme-checkout-key", minutesToPay };
    const answer = await provider.createTransaction(options);
    assert.ok(answer.redirectUrl, JSON.stringify(answer));
    const call = world.calls.find((c) => c.method === "createInvoice").args;
    durations.push(call.durationSeconds);
  }
  // A value connectAccount would have refused (an older connection's): the default, 15 minutes.
  assert.deepEqual(durations, [300, 3600, 900, 900]);
});

test("a payment that needs the merchant: a task in the dashboard, linked to the customer", async () => {
  state.siteLanguage = "en";
  const order = newOrder({
    number: "0",
    buyerInfo: { contactId: "c0ffee42-0000-4000-8000-000000000042" }
  });
  const { invoice } = await created(order, { amount: "245000" });
  setStatus(invoice, { state: "expired", received: "1200" });
  await check(order);
  assert.equal(state.tasks.length, 1);
  const [task] = state.tasks;
  assert.equal(task.contact._id, "c0ffee42-0000-4000-8000-000000000042");
  assert.equal(task.status, "ACTION_NEEDED");
  // Wix numbers an order once it is placed: before, the invoice's note names it ("Wix 8c1b2a3d"),
  // as the merchant's app shows its sale.
  const note = paymentOf(order).data.note;
  assert.match(note, /^Wix [0-9a-f-]{8}$/);
  // Wix's dashboard shows a task's title alone: what happened and what to do.
  assert.equal(
    task.title,
    `Order ${note}: 1200 of ${invoice.sats} sats received, invoice expired. Settle with the ` +
      "customer from your sattle.me app (details: the plugin's status page)."
  );
  for (const part of [
    `Received 1200 of ${invoice.sats} sats`,
    invoice.onchainAddress,
    order._id,
    "not in the list of orders"
  ]) {
    assert.ok(task.description.includes(part), part);
  }
  // The notification sends the merchant to the task; the task does not name itself.
  assert.ok(state.notifications[0].body.includes(note));
  assert.ok(state.notifications[0].body.includes("Details in the dashboard's task"));
  assert.equal(task.title.includes("dashboard's task"), false, task.title);
  // Once: the payment is settled.
  await check(order).catch(() => {});
  assert.equal(state.tasks.length, 1);
  assert.equal(paymentOf(order).active, false);
});

test("a task Wix refuses is made again at the next check; a paid order gets no task", async () => {
  const order = newOrder();
  const { invoice } = await created(order, { amount: "245000" });
  setStatus(invoice, { state: "expired", received: "10" });
  state.failures.set("createTask", 1);
  await check(order);
  assert.equal(state.tasks.length, 0);
  assert.equal(paymentOf(order).active, true);
  await check(order);
  assert.equal(state.tasks.length, 1);
  assert.equal(state.comments.length, 1);
  const paid = newOrder();
  const second = await created(paid);
  setStatus(second.invoice, { state: "paid", method: "lightning", preimage: "9a".repeat(32) });
  await check(paid);
  assert.equal(state.tasks.length, 1);
});

test("the measured case: an underpayment's task fits Wix's 500 characters, its facts first", async () => {
  // Measured on a Wix site: the task of an underpayment that expired, in French, had a description
  // of 624 characters, which Wix refused (INVALID_ARGUMENT), and no task was made.
  state.siteLanguage = "fr";
  const order = newOrder({ number: "0" });
  const { invoice } = await created(order, { amount: "245000" });
  setStatus(invoice, { state: "expired", received: "1200" });
  await check(order);
  assert.equal(state.tasks.length, 1);
  const [task] = state.tasks;
  const { ref } = paymentOf(order).data;
  assert.ok(task.description.length <= 500, String(task.description.length));
  assert.ok(task.title.length <= 250, String(task.title.length));
  const lines = task.description.split("\n");
  // What identifies the payment first, whole; then what came of what was due, and where.
  assert.equal(lines[0], `Référence sattle.me : ${ref}`);
  assert.equal(
    lines[1],
    `Commande Wix : ${order._id} (absente de la liste des commandes tant qu'elle n'est pas payée).`
  );
  assert.equal(lines[2], `Reçu 1200 sats sur ${invoice.sats}.`);
  assert.equal(lines[3], `Adresse de dépôt : ${invoice.onchainAddress}`);
  assert.equal(lines[4], `Montant : ${invoice.sats} sats, pour 2450.00 CHF.`);
  assert.equal(paymentOf(order).data.report.task, "done");
  // The comment holds all of it, under Wix's 5000 characters.
  assert.ok(state.comments[0].message.startsWith("sattle.me : paiement insuffisant"));
  assert.ok(state.comments[0].message.endsWith(`Référence sattle.me : ${ref}`));
});

test("long values: every text Wix takes within its limits, cut at a character boundary", async () => {
  // Half of a surrogate pair, alone: a text cut inside a character.
  const lone = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;
  for (const language of ["en", "fr", "de", "it"]) {
    freshSite();
    resetWorld();
    state.siteLanguage = language;
    // An order with a long number, paid on-chain and in Lightning in 50 parts each, after it was
    // canceled; and an order whose total changed to a long amount.
    const id = "ffffffff-eeee-4ddd-8ccc-bbbbbbbbbbbb";
    const order = newOrder({ _id: id, number: "9".repeat(40) });
    state.orders.set(id, order);
    const { invoice } = await created(order, { amount: "999999999" });
    state.orders.get(id).status = "CANCELED";
    const txids = Array.from({ length: 50 }, (_, i) => i.toString(16).padStart(64, "a"));
    const preimages = Array.from({ length: 50 }, (_, i) => i.toString(16).padStart(64, "b"));
    setStatus(invoice, {
      state: "paid",
      method: "mixed",
      received: invoice.sats,
      txids,
      preimages
    });
    await check(order);
    const changed = newOrder();
    const second = await created(changed, { amount: "245000" });
    state.orders.get(changed._id).priceSummary = { total: { amount: "123456789012.34" } };
    setStatus(second.invoice, { state: "paid", method: "lightning", preimage: "9a".repeat(32) });
    await check(changed);
    assert.equal(state.tasks.length, 2, language);
    assert.equal(state.comments.length, 2, language);
    for (const task of state.tasks) {
      assert.ok(task.title.length <= 250 && task.description.length <= 500, language);
      assert.equal(lone.test(task.description) || lone.test(task.title), false, language);
    }
    const [comment] = state.comments;
    assert.ok(comment.message.length <= 5000, `${language} ${comment.message.length}`);
    // Its first line and its reference whole, which the plugin looks for (the outbox).
    assert.ok(comment.message.endsWith(paymentOf(order).data.ref), language);
    assert.ok(comment.message.includes(txids[0]), language);
    for (const notification of state.notifications) assert.ok(notification.body.length <= 512);
    assert.deepEqual(
      [paymentOf(order).data.report, paymentOf(changed).data.report].map((r) => r.task),
      ["done", "done"]
    );
  }
});

test("a contact id Wix would refuse (not a GUID) is left out of the task, which is made", async () => {
  const order = newOrder({ buyerInfo: { contactId: "not-a-guid" } });
  const { invoice } = await created(order, { amount: "245000" });
  setStatus(invoice, { state: "expired", received: "1200" });
  await check(order);
  assert.equal(state.tasks.length, 1);
  assert.equal(state.tasks[0].contact, undefined);
});

test("a business name past 60 characters: the account's name cut at a character boundary", async () => {
  world.merchant.businessName = `${"B".repeat(59)}\u{1F950}${"C".repeat(10)}`;
  const answer = await provider.connectAccount({ credentials: CONNECT, currency: "CHF" });
  assert.ok(answer.accountName.includes(`${"B".repeat(59)}…`), answer.accountName);
  assert.equal(answer.accountName.includes("\ud83e"), false);
});

test("paid within the merchant's tolerance: the comment says so; confirmations no longer counted", async () => {
  state.siteLanguage = "en";
  const order = newOrder();
  const { invoice } = await created(order, { amount: "245000" });
  const short = String((BigInt(invoice.sats) * 97n) / 100n);
  setStatus(invoice, { state: "unconfirmed", received: short, confirmations: 2, txids: ["t9"] });
  await check(order);
  assert.equal(paymentOf(order).data.confirmations, 2);
  setStatus(invoice, { state: "paid", method: "onchain", received: short, txids: ["t9"] });
  await check(order);
  assert.equal(paymentOf(order).data.confirmations, null);
  assert.ok(
    state.comments[0].message.includes(
      `Received ${short} of ${invoice.sats} sats: accepted by the business in its sattle.me app`
    ),
    state.comments[0].message
  );
  // Paid in full: no such line.
  const full = newOrder();
  const other = await created(full, { amount: "245000" });
  setStatus(other.invoice, {
    state: "paid",
    method: "onchain",
    received: other.invoice.sats,
    txids: ["u"]
  });
  await check(full);
  assert.equal(state.comments[1].message.includes("tolerance"), false);
});

test("paid by the merchant's acceptance, far short, mixed: approved, never left to the merchant", async () => {
  // The merchant's acceptance (SPEC.md §31): accepted by hand in the app, below any tolerance.
  state.siteLanguage = "fr";
  const order = newOrder();
  const { invoice } = await created(order, { amount: "245000" });
  const short = String((BigInt(invoice.sats) * 30n) / 100n);
  setStatus(invoice, { state: "unconfirmed", received: short, confirmations: 1, txids: ["a1"] });
  await check(order);
  assert.equal(paymentOf(order).data.state, "unconfirmed");
  setStatus(invoice, {
    state: "paid",
    method: "mixed",
    received: short,
    txids: ["a1"],
    preimages: ["5a".repeat(32)]
  });
  await check(order);
  const { data } = paymentOf(order);
  assert.equal(data.state, "paid");
  assert.equal(data.attention, null);
  assert.equal(data.proof.received, short);
  assert.equal(state.tasks.length, 0);
  assert.equal(state.notifications.length, 0);
  assert.ok(
    state.comments[0].message.includes(
      `Reçu ${short} sats sur ${invoice.sats} : accepté par le commerce dans son app sattle.me`
    ),
    state.comments[0].message
  );
});

test("an invoice of 1 000 sats or more made without an address: a warning on the status page", async () => {
  world.merchant.onchainAddresses = 0;
  const order = newOrder();
  const { answer } = await created(order, { amount: "245000" });
  assert.ok(answer.redirectUrl);
  const [warning] = items("warning");
  assert.equal(warning.data.kind, "lightningOnly");
  assert.equal(warning.data.ref, paymentOf(order).data.ref);
  // Another one: the same item, counted, with the last one's reference.
  const next = newOrder();
  await created(next, { amount: "245000" });
  const all = items("warning");
  assert.equal(all.length, 1);
  assert.equal(all[0].data.count, 2);
  assert.equal(all[0].data.ref, paymentOf(next).data.ref);
  // Below 1 000 sats, Lightning only is the rule (SPEC.md §31): no warning.
  freshSite();
  resetWorld();
  world.merchant.onchainAddresses = 0;
  await created(newOrder(), { amount: "50" });
  assert.equal(items("warning").length, 0);
});

test("an on-chain payment still unconfirmed: checked for 90 days after its invoice, then the merchant's", async () => {
  state.siteLanguage = "en";
  const order = newOrder();
  const { answer, invoice } = await created(order, { amount: "245000" });
  setStatus(invoice, {
    state: "unconfirmed",
    received: invoice.sats,
    confirmations: 0,
    txids: ["c9"]
  });
  const end = (invoice.expiresAt + 120) * 1000;
  const at = (ms) => {
    clock.advance(end + ms - Date.now());
    return check(order);
  };
  try {
    // 30 days after its invoice's end (the plugin's limit before): still waiting, still checked.
    await at(30 * 86400000 + 60000);
    assert.equal(paymentOf(order).data.state, "unconfirmed");
    assert.equal(paymentOf(order).active, true);
    assert.equal(state.tasks.length, 0);
    // 90 days after it: the merchant's, with a comment, a task and a notification.
    await at(90 * 86400000 + 60000);
    const payment = paymentOf(order);
    assert.deepEqual([payment.data.state, payment.data.attention.reason], ["attention", "stale"]);
    assert.match(state.comments[0].message, /still not final 90 days after its invoice's end/);
    assert.match(state.tasks[0].title, /payment not final 90 days after its invoice/);
    assert.equal(state.notifications.length, 1);
    // Wix keeps the order pending: no event but the first one.
    assert.deepEqual(
      eventsOf(answer).map((e) => e.reasonCode),
      [5009]
    );
  } finally {
    clock.reset();
  }
});

test("a payment checked, failed or not, is due again at once: at the job's next run", async () => {
  const order = newOrder();
  const { invoice } = await created(order, { amount: "245000" });
  const due = () => paymentOf(order).dueAt - Date.now();
  try {
    assert.ok(due() <= 0);
    failNext("getStatus", new FakeSdkError("network", true), 2);
    await check(order);
    assert.ok(due() <= 0);
    // Being confirmed, past the end of its grace period: the same.
    setStatus(invoice, {
      state: "unconfirmed",
      received: invoice.sats,
      confirmations: 1,
      txids: ["c8"]
    });
    clock.advance((invoice.expiresAt + 120) * 1000 + 60000 - Date.now());
    await check(order);
    assert.equal(paymentOf(order).data.lastError.code, "network");
    assert.ok(due() <= 0);
    await check(order);
    assert.equal(paymentOf(order).data.lastError, null);
    assert.ok(paymentOf(order).active && due() <= 0);
  } finally {
    clock.reset();
  }
});

test("the comment of a paid order: its amount, price and rate, its address, its transactions' pages", async () => {
  state.siteLanguage = "en";
  const order = newOrder();
  const { invoice } = await created(order, { amount: "245000" });
  const txid = "ab".repeat(32);
  setStatus(invoice, { state: "paid", method: "onchain", received: invoice.sats, txids: [txid] });
  await check(order);
  const lines = state.comments[0].message.split("\n");
  assert.deepEqual(lines, [
    "sattle.me: paid.",
    `Amount: ${invoice.sats} sats, for 2450.00 CHF.`,
    "Rate: 1 bitcoin = 100000 CHF (coingecko).",
    "Method: on-chain",
    `Deposit address: ${invoice.onchainAddress}`,
    `Transactions: https://mempool.space/tx/${txid}`,
    `Received: ${invoice.sats} sats`,
    `sattle.me reference: ${paymentOf(order).data.ref}`
  ]);
  // Paid in Lightning, the same invoice's address unused: no address.
  const other = newOrder();
  const second = await created(other, { amount: "245000" });
  assert.ok(second.invoice.onchainAddress);
  setStatus(second.invoice, { state: "paid", method: "lightning", preimage: "cd".repeat(32) });
  await check(other);
  assert.equal(state.comments[1].message.includes("Deposit address"), false);
  assert.ok(
    state.comments[1].message.includes(
      `Preimage (proof of the Lightning payment): ${"cd".repeat(32)}`
    )
  );
});

test("an invoice the registry gave back (order_paid) has no rate: the comment says none", async () => {
  state.siteLanguage = "en";
  const order = newOrder();
  const { invoice } = await created(order);
  const payment = paymentOf(order);
  Object.assign(payment.data, { state: "new", invoice: null });
  state.collections.get("SattlemeCheckout").set(payment._id, payment);
  setStatus(invoice, { state: "paid", method: "lightning", preimage: "ef".repeat(32) });
  await provider.createTransaction(transactionOptions(order));
  await check(order);
  const message = state.comments[0].message;
  assert.ok(message.includes(`Amount: ${invoice.sats} sats, for 24.50 CHF.`), message);
  assert.equal(message.includes("Rate:"), false);
});
