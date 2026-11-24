// What the tests share: a copy of the built plugin, the fakes' state, a clock the tests move, and
// requests as Wix gives them. The plugin is the one scripts/test.mjs names (SATTLEME_TEST_DIST):
// dist/plugin-modules (its separate modules, by default), dist/plugin-site (the release: its one
// file, backend/sattleme-plugin.js, which holds them all) or dist/plugin-test (the release's file
// with the SDK left out, for the fake SDK).

import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { reset, state } from "./fakes/state.mjs";

export { state };

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const layout = process.env.SATTLEME_TEST_DIST || "plugin-modules";
if (!/^plugin-(modules|site|test)$/.test(layout)) throw new Error(`no such build: ${layout}`);
const dist = join(root, "dist", layout);
if (!existsSync(dist)) throw new Error(`dist/${layout} is missing: npm run build first`);
// The release and its tests' twin hold the modules in one file.
const merged = !existsSync(join(dist, "backend", "sattleme-checkout"));

// A copy per test process, under a name the module hooks know (test/fakes/hooks.mjs).
const copy = mkdtempSync(join(tmpdir(), "checkout-wix-site-"));
cpSync(dist, copy, { recursive: true });
process.on("exit", () => rmSync(copy, { recursive: true, force: true }));

/**
 * A file of the site's backend ("http-functions.js"), or a module of the plugin
 * ("sattleme-checkout/payments.js"), imported: in the release's one file, that module as it holds
 * it (its `modules`), the very instance its other files call.
 */
export async function site(path) {
  const module = /^sattleme-checkout\/([a-z0-9-]+)\.js$/.exec(path);
  if (merged && module) {
    const plugin = await import(pathToFileURL(join(copy, "backend", "sattleme-plugin.js")).href);
    const found = plugin.modules[module[1]];
    if (!found) throw new Error(`the plugin's file holds no module ${module[1]}`);
    return found;
  }
  return import(pathToFileURL(join(copy, "backend", path)).href);
}

// The clock: Date.now() moves with real time, plus what the tests add.
const realNow = Date.now.bind(Date);
let offset = 0;
Date.now = () => realNow() + offset;
export const clock = {
  /** Sets the clock to Unix second `seconds`. */
  set(seconds) {
    offset = seconds * 1000 - realNow();
  },
  advance(ms) {
    offset += ms;
  },
  /** Back to real time. */
  reset() {
    offset = 0;
  },
  seconds() {
    return Math.floor(Date.now() / 1000);
  }
};

export const KEY =
  "sattleme_ck_test-key-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
export const STATUS_TOKEN = "status-token-0123456789abcdef0123456789abcdef";
export const SITE_URL = "https://shop.example/_functions";

/** A site with the plugin installed: its secrets, its collection made, its URL kept. */
export function freshSite({ key = KEY, collection = true, siteUrl = SITE_URL } = {}) {
  reset();
  if (key) state.secrets.set("sattleme-checkout-key", key);
  state.secrets.set("sattleme-checkout-status-token", STATUS_TOKEN);
  if (collection) {
    state.collections.set("SattlemeCheckout", new Map());
    if (siteUrl) {
      state.collections.get("SattlemeCheckout").set("site", {
        _id: "site",
        kind: "config",
        active: false,
        dueAt: 0,
        data: { baseUrl: siteUrl, savedAt: 0 }
      });
    }
  }
}

let orders = 0;

/** An order of Wix eCommerce, waiting for its payment (as createTransaction finds it). */
export function newOrder(fields) {
  orders += 1;
  const id = `0000000${orders}-aaaa-4bbb-8ccc-${String(orders).padStart(12, "0")}`;
  const order = Object.assign(
    {
      _id: id,
      number: String(10000 + orders),
      status: "INITIALIZED",
      paymentStatus: "NOT_PAID",
      buyerInfo: { contactId: "0c0c0c0c-0000-4000-8000-000000000001" }
    },
    fields || {}
  );
  state.orders.set(id, order);
  return order;
}

let transactions = 0;

/** createTransaction's options, as Wix gives them, for `order`. */
export function transactionOptions(
  order,
  { amount = "2450", currency = "CHF", wixTransactionId } = {}
) {
  transactions += 1;
  const id = wixTransactionId || `wtx-${String(transactions).padStart(4, "0")}-aaaa-bbbb-cccc`;
  if (order) {
    state.transactionOrders.set(id, order._id);
    // Wix charges what the order has due (its total here, 2 decimals): its getOrder says the same.
    const minor = String(amount).padStart(3, "0");
    Object.assign(order, {
      currency,
      priceSummary: { total: { amount: `${minor.slice(0, -2)}.${minor.slice(-2)}` } }
    });
  }
  return {
    wixTransactionId: id,
    paymentMethod: "hostedPage",
    merchantCredentials: { keySecretName: "sattleme-checkout-key" },
    order: {
      _id: order ? order._id : undefined,
      description: {
        totalAmount: amount,
        currency,
        items: [{ _id: "i1", name: "Bread", quantity: 1, price: amount }],
        buyerInfo: { buyerLanguage: "de" }
      },
      returnUrls: {
        successUrl: `https://cashier-services.wix.com/redirections/${id}/approved`,
        errorUrl: `https://cashier-services.wix.com/redirections/${id}/error`,
        cancelUrl: `https://cashier-services.wix.com/redirections/${id}/canceled`,
        pendingUrl: `https://cashier-services.wix.com/redirections/${id}/pending`
      }
    },
    wixMerchantId: "merchant-1"
  };
}

/** The items of the plugin's collection of `kind`. */
export function items(kind) {
  const all = state.collections.get("SattlemeCheckout");
  return all ? [...all.values()].filter((item) => item.kind === kind) : [];
}

export function payments() {
  return items("payment");
}

/** A request to an HTTP function, as wix-http-functions gives it. */
export function request({ query = {}, headers = {}, body = "", baseUrl = SITE_URL } = {}) {
  return {
    query,
    headers,
    baseUrl,
    body: { text: async () => body }
  };
}
