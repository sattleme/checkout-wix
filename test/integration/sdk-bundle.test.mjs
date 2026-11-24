// The plugin with the SDK's real bundle (checkout-sdk.js, as built for a Wix site), its HTTP client
// and WebSocket class pointed at fakes (sdk.js, useTransport): no network. The fakes answer with
// checkout-spec's public vectors (1.0.0, commit 1bd7966, copied in test/vectors): the app's test
// key and the channel the app published for it, on a fake of its relay (wss://relay.example); the
// invoice breez.tips gives for an order of 0.02 CHF (vectors/app/implementation-declaration.json);
// the answers of a Lightning invoice's verify URL (LUD-21) in vectors/payments.json, and the
// invoices as a shop stores them there.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { beforeEach, test } from "node:test";

import {
  SITE_URL,
  clock,
  freshSite,
  newOrder,
  payments,
  request,
  site,
  state,
  transactionOptions
} from "../helpers.mjs";
import { readQr } from "../qr.mjs";

const vector = (name) =>
  JSON.parse(readFileSync(new URL(`../vectors/${name}`, import.meta.url), "utf8"));
const app = vector("app.json");
const paymentChecks = vector("payments.json");
const made = vector("implementation-declaration.json");

const sdk = await site("sattleme-checkout/sdk.js");
const provider = await site(
  "service-plugins/payment-provider/sattlemeCheckout/sattlemeCheckout.js"
);
const http = await site("http-functions.js");
const { checkPayment, newContext } = await site("sattleme-checkout/payments.js");
const { TIMEOUTS } = await site("sattleme-checkout/constants.js");

const CONNECT = { keySecretName: "sattleme-checkout-key" };

// The relay of the app's key: it holds the channel the app published, takes any event, answers
// every subscription with what it holds that matches, then EOSE.
const relayEvents = [];
const relayLog = [];

function matches(event, filter) {
  if (filter.kinds && !filter.kinds.includes(event.kind)) return false;
  if (filter.authors && !filter.authors.includes(event.pubkey)) return false;
  for (const name of ["d", "o"]) {
    const wanted = filter[`#${name}`];
    if (wanted && !event.tags.some((tag) => tag[0] === name && wanted.includes(tag[1])))
      return false;
  }
  if (filter.since !== undefined && event.created_at < filter.since) return false;
  if (filter.until !== undefined && event.created_at > filter.until) return false;
  return true;
}

class FakeRelaySocket {
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.onopen = this.onmessage = this.onerror = this.onclose = null;
    relayLog.push(["open", url]);
    setImmediate(() => {
      if (url !== "wss://relay.example") {
        this.readyState = 3;
        if (this.onerror) this.onerror({});
        if (this.onclose) this.onclose({});
        return;
      }
      this.readyState = 1;
      if (this.onopen) this.onopen({});
    });
  }

  reply(message) {
    setImmediate(() => {
      if (this.readyState === 1 && this.onmessage)
        this.onmessage({ data: JSON.stringify(message) });
    });
  }

  send(text) {
    const message = JSON.parse(text);
    relayLog.push([message[0], message[1]]);
    if (message[0] === "REQ") {
      const [, id, ...filters] = message;
      for (const event of relayEvents) {
        if (filters.some((filter) => matches(event, filter))) this.reply(["EVENT", id, event]);
      }
      this.reply(["EOSE", id]);
    } else if (message[0] === "EVENT") {
      relayEvents.push(message[1]);
      this.reply(["OK", message[1].id, true, ""]);
    }
  }

  close() {
    this.readyState = 3;
    setImmediate(() => this.onclose && this.onclose({}));
  }
}

// The HTTP services: the merchant's Lightning address (LUD-16), and the answers `routes` gives.
let routes = new Map();
const fetchLog = [];

async function fakeFetch(url, options) {
  fetchLog.push(String(url));
  if (options && options.signal && options.signal.aborted) throw options.signal.reason;
  // A route whose address ends with "?" answers every query of that address.
  const route =
    routes.get(String(url)) ||
    [...routes].find(([prefix]) => prefix.endsWith("?") && String(url).startsWith(prefix))?.[1];
  if (!route) return new Response("not found", { status: 404 });
  const body = route.bodyText !== undefined ? route.bodyText : JSON.stringify(route.body);
  return new Response(body, {
    status: route.status,
    headers: { "content-type": "application/json" }
  });
}

const PAY_REQUEST = {
  tag: "payRequest",
  callback: "https://breez.tips/lnurlp/sattleme02c6047f94/invoice",
  minSendable: 1000,
  maxSendable: 5000000000,
  metadata: JSON.stringify([
    ["text/identifier", "sattleme02c6047f94@breez.tips"],
    ["text/plain", "Pay to Sunrise Bakery"]
  ]),
  commentAllowed: 100
};

beforeEach(() => {
  freshSite({ key: app.secretKey });
  relayEvents.length = 0;
  relayEvents.push(app.channel.event);
  relayLog.length = 0;
  fetchLog.length = 0;
  routes = new Map([
    ["https://breez.tips/.well-known/lnurlp/sattleme02c6047f94", { status: 200, body: PAY_REQUEST }]
  ]);
  sdk.useTransport({ fetch: fakeFetch, WebSocket: FakeRelaySocket });
});

test("the bundle loads, with the Web Crypto global, on this Node", () => {
  assert.equal(sdk.prepareRuntime(), true);
  assert.equal(typeof globalThis.crypto.getRandomValues, "function");
  assert.equal(sdk.currencyDigits("CHF"), 2);
  assert.equal(sdk.currencyDigits("XYZ"), null);
});

test("connectAccount reads the merchant with the real SDK: the channel the app published", async () => {
  state.siteLanguage = "en";
  const answer = await provider.connectAccount({
    currency: "CHF",
    credentials: { keySecretName: "sattleme-checkout-key" }
  });
  assert.deepEqual(answer, {
    credentials: { keySecretName: "sattleme-checkout-key", minutesToPay: "15" },
    accountId: app.parsed.team,
    accountName: "Sunrise Bakery · 1 to 5000000 sats · 0 on-chain addresses"
  });
  assert.ok(relayLog.some(([kind]) => kind === "REQ"));
  assert.ok(fetchLog.includes("https://breez.tips/.well-known/lnurlp/sattleme02c6047f94"));
  // Nothing of the key in what Wix keeps or the plugin stores.
  const stored = JSON.stringify([...state.collections.get("SattlemeCheckout").values()]);
  for (const part of app.secretKey.split(".")) assert.equal(stored.includes(part), false);
});

test("connectAccount: a key of the vectors that is no key, refused before any request", async () => {
  freshSite({ key: "sattleme_ck_not.a.key" });
  const answer = await provider.connectAccount({ currency: "CHF", credentials: CONNECT });
  assert.deepEqual([answer.reasonCode, answer.errorCode], [2004, "INVALID_KEY"]);
  assert.equal(relayLog.length + fetchLog.length, 0);
});

test("no relay answers: refused in time, as a network failure", async () => {
  relayEvents.length = 0;
  freshSite({ key: app.secretKey });
  const start = Date.now();
  const answer = await provider.connectAccount({ currency: "CHF", credentials: CONNECT });
  assert.ok(Date.now() - start < 9500);
  assert.deepEqual([answer.reasonCode, answer.errorCode], [2002, "CHANNEL_NOT_FOUND"]);
});

/** payments.json's verify answer `name`, about the declaration vector's invoice (`pr`). */
function verifyAnswer(name) {
  const found = paymentChecks.cases.find((c) => c.name === name);
  assert.ok(found, name);
  return {
    status: found.http.status,
    body: Object.assign({}, found.http.body, { pr: made.invoice })
  };
}

test("createTransaction with the real SDK, then the customer's payment page, until paid", async () => {
  // implementation-declaration.json's invoice: 21 sats, for this Lightning address (its
  // description hash), dated 1791380000, lasting 600 s; its payment hash is that of payments.json's
  // invoice, whose preimage pays both.
  const now = 1791380005;
  clock.set(now);
  try {
    routes.set(
      "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=chf&include_last_updated_at=true",
      { status: 200, body: { bitcoin: { chf: 99000, last_updated_at: now } } }
    );
    routes.set(`${PAY_REQUEST.callback}?`, {
      status: 200,
      body: { pr: made.invoice, verify: made.verifyUrl }
    });
    const order = newOrder();
    // 0.02 CHF at 99 000 CHF/BTC: 21 sats.
    const options = transactionOptions(order, { amount: "2", currency: "CHF" });
    const answer = await provider.createTransaction(options);
    const [payment] = payments();
    const tx = payment.data.transactions[0];
    assert.equal(
      answer.redirectUrl,
      `${SITE_URL}/sattlemeCheckoutPay?o=${payment._id}&k=${tx.pageKey}`
    );
    assert.match(payment.data.ref, new RegExp(`^wix\\.${order._id}\\.[A-Za-z0-9_-]{22}$`));
    // Asked of breez.tips: 21 000 msat, for 900 s at most; declared on the merchant's relay.
    const asked = new URL(fetchLog.find((url) => url.startsWith(`${PAY_REQUEST.callback}?`)));
    assert.deepEqual(
      [asked.searchParams.get("amount"), asked.searchParams.get("expiry")],
      ["21000", "900"]
    );
    assert.ok(relayLog.some(([kind]) => kind === "EVENT"));
    assert.deepEqual(
      [payment.data.invoice.bolt11, payment.data.invoice.sats, payment.data.state],
      [made.invoice, made.sats, "open"]
    );

    // The customer on the page: not settled yet. A Lightning invoice (this lot has no address).
    routes.set(made.verifyUrl, verifyAnswer("not settled, before the end of the grace period"));
    const query = Object.fromEntries(new URL(answer.redirectUrl).searchParams);
    let reply = await http.get_sattlemeCheckoutPay(request({ query }));
    assert.equal(reply.status, 200);
    assert.ok(reply.body.includes("<strong>21 Sats (0.02 CHF)</strong>"));
    const svg = reply.body.slice(
      reply.body.lastIndexOf("<svg "),
      reply.body.lastIndexOf("</svg>") + 6
    );
    assert.equal(readQr(svg), `lightning:${made.invoice}`);
    assert.deepEqual(
      state.events.map((e) => e.reasonCode),
      [5009]
    );

    // Paid: the next view sends the customer to Wix's success page, with the proof.
    const paid = verifyAnswer("paid");
    routes.set(made.verifyUrl, paid);
    clock.set(now + 10);
    reply = await http.get_sattlemeCheckoutPay(request({ query }));
    assert.deepEqual(
      [reply.status, reply.headers.Location],
      [303, options.order.returnUrls.successUrl]
    );
    assert.deepEqual(
      state.events.map((e) => e.reasonCode),
      [5009, undefined]
    );
    const after = payments()[0].data;
    assert.deepEqual([after.state, after.proof.preimage], ["paid", paid.body.preimage]);
    assert.ok(state.comments[0].message.includes(paid.body.preimage));
  } finally {
    clock.reset();
  }
});

/**
 * A payment record holding `stored` (by default the vectors' invoice, which has no address), as
 * createTransaction keeps it.
 */
function paymentOfVector(stored) {
  const order = newOrder();
  const id = `p${"9".repeat(32)}`;
  const tx = {
    wixTransactionId: "wtx-vector",
    pluginTransactionId: "wix.vector.AAAAAAAAAAAAAAAAAAAAAA.1",
    pageKey: "1".repeat(32),
    returnUrls: {
      successUrl: "https://wix.example/s",
      pendingUrl: "https://wix.example/p",
      errorUrl: "https://wix.example/e",
      cancelUrl: null
    },
    language: "en",
    at: 0,
    sent: "none",
    sentAt: null,
    answer: null
  };
  const invoice =
    stored ||
    Object.assign(
      { ref: "wix.vector.AAAAAAAAAAAAAAAAAAAAAA", onchainAddress: null, sats: "21" },
      paymentChecks.invoice
    );
  state.collections.get("SattlemeCheckout").set(id, {
    _id: id,
    kind: "payment",
    active: true,
    dueAt: 0,
    data: {
      v: 1,
      orderKey: order._id,
      orderId: order._id,
      orderNumber: null,
      ref: invoice.ref,
      note: "Wix vector",
      price: { amount: "0.02", currency: "CHF", minor: "2", digits: 2 },
      invoice,
      state: "open",
      received: "0",
      rest: null,
      confirmations: null,
      txids: [],
      proof: null,
      attention: null,
      report: null,
      orderChecked: false,
      orderLookups: 0,
      transactions: [tx],
      lockGen: 0,
      checks: 0,
      lastCheck: null,
      lastError: null,
      failures: 0,
      finalAt: null,
      createdAt: 0,
      updatedAt: 0
    }
  });
  return { id, tx };
}

test("a check with the real SDK, for each answer of the verify URL in checkout-spec's vectors", async () => {
  for (const vectorCase of paymentChecks.cases) {
    freshSite({ key: app.secretKey });
    routes.set(paymentChecks.invoice.verifyUrl, vectorCase.http);
    clock.set(vectorCase.now);
    try {
      const { id } = paymentOfVector();
      const result = await checkPayment(id, 0, newContext(TIMEOUTS.job));
      assert.equal(result.checked, true, vectorCase.name);
      const data = result.item.data;
      const expected = vectorCase.expected;
      if (expected.error) {
        assert.equal(data.lastError && data.lastError.code, expected.error, vectorCase.name);
        assert.equal(data.state, "open", vectorCase.name);
        assert.equal(state.events.length, 0, vectorCase.name);
      } else if (expected.state === "paid") {
        assert.equal(data.state, "paid", vectorCase.name);
        assert.equal(data.proof.preimage, expected.preimage, vectorCase.name);
        assert.deepEqual(
          state.events,
          [
            {
              wixTransactionId: "wtx-vector",
              pluginTransactionId: "wix.vector.AAAAAAAAAAAAAAAAAAAAAA.1"
            }
          ],
          vectorCase.name
        );
      } else if (expected.state === "open") {
        // The customer has the page: pending.
        assert.equal(data.state, "open", vectorCase.name);
        assert.deepEqual(
          state.events.map((e) => e.reasonCode),
          [5009],
          vectorCase.name
        );
      } else {
        assert.equal(expected.state, "expired");
        assert.equal(data.state, "expired", vectorCase.name);
        assert.deepEqual(
          state.events.map((e) => e.reasonCode),
          [3035],
          vectorCase.name
        );
      }
    } finally {
      clock.reset();
    }
  }
});

// SPEC.md §22: a stored invoice is checked before a payment check asks anything. The plugin keeps
// the invoice as the SDK made it and gives it back as it is: each of the vectors' stored invoices
// is checked as the vectors say, an invalid one refused (invalid_order) before any request.
test("an invoice as a shop stores it (checkout-spec's vectors): refused before any request, or checked", async () => {
  assert.ok(paymentChecks.stored.length > 0);
  for (const stored of paymentChecks.stored) {
    freshSite({ key: app.secretKey });
    fetchLog.length = 0;
    relayLog.length = 0;
    clock.set(stored.invoice.createdAt + 60);
    try {
      const { id } = paymentOfVector(stored.invoice);
      const result = await checkPayment(id, 0, newContext(TIMEOUTS.job));
      assert.equal(result.checked, true, stored.name);
      const data = result.item.data;
      if (stored.expected.error) {
        assert.equal(data.lastError && data.lastError.code, stored.expected.error, stored.name);
        assert.deepEqual([fetchLog.length, relayLog.length], [0, 0], stored.name);
        assert.equal(data.state, "open", stored.name);
        assert.equal(state.events.length, 0, stored.name);
      } else {
        assert.equal(stored.expected.valid, true, stored.name);
        assert.notEqual(data.lastError && data.lastError.code, "invalid_order", stored.name);
        // The check went on to the verify URL, the relays or the explorers.
        assert.ok(fetchLog.length + relayLog.length > 0, stored.name);
      }
    } finally {
      clock.reset();
    }
  }
});

// The SDK reads bech32 in US-ASCII and its case alone (checkout-node 3269f4f): an invoice stored
// in upper case is the invoice, but one with a Kelvin sign (U+212A, which JavaScript lowers to a
// k) in place of a K is no invoice, refused before any request.
test("an invoice stored in upper case is checked; with a Kelvin sign for a K, refused before any request", async () => {
  const [made] = paymentChecks.stored;
  assert.equal(made.expected.valid, true);
  const upper = made.invoice.bolt11.toUpperCase();
  assert.ok(upper.includes("K"));
  for (const [bolt11, valid] of [
    [upper, true],
    [upper.replace("K", "\u212A"), false]
  ]) {
    freshSite({ key: app.secretKey });
    fetchLog.length = 0;
    relayLog.length = 0;
    clock.set(made.invoice.createdAt + 60);
    try {
      const { id } = paymentOfVector(Object.assign({}, made.invoice, { bolt11 }));
      const result = await checkPayment(id, 0, newContext(TIMEOUTS.job));
      const error = result.item.data.lastError && result.item.data.lastError.code;
      if (valid) {
        assert.notEqual(error, "invalid_order");
        assert.ok(fetchLog.length + relayLog.length > 0);
      } else {
        assert.equal(error, "invalid_order");
        assert.deepEqual([fetchLog.length, relayLog.length], [0, 0]);
      }
    } finally {
      clock.reset();
    }
  }
});

// The SDK refuses a pay request whose metadata holds a lone surrogate (checkout-node 78828fa): a
// JSON escape such as \ud800 is no text, so no UTF-8 for the invoice's description hash. Before,
// it hashed U+FFFD in its place and took an invoice so made. The plugin refuses the payment, and
// the Lightning address is not asked for an invoice.
test("a Lightning address whose metadata holds a lone surrogate: the payment refused, no invoice asked", async () => {
  const now = 1791380005;
  clock.set(now);
  try {
    routes.set("https://breez.tips/.well-known/lnurlp/sattleme02c6047f94", {
      status: 200,
      // The metadata's text holds U+D800 itself; the answer's JSON escapes it (JSON.stringify).
      body: Object.assign({}, PAY_REQUEST, {
        metadata:
          '[["text/identifier","sattleme02c6047f94@breez.tips"],["text/plain","Pay \ud800"]]'
      })
    });
    routes.set(
      "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=chf&include_last_updated_at=true",
      { status: 200, body: { bitcoin: { chf: 99000, last_updated_at: now } } }
    );
    routes.set(`${PAY_REQUEST.callback}?`, {
      status: 200,
      body: { pr: made.invoice, verify: made.verifyUrl }
    });
    const answer = await provider.createTransaction(
      transactionOptions(newOrder(), { amount: "2", currency: "CHF" })
    );
    assert.deepEqual([answer.reasonCode, answer.errorCode], [6000, "INVALID_INVOICE"]);
    assert.equal(
      fetchLog.some((url) => url.startsWith(`${PAY_REQUEST.callback}?`)),
      false
    );
    assert.equal(payments()[0].active, false);
  } finally {
    clock.reset();
  }
});
