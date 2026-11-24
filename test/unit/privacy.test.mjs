// A customer's data as Wix's contacts erase it (privacy.js, through backend/events.js): what a
// payment keeps of its customer, removed when Wix deletes the contact, at once once settled, else
// once settled; a merge moves the payments to the contact kept, and erases nothing.

import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import { resetWorld, setStatus } from "../fakes/sdk-world.mjs";
import {
  clock,
  freshSite,
  items,
  newOrder,
  payments,
  request,
  site,
  state,
  transactionOptions
} from "../helpers.mjs";

const provider = await site(
  "service-plugins/payment-provider/sattlemeCheckout/sattlemeCheckout.js"
);
const events = await site("events.js");
const http = await site("http-functions.js");
const jobs = await site("sattleme-checkout/jobs.js");
const { checkPayment, newContext } = await site("sattleme-checkout/payments.js");
const { TIMEOUTS } = await site("sattleme-checkout/constants.js");

// A paid order is read back 2 minutes after its approval (payments.js, verifyRecorded).
const VERIFY_MS = 2 * 60000 + 1000;

beforeEach(() => {
  freshSite();
  resetWorld();
  clock.reset();
});

function paymentOf(order) {
  return payments().find((p) => p.data.orderId === order._id);
}

function check(order) {
  const item = paymentOf(order);
  return checkPayment(item._id, item.data.lockGen, newContext(TIMEOUTS.job));
}

/** An order of `contactId` paid on-chain by `txid`, its payment settled (no check follows). */
async function settledOnchain(contactId, txid) {
  const order = newOrder({ buyerInfo: { contactId } });
  const options = transactionOptions(order, { amount: "245000" });
  const answer = await provider.createTransaction(options);
  order.page = Object.fromEntries(new URL(answer.redirectUrl).searchParams);
  order.successUrl = options.order.returnUrls.successUrl;
  const { invoice } = paymentOf(order).data;
  setStatus(invoice, { state: "paid", method: "onchain", received: invoice.sats, txids: [txid] });
  await check(order);
  clock.advance(VERIFY_MS);
  await check(order);
  assert.equal(paymentOf(order).active, false);
  return order;
}

function deleted(contactId, fields) {
  return events.wixCrm_onContactDeleted({
    metadata: Object.assign(
      { id: "e1", entityId: contactId, eventTime: new Date(Date.now()).toISOString() },
      fields || {}
    )
  });
}

test("a contact deleted: its settled payments lose their address, transactions and contact", async () => {
  const txid = "77".repeat(32);
  const order = await settledOnchain("contact-7", txid);
  const before = paymentOf(order);
  assert.equal(before.contactId, "contact-7");
  const kept = {
    ref: before.data.ref,
    price: before.data.price,
    sats: before.data.invoice.sats,
    rate: before.data.invoice.rate,
    state: before.data.state,
    method: before.data.proof.method,
    received: before.data.proof.received,
    orderId: before.data.orderId
  };
  const other = await settledOnchain("contact-8", "88".repeat(32));

  const result = await deleted("contact-7", { triggeredByAnonymizeRequest: true });
  assert.deepEqual([result.payments, result.erased, result.busy, result.failed], [1, 1, 0, 0]);
  const after = paymentOf(order);
  assert.equal(after.contactId, null);
  assert.equal(after.data.contactId, null);
  assert.equal(after.data.invoice.onchainAddress, null);
  assert.equal(after.data.invoice.paymentUri, null);
  assert.deepEqual([after.data.invoice.bolt11, after.data.invoice.verifyUrl], [null, null]);
  assert.deepEqual([after.data.txids, after.data.proof.txids], [[], []]);
  assert.equal(after.data.erased.anonymize, true);
  // Its payment page shows nothing of it: final, it sends the customer to Wix's page.
  const reply = await http.get_sattlemeCheckoutPay(request({ query: order.page }));
  assert.deepEqual([reply.status, reply.headers.Location], [303, order.successUrl]);
  // Nothing of the address or the transaction left anywhere in the record.
  const text = JSON.stringify(after);
  assert.equal(text.includes(txid), false);
  assert.equal(text.includes(before.data.invoice.onchainAddress), false);
  // What the merchant's accounting needs stays.
  assert.deepEqual(
    {
      ref: after.data.ref,
      price: after.data.price,
      sats: after.data.invoice.sats,
      rate: after.data.invoice.rate,
      state: after.data.state,
      method: after.data.proof.method,
      received: after.data.proof.received,
      orderId: after.data.orderId
    },
    kept
  );
  // Another customer's payment is untouched.
  assert.ok(paymentOf(other).data.invoice.onchainAddress);
  assert.equal(paymentOf(other).data.erased, undefined);
  // The deletion is kept as a hash of the contact's id, never the id.
  const [erasure] = items("erasure");
  assert.equal(JSON.stringify(erasure).includes("contact-7"), false);
  // No lock left behind: no check follows a settled payment.
  assert.equal(items("lock").length, 0);
});

test("a payment still being checked keeps its address until final; its comment then has none", async () => {
  state.siteLanguage = "en";
  const order = newOrder({ buyerInfo: { contactId: "contact-9" } });
  await provider.createTransaction(transactionOptions(order, { amount: "245000" }));
  const { invoice } = paymentOf(order).data;
  const txid = "99".repeat(32);
  setStatus(invoice, {
    state: "unconfirmed",
    received: invoice.sats,
    confirmations: 1,
    txids: [txid]
  });
  await check(order);
  // Wix deletes the contact while the payment is being confirmed: its order has not given the
  // plugin its contact yet, so no query finds the payment; the deletion is kept.
  const result = await deleted("contact-9");
  assert.equal(result.payments, 0);
  assert.equal(paymentOf(order).data.invoice.onchainAddress, invoice.onchainAddress);
  // Paid at 3 confirmations: final, its order read (its contact), erased before its comment.
  setStatus(invoice, { state: "paid", method: "onchain", received: invoice.sats, txids: [txid] });
  await check(order);
  const after = paymentOf(order);
  assert.equal(after.data.invoice.onchainAddress, null);
  assert.deepEqual(after.data.proof.txids, []);
  assert.equal(after.data.erased.anonymize, false);
  // Measured on a Wix site: the comment written on payment held the deposit address and the
  // transaction, which the erasure had removed. It holds neither, and says why.
  assert.equal(state.comments.length, 1);
  const { message } = state.comments[0];
  for (const gone of [invoice.onchainAddress, txid, invoice.paymentUri, "contact-9"]) {
    assert.equal(message.includes(gone), false, gone);
  }
  assert.ok(
    message.startsWith("sattle.me: paid.\nThe customer's Wix contact was deleted"),
    message
  );
  assert.ok(message.includes(`Received: ${invoice.sats} sats`));
  assert.ok(message.endsWith(after.data.ref));
  // Approved, then read back: settled, nothing of it written anywhere.
  clock.advance(VERIFY_MS);
  await check(order);
  assert.equal(paymentOf(order).active, false);
  const text = JSON.stringify(paymentOf(order)) + JSON.stringify(state.tasks);
  assert.equal(text.includes(invoice.onchainAddress) || text.includes(txid), false);
});

test("an underpayment whose customer's contact was deleted: its comment, task and notification without them", async () => {
  state.siteLanguage = "fr";
  const contact = "0c0c0c0c-0000-4000-8000-0000000000aa";
  const order = newOrder({ buyerInfo: { contactId: contact } });
  await provider.createTransaction(transactionOptions(order, { amount: "245000" }));
  const { invoice } = paymentOf(order).data;
  await deleted(contact, { triggeredByAnonymizeRequest: true });
  setStatus(invoice, { state: "expired", received: "1200" });
  await check(order);
  const payment = paymentOf(order);
  assert.equal(payment.data.erased.anonymize, true);
  assert.equal(payment.data.attention.detail.address, null);
  const [comment] = state.comments;
  const [task] = state.tasks;
  const [notification] = state.notifications;
  for (const text of [comment.message, task.title, task.description, notification.body]) {
    assert.equal(text.includes(invoice.onchainAddress), false, text);
    assert.equal(text.includes(contact), false, text);
  }
  assert.ok(
    comment.message.includes("adresse de dépôt (effacée à la demande du client)"),
    comment.message
  );
  assert.ok(
    comment.message.includes("ont été effacés, avec l'identifiant du contact"),
    comment.message
  );
  assert.ok(
    task.description.includes("ont été effacés, avec l'identifiant du contact"),
    task.description
  );
  // The task is not linked to the deleted contact.
  assert.equal(task.contact, undefined);
  assert.equal(payment.data.report.task, "done");
});

test("a paid payment erased, then not recorded by Wix: its second comment says it was erased", async () => {
  state.siteLanguage = "en";
  const txid = "7a".repeat(32);
  const order = newOrder({ buyerInfo: { contactId: "contact-10" } });
  await provider.createTransaction(transactionOptions(order, { amount: "245000" }));
  const { invoice } = paymentOf(order).data;
  setStatus(invoice, { state: "paid", method: "onchain", received: invoice.sats, txids: [txid] });
  await check(order);
  // The proof's comment, written before the deletion, is Wix's (the order's own data).
  assert.ok(state.comments[0].message.includes(txid));
  const result = await deleted("contact-10");
  assert.deepEqual([result.payments, result.erased], [1, 1]);
  // Wix never shows the order paid: read twice, then the merchant is told.
  state.orders.get(order._id).paymentStatus = "NOT_PAID";
  clock.advance(VERIFY_MS);
  await check(order);
  clock.advance(31 * 60000);
  await check(order);
  assert.equal(paymentOf(order).data.attention.reason, "unrecorded");
  const second = state.comments[1].message;
  assert.ok(second.includes("The customer's Wix contact was deleted"), second);
  assert.equal(second.includes(txid) || second.includes(invoice.onchainAddress), false, second);
});

/** Every field of `value` with a value, as "path" or "path: value" for the ones listed. */
function fieldsOf(value, prefix = "") {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => fieldsOf(entry, `${prefix}[${index}]`));
  }
  if (typeof value === "object") {
    return Object.keys(value)
      .sort()
      .flatMap((key) => fieldsOf(value[key], prefix ? `${prefix}.${key}` : key));
  }
  return [prefix];
}

test("an erased payment's stored record: what answers its page and the merchant, nothing else", async () => {
  const contact = "0c0c0c0c-0000-4000-8000-0000000000bb";
  const order = newOrder({ buyerInfo: { contactId: contact } });
  const options = transactionOptions(order, { amount: "245000" });
  const answer = await provider.createTransaction(options);
  const { invoice } = paymentOf(order).data;
  assert.ok(invoice.bolt11 && invoice.verifyUrl && invoice.onchainAddress && invoice.paymentUri);
  const txid = "5e".repeat(32);
  const preimage = "6f".repeat(32);
  // Paid on-chain in part, the rest in Lightning: every kind of what an erasure removes.
  setStatus(invoice, {
    state: "paid",
    method: "mixed",
    received: invoice.sats,
    txids: [txid],
    preimages: [preimage]
  });
  await check(order);
  clock.advance(VERIFY_MS);
  await check(order);
  assert.equal(paymentOf(order).active, false);
  const result = await deleted(contact, { triggeredByAnonymizeRequest: true });
  assert.equal(result.erased, 1);
  const item = paymentOf(order);
  // What leads to the customer, and every copy of how they paid, gone from the record: the
  // address, the wallet link, the Lightning invoice and its verify URL, the transaction, the
  // contact, the payment page's address as Wix was answered.
  const text = JSON.stringify(item);
  for (const gone of [
    invoice.onchainAddress,
    invoice.paymentUri,
    invoice.bolt11,
    invoice.verifyUrl,
    txid,
    contact,
    answer.redirectUrl,
    'redirectUrl":"https'
  ]) {
    assert.equal(text.includes(gone), false, gone);
  }
  // Every field the record keeps, named: what answers the page (the key of its transaction,
  // Wix's return addresses), the status page and the merchant's accounting.
  const fields = fieldsOf(item.data).map((path) => path.replace(/\[[0-9]+\]/g, "[]"));
  assert.deepEqual(
    [...new Set(fields)],
    [
      "checks",
      "createdAt",
      "erased.anonymize",
      "erased.at",
      "finalAt",
      "invoice.createdAt",
      "invoice.expiresAt",
      "invoice.fiat.amount",
      "invoice.fiat.currency",
      "invoice.fiat.digits",
      "invoice.fiat.minor",
      "invoice.note",
      "invoice.paymentHash",
      "invoice.rate.currency",
      "invoice.rate.fetchedAt",
      "invoice.rate.price",
      "invoice.rate.source",
      "invoice.rate.time",
      "invoice.ref",
      "invoice.sats",
      "lastCheck",
      "lockGen",
      "note",
      "orderChecked",
      "orderId",
      "orderKey",
      "orderLookups",
      "orderNumber",
      "paidTx",
      "price.amount",
      "price.currency",
      "price.digits",
      "price.minor",
      "proof.at",
      "proof.method",
      "proof.preimages[]",
      "proof.received",
      "received",
      "recorded.lookups",
      "recorded.nextAt",
      "recorded.paymentStatus",
      "recorded.state",
      "ref",
      "report.comment",
      "report.kind",
      "report.notice",
      "report.sendingAt",
      "report.task",
      "report.tries",
      "state",
      "transactions[].answer.page",
      "transactions[].answer.pluginTransactionId",
      "transactions[].at",
      "transactions[].language",
      "transactions[].n",
      "transactions[].pageKey",
      "transactions[].pluginTransactionId",
      "transactions[].returnUrls.cancelUrl",
      "transactions[].returnUrls.errorUrl",
      "transactions[].returnUrls.pendingUrl",
      "transactions[].returnUrls.successUrl",
      "transactions[].sent",
      "transactions[].sentAt",
      "transactions[].wixTransactionId",
      "txCount",
      "updatedAt",
      "v"
    ]
  );
  assert.deepEqual([item.contactId, item.data.proof.preimages], [null, [preimage]]);
  // Its payment page still answers, with Wix's page of the order's state, and nothing else.
  const page = Object.fromEntries(new URL(answer.redirectUrl).searchParams);
  const reply = await http.get_sattlemeCheckoutPay(request({ query: page }));
  assert.deepEqual(
    [reply.status, reply.headers.Location],
    [303, options.order.returnUrls.successUrl]
  );
  // Wix asking again for that transaction gets the same answer, made again from the page's key.
  assert.deepEqual(await provider.createTransaction(options), answer);
  assert.equal(JSON.stringify(paymentOf(order)).includes(answer.redirectUrl), false);
});

test("a contact merged into another: nothing erased, its payments follow; the one kept deleted, erased", async () => {
  const order = await settledOnchain("contact-old", "aa".repeat(32));
  // Wix deletes the merged contact as part of the merge: not an erasure.
  assert.equal(await deleted("contact-old", { originatedFrom: "merge" }), null);
  assert.ok(paymentOf(order).data.invoice.onchainAddress);
  assert.equal(items("erasure").length, 0);
  const merged = await events.wixCrm_onContactMerged({
    metadata: { id: "e2", entityId: "contact-new", eventTime: new Date(Date.now()).toISOString() },
    data: { sourceContactIds: ["contact-old"], targetContactId: "contact-new", targetContact: {} }
  });
  assert.deepEqual([merged.payments, merged.changed], [1, 1]);
  assert.equal(paymentOf(order).contactId, "contact-new");
  assert.ok(paymentOf(order).data.invoice.onchainAddress);
  // The customer asks the merchant to erase them: the contact kept is deleted.
  const result = await deleted("contact-new");
  assert.deepEqual([result.payments, result.erased], [1, 1]);
  assert.equal(paymentOf(order).data.invoice.onchainAddress, null);
});

test("an event without a contact changes nothing", async () => {
  const order = await settledOnchain("contact-1", "bb".repeat(32));
  assert.equal(await events.wixCrm_onContactDeleted({}), null);
  assert.equal(await events.wixCrm_onContactDeleted({ metadata: { entityId: "" } }), null);
  assert.equal(await events.wixCrm_onContactMerged({ data: { sourceContactIds: [] } }), null);
  assert.ok(paymentOf(order).data.invoice.onchainAddress);
});

test("a job forgets a deleted contact after 200 days, not before", async () => {
  await deleted("contact-2");
  const [erasure] = items("erasure");
  const all = state.collections.get("SattlemeCheckout");
  all.set(
    "erasure-old",
    Object.assign({}, erasure, { _id: "erasure-old", dueAt: Date.now() - 201 * 86400000 })
  );
  all.set(
    "erasure-young",
    Object.assign({}, erasure, { _id: "erasure-young", dueAt: Date.now() - 199 * 86400000 })
  );
  await jobs.runJob({ lifeMs: 100, marginMs: 1000 });
  assert.deepEqual(
    items("erasure")
      .map((item) => item._id)
      .sort(),
    [erasure._id, "erasure-young"].sort()
  );
});
