// Loads the plugin's bundle of the SDK (backend/sattleme-checkout/checkout-sdk.js of the plugin's
// modules, dist/plugin-modules; a release merges the same packages into its one file, which the
// tests load, on the same Nodes) on the Node that runs this script, as a Wix site's backend loads it (CommonJS), and checks offline what the plugin
// needs of it, before and after the bundle gives the runtime the Web Crypto global
// (installWebCrypto): its exports, a client of checkout-spec's public test key (test/vectors/
// app.json: it makes no request), a currency's decimals, a conversion, a QR code. On Node 18 (a
// Wix site's backend, measured: 18.17.1) the client needs the Web Crypto global, which
// installWebCrypto gives. CommonJS on purpose: it runs on any Node.
//
//   node scripts/bundle-compat.cjs dist/plugin-modules/backend/sattleme-checkout/checkout-sdk.js

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

// checkout-spec, vectors/app/app.json (copied in test/vectors): the app's test key, whose relay is
// relay.example, and its team.
const app = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "test", "vectors", "app.json"), "utf8")
);
const VECTOR_KEY = app.secretKey;
const VECTOR_TEAM = app.parsed.team;

const major = Number(process.versions.node.split(".")[0]);
if (major < 18) {
  console.error(`Node ${process.version}: a Wix site's backend runs Node 18 or later`);
  process.exit(1);
}

// The repository's package.json says "type": "module": a copy with the .cjs extension is CommonJS.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bundle-"));
process.on("exit", () => fs.rmSync(dir, { recursive: true, force: true }));
const copy = path.join(dir, "checkout-sdk.cjs");
fs.copyFileSync(process.argv[2], copy);

function attempt(run) {
  try {
    return { ok: true, value: run() };
  } catch (error) {
    return { ok: false, error: `${error && error.name}: ${error && error.message}` };
  }
}

const sdk = require(copy);
const client = () =>
  new sdk.Sattleme({ key: VECTOR_KEY, logger: { warn() {} } }).toJSON().teamPublicKey;
const hadCrypto = !!globalThis.crypto && typeof globalThis.crypto.getRandomValues === "function";
const before = attempt(client);
const installed = sdk.installWebCrypto();
const after = attempt(client);
const report = {
  node: process.version,
  exports: ["Sattleme", "currencyDigits", "fiatToSats", "installWebCrypto", "qrEncode"].filter(
    (name) => typeof sdk[name] === "function"
  ),
  hadCrypto,
  clientBefore: before,
  installed,
  clientAfter: after,
  digits: {
    CHF: sdk.currencyDigits("CHF"),
    JPY: sdk.currencyDigits("JPY"),
    XYZ: sdk.currencyDigits("XYZ")
  },
  // SPEC.md §25: 24.50 CHF at 69 012 CHF/BTC is 35 502 sats.
  conversion: String(sdk.fiatToSats({ amount: "24.50", currency: "CHF" }, "69012")),
  // A payment URI as the payment page shows it: version 2 at level M (25 modules).
  qr: attempt(() => sdk.qrEncode("lightning:lnbc210n1", { ecc: "M", border: 0 }).size)
};
console.log(JSON.stringify(report, null, 1));

const problems = [];
if (report.exports.length !== 5) problems.push("exports missing");
if (!installed || !after.ok || after.value !== VECTOR_TEAM)
  problems.push("no client after installWebCrypto");
if (hadCrypto && !before.ok) problems.push("no client with the runtime's own Web Crypto");
if (report.digits.CHF !== 2 || report.digits.JPY !== 0 || report.digits.XYZ !== null) {
  problems.push("currency decimals");
}
if (report.conversion !== "35502") problems.push("conversion");
if (!report.qr.ok || report.qr.value !== 25) problems.push("QR code");
if (problems.length) {
  console.error(`Node ${process.version}: ${problems.join(", ")}`);
  process.exit(1);
}
