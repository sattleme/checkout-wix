// The payment page's QR code (pages.js, qrSvg, with the QR code encoder of the bundle): what a
// wallet's camera reads is the payment URI, exactly; drawn with presentation attributes alone.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { site } from "../helpers.mjs";
import { readQr, svgModules } from "../qr.mjs";

const { qrSvg } = await site("sattleme-checkout/pages.js");

// The longest invoice of checkout-spec's vectors (breez.tips's, 449 characters).
const vectors = JSON.parse(readFileSync(new URL("../vectors/payments.json", import.meta.url)));
const invoices = [];
JSON.stringify(vectors, (key, value) => {
  if (typeof value === "string" && /^lnbc[0-9a-z]+$/.test(value)) invoices.push(value);
  return value;
});
const BOLT11 = invoices.sort((a, b) => b.length - a.length)[0];
const ADDRESS = `bc1p${"qpzry9x8gf2tvdw0s3jn54khce6mua7l".repeat(2).slice(0, 58)}`;

test("a wallet reads the payment URI exactly: Lightning alone, on-chain alone, and both", () => {
  assert.ok(BOLT11.length > 400, String(BOLT11.length));
  for (const uri of [
    `lightning:${BOLT11}`,
    `bitcoin:${ADDRESS}?amount=0.00049`,
    `bitcoin:${ADDRESS}?amount=0.00049123&lightning=${BOLT11}`
  ]) {
    const svg = qrSvg(uri, "QR");
    assert.equal(readQr(svg), uri);
    // At the size a phone's screen shows it, too.
    assert.equal(readQr(svg, 3), uri);
  }
});

test("a QR code: its quiet zone of 4 modules, presentation attributes alone, no wider than a phone", () => {
  const uri = `bitcoin:${ADDRESS}?amount=0.00049123&lightning=${BOLT11}`;
  const svg = qrSvg(uri, 'QR "code" <of> the payment');
  const modules = svgModules(svg);
  const full = modules.length;
  for (let i = 0; i < full; i += 1) {
    for (const edge of [0, 1, 2, 3, full - 4, full - 3, full - 2, full - 1]) {
      assert.equal(modules[edge][i] || modules[i][edge], false, `quiet zone at ${edge}, ${i}`);
    }
  }
  assert.ok(svg.includes(`<rect width="${full}" height="${full}" fill="#ffffff"/>`));
  assert.ok(svg.includes('aria-label="QR &quot;code&quot; &lt;of&gt; the payment"'));
  for (const blocked of ["style", "<script", "href", "url(", "<text", "<image"]) {
    assert.equal(svg.includes(blocked), false, blocked);
  }
  // Without the stylesheet: 4 px a module, at most 288 px (a 320 px screen and its margins).
  const width = Number(/ width="(\d+)"/.exec(svg)[1]);
  assert.equal(width, 288);
  assert.equal(Number(/ height="(\d+)"/.exec(svg)[1]), 288);
  const small = qrSvg("lightning:lnbc210n1", "QR");
  const smallFull = svgModules(small).length;
  assert.equal(Number(/ width="(\d+)"/.exec(small)[1]), smallFull * 4);
});
