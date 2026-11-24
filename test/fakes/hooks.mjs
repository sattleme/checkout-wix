// Module hooks for the tests (Node 18.17.1 and later): the built plugin's files are loaded from a
// copy of dist/plugin-site, as a Wix site holds them, with
// - the Wix modules a site's backend imports ("wix-data", "@wix/ecom"…) resolved to the fakes of
//   this directory;
// - the plugin's own .js files as ES modules, and its bundle of the SDK (checkout-sdk.js) as the
//   CommonJS module it is, as Wix's build loads them (the copy has no package.json);
// - with SATTLEME_TEST_SDK=fake, the bundle replaced by the fake SDK (checkout-sdk.mjs).

import { readFile } from "node:fs/promises";

const FAKES = {
  "wix-auth": "wix-auth.mjs",
  "wix-crm-backend": "wix-crm-backend.mjs",
  "wix-crm.v2": "wix-crm-v2.mjs",
  "wix-data": "wix-data.mjs",
  "wix-data.v2": "wix-data-v2.mjs",
  "wix-ecom-backend": "wix-ecom-backend.mjs",
  "wix-http-functions": "wix-http-functions.mjs",
  "wix-payment-provider-backend": "wix-payment-provider-backend.mjs",
  "wix-secrets-backend.v2": "wix-secrets-backend-v2.mjs",
  "wix-site-backend": "wix-site-backend.mjs",
  "@wix/ecom": "wix-ecom-sdk.mjs",
  "@wix/essentials": "wix-essentials-sdk.mjs"
};

// The directory of the copy (test/helpers.mjs).
const SITE = "/checkout-wix-site-";

export async function resolve(specifier, context, next) {
  if (Object.prototype.hasOwnProperty.call(FAKES, specifier)) {
    return { url: new URL(FAKES[specifier], import.meta.url).href, shortCircuit: true };
  }
  const parent = context.parentURL || "";
  if (
    process.env.SATTLEME_TEST_SDK === "fake" &&
    specifier === "./checkout-sdk.js" &&
    parent.includes(SITE)
  ) {
    return { url: new URL("checkout-sdk.mjs", import.meta.url).href, shortCircuit: true };
  }
  return next(specifier, context);
}

export async function load(url, context, next) {
  if (url.includes(SITE) && url.endsWith(".js") && !url.endsWith("/checkout-sdk.js")) {
    return { format: "module", source: await readFile(new URL(url), "utf8"), shortCircuit: true };
  }
  return next(url, context);
}
