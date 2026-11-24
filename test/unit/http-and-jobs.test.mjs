// The two public addresses (http.js through backend/http-functions.js): the customer's payment
// page and the merchant's status page; and the background jobs (jobs.js through
// backend/jobs.config), with the fake SDK.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { beforeEach, test } from "node:test";

import {
  FakeSdkError,
  failNext,
  invoicesOf,
  resetWorld,
  setStatus,
  world
} from "../fakes/sdk-world.mjs";
import {
  KEY,
  SITE_URL,
  STATUS_TOKEN,
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

const http = await site("http-functions.js");
const jobs = await site("sattleme-checkout/jobs.js");
const provider = await site(
  "service-plugins/payment-provider/sattlemeCheckout/sattlemeCheckout.js"
);

beforeEach(() => {
  freshSite();
  resetWorld();
});

/** An order with its invoice, and the address of its payment page, where Wix sends the customer. */
async function paying(amount) {
  const order = newOrder();
  const options = transactionOptions(order, amount ? { amount } : {});
  const answer = await provider.createTransaction(options);
  const payment = payments().find((p) => p.data.orderId === order._id);
  const link = new URL(answer.redirectUrl);
  const invoice = invoicesOf(payment.data.ref)[0];
  return { order, options, answer, payment, invoice, query: Object.fromEntries(link.searchParams) };
}

const statusCalls = () => world.calls.filter((c) => c.method === "getStatus").length;
const page = (query, headers) => http.get_sattlemeCheckoutPay(request({ query, headers }));

/** The text of every element of `tag` in `body`, its markup removed. */
function texts(body, tag) {
  const out = [];
  const pattern = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "g");
  for (let m = pattern.exec(body); m; m = pattern.exec(body)) {
    out.push(m[1].replace(/<[^>]+>/g, ""));
  }
  return out;
}

test("the payment page: the invoice's QR code, the amount, the time left, the invoice and the address", async () => {
  const { answer, invoice, query } = await paying();
  assert.equal(answer.redirectUrl, `${SITE_URL}/sattlemeCheckoutPay?o=${query.o}&k=${query.k}`);
  assert.match(query.k, /^[0-9a-f]{32}$/);
  const reply = await page(query);
  assert.equal(reply.status, 200);
  const body = reply.body;
  // In the buyer's language (Wix's buyerLanguage: de), the amount in sats and in the order's.
  assert.match(body, /<html lang="de">/);
  assert.ok(body.includes("<h1>Mit Bitcoin bezahlen</h1>"));
  assert.ok(body.includes(`<strong>${invoice.sats} Sats (24.50 CHF)</strong>`));
  assert.ok(body.includes("Verbleibende Zeit zum Bezahlen: 15 Min. 0 s."));
  // One QR code, made on the server; the wallet's link; the invoice and the address to copy.
  assert.equal(body.split("<svg ").length - 1, 2); // the logo, and the QR code
  assert.ok(
    body.includes(`<a class="wallet" href="${invoice.paymentUri.replace(/&/g, "&amp;")}">`)
  );
  const areas = texts(body, "textarea");
  assert.deepEqual(areas, [invoice.bolt11, invoice.onchainAddress]);
  // No script, no inline style, nothing loaded from elsewhere but the site's own stylesheet;
  // never cached, never indexed.
  for (const blocked of ["<script", "<style", "style=", "src=", "url("]) {
    assert.equal(body.includes(blocked), false, blocked);
  }
  assert.deepEqual(
    [...body.matchAll(/href="([^"]*)"/g)].map((m) => m[1].replace(/&amp;/g, "&")),
    ["sattlemeCheckoutStyle", invoice.paymentUri]
  );
  assert.ok(body.includes('<link rel="stylesheet" href="sattlemeCheckoutStyle">'));
  assert.ok(body.includes('<meta http-equiv="refresh" content="10">'));
  assert.ok(body.includes('<meta name="robots" content="noindex,nofollow">'));
  assert.equal(reply.headers["Cache-Control"], "no-store");
  assert.equal(reply.headers["Referrer-Policy"], "no-referrer");
  assert.match(reply.headers["Content-Security-Policy"], /default-src 'none'/);
  assert.match(reply.headers["Content-Security-Policy"], /frame-ancestors 'none'/);
  // A button checks again: the same address, by GET.
  assert.ok(body.includes('<form method="get" action="">'));
  assert.ok(body.includes(`name="o" value="${query.o}"`));
  assert.ok(body.includes(`name="k" value="${query.k}"`));
  // Its first view checked the invoice: Wix told pending, once.
  assert.equal(statusCalls(), 1);
  assert.deepEqual(
    state.events.map((e) => e.reasonCode),
    [5009]
  );
  // Again at once: shown, not checked again (at most every 5 s).
  assert.equal((await page(query)).status, 200);
  assert.equal(statusCalls(), 1);
});

test("a view of the payment page that checks: 3 writes of Wix Data (README, Wix's quotas)", async () => {
  const { query } = await paying();
  await page(query);
  const counts = [];
  for (let view = 0; view < 3; view += 1) {
    clock.advance(10000);
    const before = state.writes;
    await page(query);
    counts.push(state.writes - before);
  }
  clock.reset();
  // Its lock taken, its record saved, its lock removed; between two checks, no lock item.
  assert.deepEqual(counts, [3, 3, 3]);
  assert.equal(statusCalls(), 4);
  assert.equal(items("lock").length, 0);
});

test("views of a payment page within 5 s of its last check read it, and write nothing", async () => {
  // A script holding the page's address (anyone who placed an order has one), or a customer's
  // tabs and clicks: each view reads the payment, and shows the last check.
  const { query } = await paying();
  await page(query);
  const [writes, reads, checks] = [state.writes, state.reads, statusCalls()];
  for (let i = 0; i < 70; i += 1) assert.equal((await page(query)).status, 200);
  assert.deepEqual(
    [state.writes - writes, state.reads - reads, statusCalls() - checks],
    [0, 70, 0]
  );
  assert.equal(items("lock").length, 0);
});

test("views at once wait for the one that checks by reading its lock, then show what it found", async () => {
  const { query } = await paying();
  await page(query);
  const wixData = (await import("wix-data")).default;
  const insert = wixData.insert;
  let inserts = 0;
  wixData.insert = (...args) => {
    inserts += 1;
    return insert.apply(wixData, args);
  };
  world.delays.set("getStatus", 1500);
  clock.advance(6000);
  try {
    const replies = await Promise.all(Array.from({ length: 10 }, () => page(query)));
    assert.deepEqual(new Set(replies.map((reply) => reply.status)), new Set([200]));
  } finally {
    wixData.insert = insert;
    clock.reset();
  }
  // One check; an insert each at most (the lock taken once, the others refused), then reads.
  assert.equal(statusCalls(), 2);
  assert.ok(inserts <= 10, `${inserts} inserts`);
  assert.equal(items("lock").length, 0);
});

/** Waits (real time) until `condition()` holds. */
async function until(condition, what) {
  for (let i = 0; i < 2000; i += 1) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error(`never: ${what}`);
}

test("two views within 5 s, the job, the page's next view: one holder at a time, one approval", async () => {
  // The audit's case. Before, a view within 5 s took the lock and released it without moving the
  // payment's lockGen, and removed the generation before its own: two such views left
  // generation L removed while the job walked past L and L+1 to hold L+2, and the page's next
  // view took L again and held it too: two approvals, two proof comments. A removal of
  // generation L while the payment's lockGen is still L is held here until the job holds a lock,
  // as it was then; it does not happen now.
  const { payment, invoice, query } = await paying();
  const P = payment._id;
  assert.equal((await page(query)).status, 200);
  const L = payments()[0].data.lockGen;
  setStatus(invoice, { state: "paid", method: "lightning", preimage: "ab".repeat(32) });
  await page(query);
  const wixData = (await import("wix-data")).default;
  const remove = wixData.bulkRemove;
  let open;
  const gate = new Promise((resolve) => (open = resolve));
  let held = false;
  wixData.bulkRemove = async (name, ids) => {
    if (ids.includes(`lock-${P}-${L}`) && payments()[0].data.lockGen === L) {
      held = true;
      await gate;
    }
    return remove.call(wixData, name, ids);
  };
  world.delays.set("getStatus", 300);
  const lockHeld = () => items("lock").some((l) => l._id.startsWith(`lock-${P}-`) && l.active);
  try {
    const second = page(query);
    await until(() => held || items("lock").length === 0, "the second view is done or held");
    await new Promise((resolve) => setTimeout(resolve, 20));
    // The job runs: its query reads Wix Data's mirrors, which have the payment 3 s later.
    clock.advance(3500);
    const job = jobs.runJob({ lifeMs: 60000, marginMs: 0 });
    await until(lockHeld, "the job holds the payment");
    open();
    await second;
    // The page's next view, 6 s after its check.
    clock.advance(2500);
    const third = page(query);
    await Promise.all([job, third]);
  } finally {
    wixData.bulkRemove = remove;
    clock.reset();
  }
  const approvals = state.events.filter((e) => e.reasonCode === undefined);
  const proofs = state.comments.filter((c) => c.message.includes("ab".repeat(32)));
  assert.deepEqual([approvals.length, proofs.length], [1, 1]);
});

/** A pseudo-random generator of `seed` (mulberry32): the same orders at every run. */
function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test("checks of a paid payment at once, their requests in many orders: one approval, one proof", async () => {
  const { checkPayment, newContext } = await site("sattleme-checkout/payments.js");
  const { TIMEOUTS } = await site("sattleme-checkout/constants.js");
  for (let round = 0; round < 12; round += 1) {
    freshSite();
    resetWorld();
    const next = random(round + 1);
    const { order, payment, invoice, query } = await paying();
    await page(query);
    setStatus(invoice, { state: "paid", method: "lightning", preimage: "cd".repeat(32) });
    clock.advance(6000 + round * 3600000);
    const job = newContext(TIMEOUTS.job);
    // Each Wix Data request waits 1 to 6 turns of the event loop: another order each round.
    state.jitter = () => 1 + Math.floor(next() * 6);
    try {
      await Promise.all([
        page(query),
        page(query),
        checkPayment(payment._id, 0, job),
        checkPayment(payment._id, payment.data.lockGen, job),
        page(query),
        provider.createTransaction(transactionOptions(order)),
        checkPayment(payment._id, payment.data.lockGen + 1, job)
      ]);
      // What a busy check left: the job's next run, then the page's view.
      await checkPayment(payment._id, payments()[0].data.lockGen, job);
    } finally {
      state.jitter = null;
      clock.reset();
    }
    const approvals = state.events.filter((e) => e.reasonCode === undefined);
    const proofs = state.comments.filter((c) => c.message.includes("cd".repeat(32)));
    assert.deepEqual([approvals.length, proofs.length], [1, 1], `round ${round}`);
  }
});

test("the payment page in the order's language when the plugin has it, else the browser's", async () => {
  // Wix's buyer language, missing or one the plugin lacks: the browser's (Accept-Language).
  const cases = [
    [undefined, "fr-CH,fr;q=0.9", "fr"],
    ["es", "fr-CH,fr;q=0.9", "fr"],
    ["es", "pt-BR", "en"],
    ["de", "fr-CH,fr;q=0.9", "de"]
  ];
  for (const [buyerLanguage, accepted, expected] of cases) {
    const options = transactionOptions(newOrder());
    if (buyerLanguage === undefined) delete options.order.description.buyerInfo;
    else options.order.description.buyerInfo.buyerLanguage = buyerLanguage;
    const answer = await provider.createTransaction(options);
    const query = Object.fromEntries(new URL(answer.redirectUrl).searchParams);
    const reply = await page(query, { "Accept-Language": accepted });
    assert.match(reply.body, new RegExp(`<html lang="${expected}">`), `${buyerLanguage}`);
  }
});

test("the payment page sends the customer to Wix's page once final: success when paid", async () => {
  const { options, answer, invoice, query } = await paying();
  const urls = options.order.returnUrls;
  await page(query);
  clock.advance(6000);
  try {
    setStatus(invoice, { state: "paid", method: "lightning", preimage: "ab".repeat(32) });
    let reply = await page(query);
    assert.equal(reply.status, 303);
    assert.equal(reply.headers.Location, urls.successUrl);
    assert.equal(reply.headers["Referrer-Policy"], "no-referrer");
    assert.deepEqual(
      state.events.map((e) => [e.pluginTransactionId, e.reasonCode]),
      [
        [answer.pluginTransactionId, 5009],
        [answer.pluginTransactionId, undefined]
      ]
    );
    // Settled: later views check nothing, and still land on success.
    clock.advance(6000);
    reply = await page(query);
    assert.equal(reply.headers.Location, urls.successUrl);
    assert.equal(statusCalls(), 2);
  } finally {
    clock.reset();
  }
});

test("an expired invoice: Wix's error page; an underpayment that expired: what came, the way back", async () => {
  const expired = await paying();
  setStatus(expired.invoice, { state: "expired", received: "0" });
  let reply = await page(expired.query);
  assert.equal(reply.headers.Location, expired.options.order.returnUrls.errorUrl);
  assert.equal(state.events[0].reasonCode, 3035);
  // Underpaid, then expired: pending for the merchant. The customer reads what came of what was
  // due, in the order's language, and gets the way back to the shop (Wix's pending page), never a
  // way to pay again, nor a page that loads itself again.
  const underpaid = await paying();
  setStatus(underpaid.invoice, { state: "expired", received: "500" });
  reply = await page(underpaid.query);
  assert.equal(reply.status, 200);
  assert.equal(reply.headers.Location, undefined);
  assert.ok(reply.body.includes("<h1>Zahlung unvollständig</h1>"), reply.body);
  assert.ok(
    reply.body.includes(`500 von ${underpaid.invoice.sats} Sats erhalten`),
    reply.body.slice(-600)
  );
  const back = underpaid.options.order.returnUrls.pendingUrl;
  assert.ok(reply.body.includes(`<a href="${back}">Zurück zum Shop</a>`));
  for (const absent of ["http-equiv", "<form", "<textarea", "bitcoin:", "lnbc"]) {
    assert.equal(reply.body.includes(absent), false, absent);
  }
  assert.deepEqual(
    state.events.slice(1).map((e) => e.reasonCode),
    [5009]
  );
  // The same at every later view: nothing is checked again.
  clock.advance(6000);
  try {
    const again = await page(underpaid.query);
    assert.equal(again.body, reply.body);
    assert.equal(state.events.length, 2);
  } finally {
    clock.reset();
  }
});

test("the payment page: the rest of an underpayment, then the time up, then being confirmed", async () => {
  const { invoice, query, options, order } = await paying();
  const restUri = `bitcoin:${invoice.onchainAddress}?amount=0.0002&lightning=lnbc20000n1rest`;
  setStatus(invoice, {
    state: "open",
    expiresAt: invoice.expiresAt,
    received: "4500",
    rest: { sats: "20000", bolt11: "lnbc20000n1rest", paymentUri: restUri }
  });
  let body = (await page(query)).body;
  assert.ok(
    body.includes(`4500 von ${invoice.sats} Sats erhalten. Zahlen Sie den Rest: 20000 Sats.`)
  );
  assert.ok(body.includes(`<a class="wallet" href="${restUri.replace(/&/g, "&amp;")}">`));
  assert.deepEqual(texts(body, "textarea"), ["lnbc20000n1rest", invoice.onchainAddress]);
  // A rest whose invoice is not made yet.
  clock.advance(6000);
  try {
    setStatus(invoice, {
      state: "open",
      expiresAt: invoice.expiresAt,
      received: "4500",
      rest: { sats: "20000", bolt11: null, paymentUri: null }
    });
    body = (await page(query)).body;
    assert.ok(body.includes("Die Rechnung für den Rest wird erstellt"));
    assert.equal(body.split("<svg ").length - 1, 1);
    // Past the invoice's end, within its grace: no QR code, the search goes on.
    clock.advance((invoice.expiresAt - Math.floor(Date.now() / 1000) + 10) * 1000);
    setStatus(invoice, { state: "open", expiresAt: invoice.expiresAt, received: "0", rest: null });
    body = (await page(query)).body;
    assert.ok(body.includes("Die Zeit zum Bezahlen ist abgelaufen."));
    assert.equal(body.split("<svg ").length - 1, 1);
    assert.deepEqual(texts(body, "textarea"), []);
    // Being confirmed: no invoice, a link back to the shop, checked less often.
    clock.advance(6000);
    setStatus(invoice, {
      state: "unconfirmed",
      received: "24500",
      confirmations: 1,
      txids: ["aa".repeat(32)]
    });
    body = (await page(query)).body;
    assert.ok(body.includes("(1 von 3 Bestätigungen, etwa 30 Minuten)"));
    assert.ok(
      body.includes(`<a href="${options.order.returnUrls.pendingUrl}">Zurück zum Shop</a>`)
    );
    assert.ok(body.includes('<meta http-equiv="refresh" content="30">'));
    assert.equal(body.split("<svg ").length - 1, 1);
    // Without a return URL of Wix's in https (none here), no link back.
    const payment = payments().find((p) => p.data.orderId === order._id);
    for (const tx of payment.data.transactions) {
      Object.assign(tx.returnUrls, { pendingUrl: null, successUrl: null });
    }
    state.collections.get("SattlemeCheckout").set(payment._id, payment);
    body = (await page(query)).body;
    assert.ok(body.includes("(1 von 3 Bestätigungen, etwa 30 Minuten)"));
    assert.equal(body.includes("Zurück zum Shop"), false);
    assert.equal(body.includes('href="null"'), false);
  } finally {
    clock.reset();
  }
});

test("Wix Data's mirrors seconds behind: a payment settled by a view is told to the merchant once", async () => {
  // Wix Data is eventually consistent: a read goes to a mirror, seconds behind the primary,
  // unless it asks for consistentRead. An on-chain underpayment expires; the view that sees it
  // settles the payment (the merchant told, its locks removed); a second view a second later
  // (another tab, the button, the job) must not find it as a mirror still has it, open.
  const { invoice, query, options } = await paying("5000");
  clock.advance(10000);
  try {
    setStatus(invoice, {
      state: "open",
      expiresAt: invoice.expiresAt,
      received: "20000",
      rest: null
    });
    assert.equal((await page(query)).status, 200);
    clock.advance(20000);
    setStatus(invoice, { state: "expired", received: "20000" });
    const back = `<a href="${options.order.returnUrls.pendingUrl}">`;
    const first = await page(query);
    assert.ok(first.body.includes("Zahlung unvollständig") && first.body.includes(back));
    assert.equal(payments()[0].active, false);
    clock.advance(1000);
    const second = await page(query);
    assert.ok(second.body.includes("Zahlung unvollständig") && second.body.includes(back));
  } finally {
    clock.reset();
  }
  assert.deepEqual(
    [state.tasks.length, state.notifications.length, state.comments.length, statusCalls()],
    [1, 1, 1, 2]
  );
});

test("the payment page escapes what it shows; a QR code holds no text of its own", async () => {
  world.tamper = (invoice) =>
    Object.assign(invoice, {
      bolt11: `${invoice.bolt11}</textarea><script>alert(1)</script>`,
      paymentUri: `${invoice.paymentUri}"><script>alert(2)</script>`
    });
  const { query } = await paying();
  const body = (await page(query)).body;
  assert.equal(body.includes("<script"), false);
  assert.ok(body.includes("&lt;/textarea&gt;&lt;script&gt;alert(1)&lt;/script&gt;"));
  assert.ok(body.includes("&quot;&gt;&lt;script&gt;alert(2)&lt;/script&gt;"));
  const svg = body.slice(body.lastIndexOf("<svg "), body.lastIndexOf("</svg>"));
  assert.equal(svg.includes("alert"), false);
});

test("the pages' stylesheet: the site's own, the only thing a page loads, nothing from elsewhere", async () => {
  const reply = await http.get_sattlemeCheckoutStyle(request({}));
  assert.equal(reply.status, 200);
  assert.equal(reply.headers["Content-Type"], "text/css; charset=utf-8");
  assert.equal(reply.headers["X-Content-Type-Options"], "nosniff");
  for (const blocked of ["url(", "@import", "expression(", "<"]) {
    assert.equal(reply.body.includes(blocked), false, blocked);
  }
  // The policy of every page allows it (Wix's own, measured, allows the site's origin too), and
  // nothing else: the payment page, the status page's form, an address that is not valid.
  const { query } = await paying();
  for (const page of [
    await http.get_sattlemeCheckoutPay(request({ query })),
    await http.get_sattlemeCheckoutStatus(request({})),
    await http.get_sattlemeCheckoutPay(request({ query: {} }))
  ]) {
    assert.ok(page.body.includes('<link rel="stylesheet" href="sattlemeCheckoutStyle">'));
    assert.equal(
      page.headers["Content-Security-Policy"],
      "default-src 'none'; style-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
    );
    // Wix replaced the policy with its own, measured: no page in another site's frame all the same.
    assert.equal(page.headers["X-Frame-Options"], "DENY");
  }
  const status = await http.post_sattlemeCheckoutStatus(
    request({ body: `t=${encodeURIComponent(STATUS_TOKEN)}` })
  );
  assert.equal(status.headers["X-Frame-Options"], "DENY");
});

test("an address that is not a payment page's: the same page, whatever is wrong, telling nothing", async () => {
  const { payment, query } = await paying();
  const other = `p${"0".repeat(32)}`;
  const wrong = [
    {},
    { o: payment._id },
    { o: payment._id, k: "0".repeat(32) },
    { o: other, k: query.k },
    { o: "x", k: query.k },
    { o: payment._id, k: query.k.toUpperCase() },
    { o: payment._id, k: `${query.k}0` }
  ];
  const bodies = new Set();
  for (const q of wrong) {
    const reply = await page(q, { "Accept-Language": "fr-CH" });
    assert.equal(reply.status, 404);
    assert.equal(reply.headers["Cache-Control"], "no-store");
    bodies.add(reply.body);
  }
  assert.equal(bodies.size, 1);
  const [body] = bodies;
  assert.match(body, /Ce lien n&#39;est pas valide\./);
  assert.equal(body.includes(payment.data.ref), false);
  assert.equal(statusCalls(), 0);
});

test("the status page: a form; the page with the token alone, which never goes in an address", async () => {
  state.siteLanguage = "en";
  const form = await http.get_sattlemeCheckoutStatus(request({}));
  assert.equal(form.status, 200);
  assert.match(form.body, /<form method="post"/);
  assert.match(form.body, /type="password" name="t" minlength="32"/);
  // Measured: a browser sent no token shorter than 32 characters, and said nothing: the page says.
  assert.ok(
    form.body.includes(
      '<p id="hint">The token has 32 characters or more: a shorter one is not sent, and the page does not change.</p>'
    ),
    form.body
  );
  assert.match(form.headers["Content-Security-Policy"], /frame-ancestors 'none'/);
  assert.equal(form.headers["Cache-Control"], "no-store");

  const wrong = await http.post_sattlemeCheckoutStatus(
    request({ body: "t=not-the-token-at-all-0123456789abcdef" })
  );
  assert.equal(wrong.status, 403);
  assert.match(wrong.body, /Wrong token/);
  const empty = await http.post_sattlemeCheckoutStatus(request({ body: "" }));
  assert.equal(empty.status, 403);

  // Connected with a time to pay of 20 minutes: the page shows it.
  await provider.connectAccount({
    currency: "CHF",
    credentials: { keySecretName: "sattleme-checkout-key", minutesToPay: "20" }
  });
  const { payment } = await paying();
  const page = await http.post_sattlemeCheckoutStatus(
    request({
      body: `t=${encodeURIComponent(STATUS_TOKEN)}`,
      baseUrl: "https://www.my-shop.example/_functions"
    })
  );
  assert.equal(page.status, 200);
  for (const part of [
    "The key in the Secrets Manager is Sunrise Bakery&#39;s",
    "1 to 10000000 sats",
    "40 on-chain addresses",
    "Time to pay an invoice: 20 minutes (the connection&#39;s setting).",
    payment.data.ref,
    `plugin 1.0.0, SDK 1.0.0, checkout-spec 1.0.0; the site&#39;s backend runs Node ${process.version}.`,
    "The job has not run yet"
  ]) {
    assert.ok(page.body.includes(part), part);
  }
  // Its URL kept, for the payment pages' addresses.
  assert.equal(
    state.collections.get("SattlemeCheckout").get("site").data.baseUrl,
    "https://www.my-shop.example/_functions"
  );
  // Neither the key nor the token, in any page.
  for (const body of [form.body, wrong.body, page.body]) {
    assert.equal(body.includes(KEY), false);
    assert.equal(body.includes(STATUS_TOKEN), false);
  }
});

test("the status page: its times in the site's time zone, else UTC; one minute, one address", async () => {
  state.siteLanguage = "en";
  world.merchant.onchainAddresses = 1;
  await provider.connectAccount({
    currency: "CHF",
    credentials: { keySecretName: "sattleme-checkout-key", minutesToPay: "1" }
  });
  const show = () =>
    http.post_sattlemeCheckoutStatus(
      request({
        body: `t=${encodeURIComponent(STATUS_TOKEN)}`,
        baseUrl: "https://www.my-shop.example/_functions"
      })
    );
  // 15 January 2026, 12:00:00 UTC: 13:00:00 in Zurich (winter time).
  clock.set(Date.UTC(2026, 0, 15, 12, 0, 0) / 1000);
  try {
    await jobs.runJob({ lifeMs: 2000, marginMs: 0 });
    let body = (await show()).body;
    for (const part of [
      "Times in Europe/Zurich, the site&#39;s time zone (Settings, General Info).",
      "<td>2026-01-15 13:00:00</td>",
      "Time to pay an invoice: 1 minute (the connection&#39;s setting).",
      "1 on-chain address in the lot."
    ]) {
      assert.ok(body.includes(part), part);
    }
    // No time zone from Wix, or one this runtime does not know: UTC, and the page says so.
    for (const zone of [new Error("no general info"), "Mars/Olympus_Mons", "", null]) {
      state.siteTimeZone = zone;
      body = (await show()).body;
      assert.ok(body.includes("Times in UTC: Wix gave no time zone of the site."), String(zone));
      assert.ok(body.includes("<td>2026-01-15 12:00:00</td>"), String(zone));
    }
    // In French, 0 and 1 take the singular.
    state.siteLanguage = "fr";
    state.siteTimeZone = "America/New_York";
    world.merchant.onchainAddresses = 0;
    await provider.connectAccount({
      currency: "CHF",
      credentials: { keySecretName: "sattleme-checkout-key", minutesToPay: "1" }
    });
    body = (await show()).body;
    for (const part of [
      "Heures en America/New_York",
      "<td>2026-01-15 07:00:00</td>",
      "0 adresse on-chain dans le lot",
      "1 minute (réglage"
    ]) {
      assert.ok(body.includes(part), part);
    }
  } finally {
    clock.reset();
  }
});

test("the status page without its token in the Secrets Manager: says how to make one", async () => {
  state.secrets.delete("sattleme-checkout-status-token");
  const reply = await http.post_sattlemeCheckoutStatus(
    request({ body: "t=anything-anything-anything-anything" })
  );
  assert.equal(reply.status, 403);
  assert.match(reply.body, /sattleme-checkout-status-token/);
  // A token too short to be one is refused the same way.
  state.secrets.set("sattleme-checkout-status-token", "short");
  const short = await http.post_sattlemeCheckoutStatus(request({ body: "t=short" }));
  assert.equal(short.status, 403);
});

test("the status page escapes what it shows; a site URL that is not https is not kept", async () => {
  world.merchant.businessName = "<script>alert(1)</script>";
  const page = await http.post_sattlemeCheckoutStatus(
    request({
      body: `t=${encodeURIComponent(STATUS_TOKEN)}`,
      baseUrl: "http://shop.example/_functions"
    })
  );
  assert.equal(page.body.includes("<script>"), false);
  assert.ok(page.body.includes("&lt;script&gt;"));
  assert.equal(state.collections.get("SattlemeCheckout").get("site").data.baseUrl, SITE_URL);
});

test("the hourly job checks each payment due when it started, once, and keeps its run", async () => {
  const first = await paying();
  const second = await paying();
  setStatus(first.invoice, { state: "paid", method: "lightning", preimage: "01".repeat(32) });
  // The customers left their pages: the job's next run checks both (10 minutes later here).
  clock.advance(10 * 60000);
  try {
    await jobs.runJob({ lifeMs: 2000, marginMs: 0 });
    assert.equal(statusCalls(), 2);
    // The first approved, the second, open, pending.
    const code = (e) => (e.reasonCode === undefined ? "approved" : e.reasonCode);
    assert.deepEqual(
      state.events.map((e) => [e.pluginTransactionId, code(e)]).sort(),
      [
        [first.answer.pluginTransactionId, "approved"],
        [second.answer.pluginTransactionId, 5009]
      ].sort()
    );
    // Its run, under its hour (UTC): the status page shows the last 24.
    const hour = new Date(Date.now()).toISOString().slice(11, 13);
    const runs = items("run");
    assert.deepEqual(
      runs.map((r) => [r._id, r.data.checks, r.data.busy, r.data.errors, r.data.left]),
      [[`run-${hour}`, 2, 0, 0, 0]]
    );
    assert.ok(runs[0].data.endedAt >= runs[0].data.startedAt);
    // Due again at the next run; the paid one when its order is to be read back.
    const [paid, open] = [first, second].map(({ order }) =>
      payments().find((p) => p.data.orderId === order._id)
    );
    assert.equal(paid.data.recorded.state, "todo");
    assert.ok(paid.active && paid.dueAt - Date.now() > 60000);
    assert.ok(open.active && open.dueAt <= Date.now());
    // A run started before a payment was checked again leaves it alone: checked once a run.
    await jobs.runJob({ lifeMs: 2000, marginMs: 0 });
    assert.equal(statusCalls(), 3);
  } finally {
    clock.reset();
  }
});

test("the hourly job keeps to its budget of writes a minute: the site's quota keeps room for the pages", async () => {
  // Wix Data refuses a site's writes past its quota of a minute (Core: 200), the site's own and the
  // customers' pages' included. 60 payments due: the job checks them all, 60 writes a minute at
  // most, waiting when its budget is spent (its waits move the tests' clock).
  for (let i = 0; i < 60; i += 1) await paying();
  clock.advance(10 * 60000);
  const from = state.writeTimes.length;
  let slept = 0;
  try {
    await jobs.runJob({
      sleep: async (ms) => {
        slept += ms;
        clock.advance(ms);
      }
    });
  } finally {
    clock.reset();
  }
  const times = state.writeTimes.slice(from);
  const most = Math.max(...times.map((t) => times.filter((u) => u > t - 60000 && u <= t).length));
  assert.ok(most <= jobs.WRITES_PER_MINUTE, `${most} writes in a minute`);
  assert.equal(jobs.WRITES_PER_MINUTE, 60);
  assert.ok(slept >= 3 * 60000, `${slept} ms waited`);
  assert.equal(statusCalls(), 60);
  assert.deepEqual(
    items("run").map((r) => [r.data.checks, r.data.left, r.data.errors]),
    [[60, 0, 0]]
  );
});

test("a run whose life ends leaves the payments it did not reach to the next run, and counts them", async () => {
  for (let i = 0; i < 4; i += 1) await paying();
  clock.advance(10 * 60000);
  try {
    // Each check takes 500 ms: a life of 400 ms reaches the first three (checked at once).
    world.delays.set("getStatus", 500);
    await jobs.runJob({ lifeMs: 400, marginMs: 0 });
    assert.equal(statusCalls(), 3);
    assert.deepEqual(
      items("run").map((r) => [r.data.checks, r.data.left]),
      [[3, 1]]
    );
    // The next run: the one left first (the longest due), then the others.
    world.delays.delete("getStatus");
    clock.advance(60 * 60000);
    await jobs.runJob({ lifeMs: 2000, marginMs: 0 });
    assert.equal(statusCalls(), 7);
  } finally {
    clock.reset();
  }
});

test("the status page: the job's last runs; a warning once the last is over 70 minutes old", async () => {
  state.siteLanguage = "en";
  const status = () =>
    http.post_sattlemeCheckoutStatus(request({ body: `t=${encodeURIComponent(STATUS_TOKEN)}` }));
  await jobs.runJob({ lifeMs: 300, marginMs: 0 });
  let page = await status();
  assert.ok(
    page.body.includes(
      "<th>Start</th><th>End</th><th>Checks</th><th>Errors</th><th>Left for the next run</th>"
    )
  );
  assert.equal(page.body.includes("more than 70 minutes"), false);
  clock.advance(71 * 60000);
  try {
    page = await status();
    assert.ok(page.body.includes("The job&#39;s last run started more than 70 minutes ago"));
  } finally {
    clock.reset();
  }
});

test("jobs.config: one job, hourly, the function the plugin's file exports", async () => {
  const config = JSON.parse(
    readFileSync(new URL("../../plugin/site/backend/jobs.config", import.meta.url), "utf8")
  );
  assert.equal(config.jobs.length, 1);
  const [job] = config.jobs;
  assert.equal(job.functionLocation, "/sattleme-plugin.js");
  const plugin = await site("sattleme-plugin.js");
  assert.equal(typeof plugin[job.functionName], "function");
  assert.equal(plugin[job.functionName], jobs[job.functionName]);
  assert.match(job.executionConfig.cronExpression, /^[1-9][0-9]? \* \* \* \*$/);
});

test("a job forgets refusals after a week, warnings after 90 days", async () => {
  const all = state.collections.get("SattlemeCheckout");
  const put = (_id, kind, days) =>
    all.set(_id, { _id, kind, active: false, dueAt: Date.now() - days * 86400000, data: {} });
  put("refusal-old", "refusal", 8);
  put("refusal-new", "refusal", 6);
  put("warning-old", "warning", 91);
  put("warning-new", "warning", 89);
  await jobs.runJob({ lifeMs: 100, marginMs: 0 });
  assert.deepEqual([...items("refusal"), ...items("warning")].map((i) => i._id).sort(), [
    "refusal-new",
    "warning-new"
  ]);
});

test("a job forgets payments done 90 days ago, and lock items their payment passed; never an active one", async () => {
  const all = state.collections.get("SattlemeCheckout");
  const old = Date.now() - 91 * 86400000;
  const id = (n) => `p${String(n).repeat(32)}`;
  const put = (_id, kind, active, dueAt, lockGen) =>
    all.set(_id, { _id, kind, active, dueAt, data: { lockGen } });
  put(id(1), "payment", false, old, 4);
  put(id(2), "payment", false, Date.now() - 89 * 86400000, 4);
  // An active payment is never removed, however old its due time (jobs that did not run).
  put(id(3), "payment", true, old, 4);
  // Lock items whose lease ended 91 days ago: of a payment now removed, of one that passed them,
  // of one that did not (its next lock walks past it, then removes it); and one held.
  put(`lock-${id(1)}-3`, "lock", false, old);
  put(`lock-${id(3)}-3`, "lock", false, old);
  put(`lock-${id(3)}-4`, "lock", false, old);
  put(`lock-${id(2)}-4`, "lock", true, Date.now() + 60000);
  // A run too short for any check: its removals alone.
  await jobs.runJob({ lifeMs: 100, marginMs: 1000 });
  assert.deepEqual(
    items("payment")
      .map((i) => i._id)
      .sort(),
    [id(2), id(3)]
  );
  assert.deepEqual(
    items("lock")
      .map((i) => i._id)
      .sort(),
    [`lock-${id(2)}-4`, `lock-${id(3)}-4`]
  );
});

test("a job forgets, after a week, the payments that ended with nothing paid; the others after 90 days", async () => {
  // Anyone can place orders and leave them unpaid: each leaves a record, which counts against the
  // site's CMS items (Core: 4 000). An invoice that expired with nothing received (the SDK's
  // final status), and a payment refused before its invoice: a week. An underpayment, a payment
  // paid: 90 days.
  const expired = await paying();
  setStatus(expired.invoice, { state: "expired", received: "0" });
  const underpaid = await paying("245000");
  setStatus(underpaid.invoice, { state: "expired", received: "500" });
  const paid = await paying();
  setStatus(paid.invoice, { state: "paid", method: "lightning", preimage: "77".repeat(32) });
  failNext("createInvoice", new FakeSdkError("network", true));
  const refusedOrder = newOrder();
  const refused = await provider.createTransaction(transactionOptions(refusedOrder));
  assert.equal(refused.errorCode, "TRY_AGAIN");
  const ids = () =>
    payments()
      .map((p) => p.data.orderId)
      .sort();
  const run = async (ms) => {
    clock.advance(ms);
    await jobs.runJob({ lifeMs: 5000, marginMs: 0 });
  };
  try {
    // Checked, settled (the paid one once its order is read back).
    await run(60 * 60000);
    await run(60 * 60000);
    assert.equal(
      payments().filter((p) => p.active).length,
      0,
      JSON.stringify(payments().map((p) => [p.data.state, p.active]))
    );
    assert.equal(items("refusal").length, 1);
    await run(6 * 86400000);
    assert.equal(payments().length, 4);
    await run(2 * 86400000);
    assert.deepEqual(ids(), [paid.order._id, underpaid.order._id].sort());
    assert.equal(items("refusal").length, 0);
    await run(83 * 86400000);
    assert.deepEqual(ids(), []);
    assert.equal(items("lock").length, 0);
  } finally {
    clock.reset();
  }
});

test("the job leaves a payment its page checked since the run started", async () => {
  const { payment } = await paying();
  clock.advance(60 * 60000);
  try {
    // The run's query found it due; its page checked it before the run read it again.
    state.beforeGet = (id) => {
      if (id !== payment._id) return;
      state.beforeGet = null;
      state.collections.get("SattlemeCheckout").get(id).dueAt = Date.now() + 1;
    };
    const writes = state.writes;
    await jobs.runJob({ lifeMs: 300, marginMs: 0 });
    assert.equal(statusCalls(), 0);
    // Only the run's records: no lock tried.
    assert.equal(items("lock").filter((l) => l._id.includes(payment._id)).length, 0);
    assert.ok(state.writes - writes <= 2);
    assert.deepEqual(
      items("run").map((r) => [r.data.checks, r.data.busy, r.data.left]),
      [[0, 0, 0]]
    );
  } finally {
    clock.reset();
  }
});

test("a payment its page holds: the run leaves it (busy), once, for the next run", async () => {
  const { payment } = await paying();
  clock.advance(60 * 60000);
  try {
    // A lock of its page's check, live.
    const { lock } = await site("sattleme-checkout/store.js");
    const held = await lock(payment._id, payments()[0].data.lockGen, 0);
    assert.ok(held);
    await jobs.runJob({ lifeMs: 2000, marginMs: 0 });
    assert.equal(statusCalls(), 0);
    assert.deepEqual(
      items("run").map((r) => [r.data.checks, r.data.busy, r.data.left]),
      [[0, 1, 0]]
    );
    assert.ok(payments()[0].active);
  } finally {
    clock.reset();
  }
});

test("the status page: a refused connection, until a connection succeeds", async () => {
  state.siteLanguage = "en";
  const status = () =>
    http.post_sattlemeCheckoutStatus(request({ body: `t=${encodeURIComponent(STATUS_TOKEN)}` }));
  const refused = "payment settings was refused";
  assert.equal((await status()).body.includes(refused), false);
  await provider.connectAccount({ currency: "CHF", credentials: { keySecretName: "my-key" } });
  const page = await status();
  assert.ok(page.body.includes(refused));
  assert.ok(page.body.includes("SECRET_NAME"));
  clock.advance(1000);
  try {
    const answer = await provider.connectAccount({
      currency: "CHF",
      credentials: { keySecretName: "sattleme-checkout-key" }
    });
    assert.ok(answer.accountId);
    assert.equal((await status()).body.includes(refused), false);
  } finally {
    clock.advance(-1000);
  }
});

test("the status page: payments that need the merchant, with their Wix order, and the warnings", async () => {
  state.siteLanguage = "en";
  const { payment, invoice } = await paying();
  setStatus(invoice, { state: "expired", received: "5" });
  clock.advance(60 * 60000);
  try {
    await jobs.runJob({ lifeMs: 300, marginMs: 0 });
  } finally {
    clock.reset();
  }
  state.collections.get("SattlemeCheckout").set("warning-x", {
    _id: "warning-x",
    kind: "warning",
    active: false,
    dueAt: Date.now(),
    data: { kind: "lightningOnly", ref: "wix.ref.lightning-only", count: 1 }
  });
  const page = await http.post_sattlemeCheckoutStatus(
    request({ body: `t=${encodeURIComponent(STATUS_TOKEN)}` })
  );
  for (const part of [
    "Payments that need you",
    "Wix lists an order only once it is paid",
    payment.data.orderId,
    "underpaid",
    // Its task, made in the dashboard (Wix's fake took it).
    "<th>Task</th>",
    "<td>made</td>",
    "Warnings",
    "Invoices made without an on-chain address, payable in Lightning only (the last: wix.ref.lightning-only)"
  ]) {
    assert.ok(page.body.includes(part), part);
  }
});

test("a task Wix refuses outright: made again at each check, then failed, its reason on the status page", async () => {
  state.siteLanguage = "en";
  const { payment, invoice } = await paying();
  setStatus(invoice, { state: "expired", received: "5" });
  const status = async () =>
    (
      await http.post_sattlemeCheckoutStatus(
        request({ body: `t=${encodeURIComponent(STATUS_TOKEN)}` })
      )
    ).body;
  // Wix refuses every task, as it refused the measured one: never made, nothing to look for.
  const refused = 'INVALID_ARGUMENT: "task.description" has size 624, expected 500 or less';
  state.failures.set("createTask", {
    times: 100,
    code: "INVALID_ARGUMENT",
    message: refused.slice("INVALID_ARGUMENT: ".length)
  });
  const run = async () => {
    clock.advance(60 * 60000);
    await jobs.runJob({ lifeMs: 300, marginMs: 0 });
  };
  try {
    await run();
    let item = items("payment").find((p) => p._id === payment._id);
    assert.deepEqual([item.data.report.comment, item.data.report.notice], ["done", "done"]);
    // Not "sending": Wix refused it outright, so it is made again at the next check.
    assert.equal(item.data.report.task, "todo");
    assert.equal(item.data.report.errors.task, refused);
    assert.equal(item.active, true);
    let page = await status();
    assert.ok(
      page.includes("not made yet: tried at 1 of 10 checks; Wix answered: INVALID_ARGUMENT"),
      page
    );
    for (let n = 2; n <= 10; n += 1) await run();
    item = items("payment").find((p) => p._id === payment._id);
    assert.equal(item.data.report.task, "failed");
    // Given up: the payment is settled, no check follows.
    assert.equal(item.active, false);
    page = await status();
    assert.ok(
      page.includes("<td>refused by Wix: INVALID_ARGUMENT: &quot;task.description&quot;"),
      page
    );
    // Once, each: the comment and the notification.
    assert.deepEqual([state.comments.length, state.notifications.length], [1, 1]);
  } finally {
    clock.reset();
  }
});

test("the status page: a payment's deposit address on mempool.space, its last error in plain words", async () => {
  state.siteLanguage = "en";
  const order = newOrder();
  const answer = await provider.createTransaction(transactionOptions(order, { amount: "245000" }));
  assert.ok(answer.redirectUrl);
  const payment = payments().find((p) => p.data.orderId === order._id);
  const address = invoicesOf(payment.data.ref)[0].onchainAddress;
  failNext("getStatus", new FakeSdkError("network", true));
  clock.advance(60 * 60000);
  try {
    await jobs.runJob({ lifeMs: 300, marginMs: 0 });
  } finally {
    clock.reset();
  }
  const page = await http.post_sattlemeCheckoutStatus(
    request({ body: `t=${encodeURIComponent(STATUS_TOKEN)}` })
  );
  assert.ok(
    page.body.includes(
      `<td><a href="https://mempool.space/address/${address}" rel="noreferrer noopener">${address}</a></td>`
    ),
    page.body
  );
  assert.ok(
    page.body.includes(
      "<td>the business&#39;s relays or payment services did not answer (network)</td>"
    )
  );
});

test("the plugin's pages carry the sattle.me logo: the kit's, inline, 160 px wide", async () => {
  const { LOGO } = await site("sattleme-checkout/pages.js");
  const kit = readFileSync(new URL("../../docs/sattle-me.svg", import.meta.url), "utf8").trim();
  // The kit's file, its size alone set for the page (the kit's least: 80 px wide).
  assert.equal(LOGO, kit.replace('width="890.4" height="153.8"', 'width="160" height="27.6"'));
  // Nothing Wix's Content-Security-Policy blocks, nothing loaded from elsewhere.
  for (const blocked of ["<style", "style=", "href", "src=", "<script", "url("]) {
    assert.equal(LOGO.includes(blocked), false, blocked);
  }
  const form = await http.get_sattlemeCheckoutStatus(request({}));
  const invalid = await http.get_sattlemeCheckoutPay(request({ query: {} }));
  const { query } = await paying();
  const payment = await http.get_sattlemeCheckoutPay(request({ query }));
  for (const body of [form.body, invalid.body, payment.body]) {
    assert.ok(body.includes(`<p>${LOGO}</p>`));
  }
});
