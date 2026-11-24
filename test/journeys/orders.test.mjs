// The whole journey of an order, as on a Wix site: createTransaction, the customer on the payment
// page (each view checks the payment; the page loads itself again every 10 s, every 30 s while a
// payment is being confirmed), the hourly job for what the page leaves (a customer who left,
// on-chain confirmations, the invoice's end, the order read back), Wix's events, the order's
// comment and the merchant's notification. The SDK is the fake (test/fakes/checkout-sdk.mjs):
// each step sets what the merchant's registry and the payment checks would say then.

import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import { invoicesOf, resetWorld, setStatus, world } from "../fakes/sdk-world.mjs";
import {
  clock,
  freshSite,
  newOrder,
  payments,
  request,
  site,
  state,
  transactionOptions,
  STATUS_TOKEN
} from "../helpers.mjs";

const provider = await site(
  "service-plugins/payment-provider/sattlemeCheckout/sattlemeCheckout.js"
);
const http = await site("http-functions.js");
const jobs = await site("sattleme-checkout/jobs.js");

const HOUR = 60 * 60000;
let elapsed = 0;

beforeEach(() => {
  freshSite();
  resetWorld();
  clock.advance(-elapsed);
  elapsed = 0;
});

function wait(ms) {
  clock.advance(ms);
  elapsed += ms;
}

/** `ms` later (an hour by default), a run of the background job. */
async function later(ms = HOUR) {
  wait(ms);
  await jobs.runJob({ lifeMs: 2000, marginMs: 0 });
}

/** `ms` later (the page's refresh, 10 s), the customer's view of the payment page `page`. */
async function view(page, ms = 10000) {
  wait(ms);
  return http.get_sattlemeCheckoutPay(request({ query: page }));
}

/** Where a view of the payment page sends the customer: its page (200) or Wix's (303). */
function sent(reply) {
  return reply.status === 303 ? reply.headers.Location : reply.status;
}

/** The order placed, Wix's createTransaction, the customer sent to the payment page. */
async function checkout(amount = "245000") {
  const order = newOrder();
  const options = transactionOptions(order, { amount });
  const answer = await provider.createTransaction(options);
  assert.ok(answer.redirectUrl);
  const payment = () => payments().find((p) => p.data.orderId === order._id);
  const invoice = invoicesOf(payment().data.ref).slice(-1)[0];
  const page = Object.fromEntries(new URL(answer.redirectUrl).searchParams);
  return { order, urls: options.order.returnUrls, answer, payment, invoice, page };
}

const codes = (answer) =>
  state.events
    .filter((e) => e.pluginTransactionId === answer.pluginTransactionId)
    .map((e) => (e.reasonCode === undefined ? "approved" : e.reasonCode));

test("paid in Lightning on the page: sent to Wix's success page", async () => {
  const { answer, payment, invoice, page, urls } = await checkout("2450");
  // The customer has the page: pending, from its first view.
  assert.equal(sent(await view(page, 0)), 200);
  assert.deepEqual(codes(answer), [5009]);
  setStatus(invoice, { state: "paid", method: "lightning", preimage: "11".repeat(32) });
  assert.equal(sent(await view(page)), urls.successUrl);
  assert.deepEqual(codes(answer), [5009, "approved"]);
  assert.match(state.comments[0].message, /Lightning/);
  // Its order read back at the job's next run: Wix shows it paid. Nothing more to do.
  assert.equal(payment().active, true);
  await later();
  assert.equal(payment().data.recorded.state, "yes");
  assert.equal(payment().active, false);
  // The page opened again: success, nothing sent again.
  assert.equal(sent(await view(page)), urls.successUrl);
  assert.deepEqual(codes(answer), [5009, "approved"]);
});

test("paid, but Wix did not record it: the merchant is told, the customer sent to success", async () => {
  // Wix answers the event, and leaves the order unpaid (measured on declined events).
  state.applyEvents = false;
  const { answer, payment, invoice, page, urls, order } = await checkout("2450");
  await view(page, 0);
  setStatus(invoice, { state: "paid", method: "lightning", preimage: "66".repeat(32) });
  assert.equal(sent(await view(page)), urls.successUrl);
  assert.deepEqual(codes(answer), [5009, "approved"]);
  assert.equal(state.comments.length, 1);
  // Read back at the job's next run, then at the one after: then the merchant is told.
  await later();
  assert.equal(payment().data.state, "paid");
  assert.equal(state.notifications.length, 0);
  await later();
  const { data } = payment();
  assert.equal(data.state, "attention");
  assert.equal(data.attention.reason, "unrecorded");
  assert.deepEqual([data.recorded.state, data.recorded.lookups], ["no", 2]);
  assert.equal(data.recorded.paymentStatus, "NOT_PAID");
  // Wix is told nothing more.
  assert.deepEqual(codes(answer), [5009, "approved"]);
  // The merchant: a second comment with the proof, a notification, a task, the status page.
  assert.equal(state.comments.length, 2);
  assert.equal(state.comments[1].orderId, order._id);
  assert.ok(state.comments[1].message.includes("66".repeat(32)));
  assert.match(state.comments[1].message, /Wix n'a pas enregistré le paiement/);
  assert.equal(state.notifications.length, 1);
  assert.equal(state.tasks.length, 1);
  assert.ok(
    state.tasks[0].title.startsWith(
      `Commande ${order.number} : payée, mais Wix n'a pas enregistré le paiement.`
    )
  );
  const status = await http.post_sattlemeCheckoutStatus(
    request({ body: `t=${encodeURIComponent(STATUS_TOKEN)}` })
  );
  assert.ok(status.body.includes("payée, non enregistrée par Wix"));
  // The customer, who paid: Wix's success page.
  assert.equal(sent(await view(page)), urls.successUrl);
  // Nothing more, ever.
  await later();
  assert.deepEqual(codes(answer), [5009, "approved"]);
  assert.equal(state.comments.length, 2);
  assert.equal(payment().active, false);
});

test("paid, its approval refused once: the customer waits, Wix's next transaction refused, the paid one approved", async () => {
  // The audit's case. Before, the page sent the customer to Wix's success page though Wix had
  // refused the approval; Wix then made another transaction of the order, the plugin refused it
  // (already paid), events went to that latest transaction alone, and the paid one was never
  // approved: the payment settled, the order unpaid at Wix, nobody told.
  const { answer, payment, invoice, page, urls, order } = await checkout("2450");
  await view(page, 0);
  setStatus(invoice, { state: "paid", method: "lightning", preimage: "ef".repeat(32) });
  state.failures.set("submitEvent", 1);
  const reply = await view(page);
  assert.equal(reply.status, 200);
  assert.ok(reply.body.includes("Der Shop erfasst Ihre Bestellung"), reply.body);
  assert.equal(reply.body.includes("<svg class"), false);
  assert.deepEqual(codes(answer), [5009]);
  // Wix asks to pay the order again, with another transaction: refused, already paid.
  const again = await provider.createTransaction(transactionOptions(order));
  assert.deepEqual([again.reasonCode, again.errorCode], [6000, "ALREADY_PAID"]);
  // The job's next run approves the transaction the customer paid through, and no other.
  await later();
  assert.deepEqual(codes(answer), [5009, "approved"]);
  assert.deepEqual(codes(again), []);
  assert.equal(state.orders.get(order._id).paymentStatus, "PAID");
  await later();
  assert.deepEqual([payment().data.recorded.state, payment().active], ["yes", false]);
  assert.deepEqual([state.tasks.length, state.notifications.length], [0, 0]);
  assert.equal(sent(await view(page)), urls.successUrl);
});

test("paid, its approval refused a minute: given up, the merchant told, the customer sent on", async () => {
  const { answer, payment, invoice, page, urls, order } = await checkout("2450");
  await view(page, 0);
  setStatus(invoice, { state: "paid", method: "lightning", preimage: "f0".repeat(32) });
  state.failures.set("submitEvent", Infinity);
  // The customer waits while Wix refuses (a view every 10 s): two tries at least, over a minute.
  const replies = [];
  for (let i = 0; i < 7; i += 1) replies.push(sent(await view(page)));
  assert.deepEqual(replies, [200, 200, 200, 200, 200, 200, urls.successUrl]);
  const { data } = payment();
  assert.deepEqual([data.state, data.attention.reason], ["attention", "unrecorded"]);
  // The merchant: the proof's comment, then the one saying Wix did not record it; a task; a
  // notification.
  assert.equal(state.comments.length, 2);
  assert.match(state.comments[1].message, /Wix n'a pas enregistré le paiement/);
  assert.ok(state.comments[1].message.includes("f0".repeat(32)));
  assert.equal(state.tasks.length, 1);
  assert.ok(state.tasks[0].title.startsWith(`Commande ${order.number} : payée, mais Wix`));
  assert.equal(state.notifications.length, 1);
  // Wix is told nothing more, even once it takes events again.
  state.failures.delete("submitEvent");
  await later();
  assert.deepEqual(codes(answer), [5009]);
  assert.equal(payment().active, false);
  assert.equal(sent(await view(page)), urls.successUrl);
});

test("paid after the customer left the page: approved at the job's next run", async () => {
  const { answer, payment, invoice, page, urls } = await checkout("2450");
  assert.equal(sent(await view(page, 0)), 200);
  // The customer closed the page, then paid from their wallet: nothing checks it until the job.
  wait(5 * 60000);
  setStatus(invoice, { state: "paid", method: "lightning", preimage: "77".repeat(32) });
  assert.deepEqual(codes(answer), [5009]);
  await later(55 * 60000);
  assert.deepEqual(codes(answer), [5009, "approved"]);
  assert.ok(state.comments[0].message.includes("77".repeat(32)));
  // Its order read back at the run after (2 minutes after its approval at the earliest).
  assert.equal(payment().data.recorded.state, "todo");
  await later();
  assert.equal(payment().data.recorded.state, "yes");
  assert.equal(payment().active, false);
  // Back on the page: Wix's success page.
  assert.equal(sent(await view(page)), urls.successUrl);
});

test("paid on-chain: being confirmed on the page, the customer leaves, paid at 3 confirmations", async () => {
  const { answer, payment, invoice, page, urls } = await checkout();
  setStatus(invoice, {
    state: "unconfirmed",
    received: invoice.sats,
    confirmations: 0,
    txids: ["c0"]
  });
  const reply = await view(page, 0);
  assert.equal(reply.status, 200);
  assert.ok(reply.body.includes("(0 von 3 Bestätigungen, etwa 30 Minuten)"));
  assert.ok(reply.body.includes(`<a href="${urls.pendingUrl}">Zurück zum Shop</a>`));
  assert.ok(reply.body.includes('<meta http-equiv="refresh" content="30">'));
  assert.deepEqual(codes(answer), [5009]);
  assert.equal(payment().data.state, "unconfirmed");
  // The customer went back to the shop. The invoice ends; the job checks it, hourly, while it is
  // being confirmed.
  await later();
  assert.equal(payment().active, true);
  assert.deepEqual(codes(answer), [5009]);
  setStatus(invoice, { state: "paid", method: "onchain", received: invoice.sats, txids: ["c0"] });
  await later();
  assert.deepEqual(codes(answer), [5009, "approved"]);
  assert.match(state.comments[0].message, /c0/);
});

test("paid in part on-chain, then the rest in Lightning, the customer on the page", async () => {
  const { answer, invoice, page, urls } = await checkout();
  const part = String(BigInt(invoice.sats) / 2n);
  const restUri = `bitcoin:${invoice.onchainAddress}?amount=0.0001&lightning=lnbc-rest`;
  setStatus(invoice, {
    state: "open",
    expiresAt: invoice.expiresAt,
    received: part,
    rest: { sats: part, bolt11: "lnbc-rest", paymentUri: restUri }
  });
  let reply = await view(page, 0);
  assert.ok(reply.body.includes(`Zahlen Sie den Rest: ${part} Sats.`));
  assert.ok(reply.body.includes(restUri.replace(/&/g, "&amp;")));
  assert.deepEqual(codes(answer), [5009]);
  setStatus(invoice, {
    state: "unconfirmed",
    received: invoice.sats,
    confirmations: 1,
    txids: ["c1"]
  });
  reply = await view(page);
  assert.ok(reply.body.includes("(1 von 3 Bestätigungen, etwa 30 Minuten)"));
  setStatus(invoice, {
    state: "paid",
    method: "mixed",
    received: invoice.sats,
    txids: ["c1"],
    preimages: ["22".repeat(32)]
  });
  assert.equal(sent(await view(page, 30000)), urls.successUrl);
  assert.deepEqual(codes(answer), [5009, "approved"]);
  assert.ok(state.comments[0].message.includes("22".repeat(32)));
});

test("paid in part, then expired, the customer gone: pending for the merchant, with a comment and a notification", async () => {
  const { answer, payment, invoice, order, page, urls } = await checkout();
  setStatus(invoice, {
    state: "open",
    expiresAt: invoice.expiresAt,
    received: "500000",
    rest: { sats: "1950000", bolt11: null, paymentUri: null }
  });
  await view(page, 0);
  setStatus(invoice, { state: "expired", received: "500000" });
  await later();
  assert.deepEqual(codes(answer), [5009]);
  assert.equal(payment().data.attention.reason, "underpaid");
  assert.equal(payment().active, false);
  const [comment] = state.comments;
  assert.equal(comment.orderId, order._id);
  for (const part of ["500000", invoice.sats, invoice.onchainAddress])
    assert.ok(comment.message.includes(part), part);
  assert.equal(state.notifications.length, 1);
  // The customer back on the page: what came of what was due, and the way to Wix's pending page.
  // Nothing more, ever.
  const final = await view(page);
  assert.equal(final.status, 200);
  assert.ok(final.body.includes(`500000 von ${invoice.sats} Sats erhalten`));
  assert.ok(final.body.includes(`<a href="${urls.pendingUrl}">Zurück zum Shop</a>`));
  await later();
  assert.deepEqual(codes(answer), [5009]);
  assert.equal(state.comments.length, 1);
});

test("accepted by the merchant's tolerance: a little short, unconfirmed, then paid", async () => {
  const { answer, invoice, page, urls } = await checkout();
  const short = String((BigInt(invoice.sats) * 95n) / 100n);
  setStatus(invoice, { state: "unconfirmed", received: short, confirmations: 0, txids: ["c2"] });
  await view(page, 0);
  setStatus(invoice, { state: "paid", method: "onchain", received: short, txids: ["c2"] });
  assert.equal(sent(await view(page, 30000)), urls.successUrl);
  assert.deepEqual(codes(answer), [5009, "approved"]);
  assert.ok(state.comments[0].message.includes(short));
});

test("accepted by the merchant by hand: far short, its rest shown, then unconfirmed and paid", async () => {
  // The merchant's acceptance (SPEC.md §31): what an order underpaid on-chain received, accepted
  // in the sattle.me app, far below any tolerance. The SDK then reports it as the tolerance.
  state.siteLanguage = "en";
  const { answer, payment, invoice, page, urls } = await checkout();
  const short = String((BigInt(invoice.sats) * 40n) / 100n);
  const rest = String(BigInt(invoice.sats) - BigInt(short));
  setStatus(invoice, {
    state: "open",
    expiresAt: invoice.expiresAt,
    received: short,
    rest: { sats: rest, bolt11: null, paymentUri: null }
  });
  assert.equal(sent(await view(page, 0)), 200);
  setStatus(invoice, { state: "unconfirmed", received: short, confirmations: 0, txids: ["c3"] });
  assert.equal(sent(await view(page)), 200);
  assert.equal(payment().data.state, "unconfirmed");
  setStatus(invoice, { state: "paid", method: "onchain", received: short, txids: ["c3"] });
  assert.equal(sent(await view(page, 30000)), urls.successUrl);
  assert.deepEqual(codes(answer), [5009, "approved"]);
  assert.equal(payment().data.state, "paid");
  assert.equal(payment().data.attention, null);
  assert.equal(state.tasks.length, 0);
  assert.equal(state.notifications.length, 0);
  assert.equal(state.comments.length, 1);
  assert.ok(
    state.comments[0].message.includes(
      `Received ${short} of ${invoice.sats} sats: accepted by the business in its sattle.me app`
    ),
    state.comments[0].message
  );
  // Read back at the job's next run: Wix shows it paid, nothing more to do.
  await later();
  assert.equal(payment().data.recorded.state, "yes");
  assert.equal(payment().active, false);
});

test("expired with nothing received, the customer gone: declined (3035) at the job's run after its end", async () => {
  const { answer, payment, page, urls } = await checkout();
  await view(page, 0);
  // A run during the invoice's 15 minutes: still open.
  await later(10 * 60000);
  assert.deepEqual(codes(answer), [5009]);
  assert.equal(payment().active, true);
  await later();
  assert.deepEqual(codes(answer), [5009, 3035]);
  assert.equal(payment().data.state, "expired");
  assert.equal(payment().active, false);
  assert.equal(state.comments.length, 0);
  // The customer back on the page: Wix's error page.
  assert.equal(sent(await view(page)), urls.errorUrl);
});

test("an invoice in progress resumed: its answer lost, the next attempt gets its page", async () => {
  const order = newOrder();
  world.delays.set("createInvoice.after", 20000);
  const lost = await provider.createTransaction(transactionOptions(order));
  assert.deepEqual([lost.reasonCode, lost.errorCode], [6000, "TRY_AGAIN"]);
  world.delays.delete("createInvoice.after");
  const ref = payments()[0].data.ref;
  assert.equal(invoicesOf(ref).length, 1);
  const options = transactionOptions(order);
  const again = await provider.createTransaction(options);
  assert.match(again.redirectUrl, /\/sattlemeCheckoutPay\?o=p[0-9a-f]{32}&k=[0-9a-f]{32}$/);
  assert.equal(invoicesOf(ref).length, 1);
  setStatus(invoicesOf(ref)[0], { state: "paid", method: "lightning", preimage: "33".repeat(32) });
  const page = Object.fromEntries(new URL(again.redirectUrl).searchParams);
  assert.equal(sent(await view(page, 0)), options.order.returnUrls.successUrl);
  assert.deepEqual(codes(again), ["approved"]);
  assert.deepEqual(codes(lost), []);
});

test("two requests at once for one order: one invoice, a page for each, one approval", async () => {
  const order = newOrder();
  world.delays.set("createInvoice", 200);
  const options = [transactionOptions(order), transactionOptions(order)];
  const answers = await Promise.all(options.map((o) => provider.createTransaction(o)));
  world.delays.delete("createInvoice");
  assert.notEqual(answers[0].redirectUrl, answers[1].redirectUrl);
  const ref = payments()[0].data.ref;
  assert.equal(invoicesOf(ref).length, 1);
  setStatus(invoicesOf(ref)[0], { state: "paid", method: "lightning", preimage: "44".repeat(32) });
  // Each page sends its customer to its own transaction's success page.
  for (const [i, answer] of answers.entries()) {
    const page = Object.fromEntries(new URL(answer.redirectUrl).searchParams);
    assert.equal(sent(await view(page)), options[i].order.returnUrls.successUrl);
  }
  assert.equal(state.events.length, 1);
  assert.equal(state.events[0].reasonCode, undefined);
});

test("a payment proven after the order was canceled: never reopened in silence", async () => {
  const { answer, invoice, order, payment, page, urls } = await checkout();
  await view(page, 0);
  state.orders.get(order._id).status = "CANCELED";
  state.orders.get(order._id).number = "10077";
  setStatus(invoice, { state: "paid", method: "lightning", preimage: "55".repeat(32) });
  // The customer, who paid: Wix's pending page; the merchant settles it.
  assert.equal(sent(await view(page)), urls.pendingUrl);
  assert.deepEqual(codes(answer), [5009]);
  assert.equal(payment().data.attention.reason, "canceled");
  assert.ok(state.comments[0].message.includes("55".repeat(32)));
  assert.match(state.notifications[0].body, /10077/);
});
