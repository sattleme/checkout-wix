// References and identifiers (refs.js), the texts in every language (i18n.js), and what never
// reaches a log (safety.js).

import assert from "node:assert/strict";
import { test } from "node:test";

import { site, state } from "../helpers.mjs";

const refs = await site("sattleme-checkout/refs.js");
const i18n = await site("sattleme-checkout/i18n.js");
const safety = await site("sattleme-checkout/safety.js");
const wix = await site("sattleme-checkout/wix.js");

test("a reference: the order's id, then 128 random bits of the CSPRNG; SPEC.md §17", () => {
  const order = "8c1b2a3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
  const refsOfOrder = Array.from({ length: 200 }, () => refs.newRef(order));
  for (const ref of refsOfOrder) {
    assert.match(ref, /^wix\.8c1b2a3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d\.[A-Za-z0-9_-]{22}$/);
    assert.equal(ref.length, 63);
    assert.match(ref, /^[A-Za-z0-9._:-]{1,64}$/);
    // 22 characters of base64url: 16 bytes, all of them drawn.
    assert.equal(Buffer.from(ref.slice(41), "base64url").length, 16);
  }
  assert.equal(new Set(refsOfOrder).size, refsOfOrder.length);
  // Any other key of an order (a transaction's): hashed, never as it is.
  const other = refs.newRef("tx:some/other key with spaces");
  assert.match(other, /^wix\.[0-9a-f]{32}\.[A-Za-z0-9_-]{22}$/);
  assert.equal(refs.noteOf(order), "Wix 8c1b2a3d");
  // Wix's id of an order's transaction: its reference, numbered.
  const ref = refsOfOrder[0];
  assert.equal(refs.transactionIdOf(ref, 1), `${ref}.1`);
  assert.equal(refs.transactionIdOf(ref, 12), `${ref}.12`);
  assert.throws(() => refs.transactionIdOf(ref, 0));
  assert.throws(() => refs.transactionIdOf(null, 1));
});

test("the same secret, compared in constant time", () => {
  assert.equal(refs.sameSecret("abc", "abc"), true);
  assert.equal(refs.sameSecret("abc", "abd"), false);
  assert.equal(refs.sameSecret("abc", null), false);
  assert.equal(refs.sameSecret(undefined, undefined), false);
});

test("every text in every language, with the same placeholders; English the source", () => {
  assert.deepEqual(i18n.LANGUAGES, ["en", "fr", "de", "it"]);
  const placeholders = (text) => (text.match(/\{[A-Za-z]+\}/g) || []).sort().join(",");
  for (const key of i18n.keys()) {
    const source = i18n.textOf(key, "en");
    assert.equal(typeof source, "string", key);
    for (const language of i18n.LANGUAGES) {
      const text = i18n.textOf(key, language);
      assert.equal(typeof text, "string", `${key} ${language}`);
      assert.ok(text.trim().length > 0, `${key} ${language}`);
      assert.equal(placeholders(text), placeholders(source), `${key} ${language}`);
    }
  }
  assert.equal(i18n.t("de", "refusal.currency", { currency: "XYZ" }).includes("XYZ"), true);
  assert.equal(i18n.t("xx", "status.none"), "None.");
  assert.equal(i18n.t("fr", "no.such.key"), "no.such.key");
});

test("a task's title, in every language, fits in 200 characters with large values", () => {
  const values = {
    number: "Wix 8c1b2a3d",
    received: "123456789",
    due: "123456789",
    came: "123456789",
    sats: "123456789",
    invoicePrice: "1234567.89 CHF",
    price: "1234567.89 CHF",
    total: "1234567.89 CHF"
  };
  for (const reason of ["underpaid", "canceled", "mismatch", "stale", "unrecorded", "changed"]) {
    for (const language of i18n.LANGUAGES) {
      const title = i18n.t(language, `task.${reason}`, values);
      assert.ok(title.length <= 200, `${reason} ${language}: ${title.length}`);
      assert.equal(/\{[A-Za-z]+\}/.test(title), false, `${reason} ${language}`);
    }
  }
});

test("a text cut to Wix's limit: at a character boundary, never inside a surrogate pair", () => {
  assert.equal(i18n.clip("short", 10), "short");
  assert.equal(i18n.clip("abcdef", 4), "abc…");
  assert.equal(i18n.clip("ab cdef", 4), "ab…");
  assert.equal(i18n.clip("a\u{1F950}b", 3), "a…");
  assert.equal(i18n.clip("\u{1F950}\u{1F950}", 3), "\u{1F950}…");
  assert.equal(i18n.clip("\u{1F950}\u{1F950}", 2), "…");
  const text = "x\u{1F950}y\u{1F950}\u{1F950}z".repeat(20);
  for (let max = 1; max <= text.length; max += 1) {
    const cut = i18n.clip(text, max);
    assert.ok(cut.length <= max, String(max));
    assert.equal(/[\ud800-\udbff](?![\udc00-\udfff])/.test(cut), false, String(max));
  }
});

test("languages: the site's, the browser's, English by default", () => {
  assert.equal(i18n.pickLanguage("fr-CH"), "fr");
  assert.equal(i18n.pickLanguage("de_CH"), "de");
  assert.equal(i18n.pickLanguage("it-IT"), "it");
  // English for the languages the plugin does not speak.
  assert.equal(i18n.pickLanguage("pt-BR"), "en");
  assert.equal(i18n.pickLanguage("es"), "en");
  assert.equal(i18n.pickLanguage("ja"), "en");
  assert.equal(i18n.pickLanguage(undefined), "en");
  // An order's language the plugin lacks is none: its page follows the browser's.
  assert.equal(i18n.languageOf("de-CH"), "de");
  assert.equal(i18n.languageOf("es"), null);
  assert.equal(i18n.languageOf(undefined), null);
  assert.equal(i18n.acceptedLanguage("ja,de-CH;q=0.9,fr;q=0.8"), "de");
  assert.equal(i18n.acceptedLanguage("es-ES,es;q=0.9,it;q=0.5"), "it");
  assert.equal(i18n.acceptedLanguage("ja"), "en");
  assert.equal(i18n.acceptedLanguage(null), "en");
});

test("a secret read is masked everywhere: plain, URL-encoded, and the key's parts", () => {
  const key = "sattleme_ck_TEAMPARTxxxxxxxxxxxxxxxxxxx.SECRETPARTyyyyyyyyyyyyyyyy.cmVsYXk";
  safety.rememberSecret(key);
  const leaked = `failed: https://x.example/?k=${encodeURIComponent(key)} and ${key} and SECRETPARTyyyyyyyyyyyyyyyy`;
  const masked = safety.redact(leaked);
  assert.equal(masked.includes("SECRETPART"), false);
  assert.equal(masked.includes("TEAMPART"), false);
  assert.equal(masked.includes("[secret]"), true);
  const described = safety.describeError(
    Object.assign(new Error(`bad ${key}`), { code: "network" })
  );
  assert.deepEqual(described, { name: "Error", code: "network", message: "bad [secret]" });
  // Short values are not secrets to mask (they would mask words).
  safety.rememberSecret("abc");
  assert.equal(safety.redact("abc"), "abc");
});

test("a secret saved with a line break around it is masked as it is used, trimmed", async () => {
  state.secrets.set("padded-secret", "  padded-token-0123456789abcdef\n");
  assert.equal(await wix.readSecret("padded-secret"), "padded-token-0123456789abcdef");
  assert.equal(safety.redact("a padded-token-0123456789abcdef b"), "a [secret] b");
});

test("singular and plural: 1 in English, German and Italian; 0 and 1 in French", () => {
  const cases = [
    ["en", 0, "0 on-chain addresses"],
    ["en", 1, "1 on-chain address"],
    ["en", 2, "2 on-chain addresses"],
    ["fr", 0, "0 adresse on-chain"],
    ["fr", 1, "1 adresse on-chain"],
    ["fr", 2, "2 adresses on-chain"],
    ["de", 1, "1 On-Chain-Adresse"],
    ["de", 2, "2 On-Chain-Adressen"],
    ["it", 1, "1 indirizzo on-chain"],
    ["it", 2, "2 indirizzi on-chain"]
  ];
  for (const [language, addresses, expected] of cases) {
    const values = { business: "B", min: "1", max: "2", addresses: String(addresses) };
    const text = i18n.tn(language, "connect.accountName", addresses, values);
    assert.ok(text.endsWith(expected), `${language} ${addresses}: ${text}`);
  }
  assert.equal(i18n.t("en", "status.minutes.one", { minutes: "1" }).includes("1 minute "), true);
  // A key without a singular form: the same text whatever the count.
  assert.equal(i18n.tn("en", "status.none", 1), i18n.t("en", "status.none"));
});
