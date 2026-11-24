// sattle.me Checkout for Wix: what the site's entry points call (the payment provider's
// service-plugins/payment-provider/sattlemeCheckout/sattlemeCheckout.js, http-functions.js,
// events.js, and jobs.config's job). In a release this one file holds the whole plugin: every
// module of sattleme-checkout/, the sattle.me SDK and the QR code encoder, merged by the build
// (scripts/build.mjs); the repository keeps them as separate modules.

import * as amounts from "./sattleme-checkout/amounts.js";
import * as constants from "./sattleme-checkout/constants.js";
import * as currencies from "./sattleme-checkout/currencies.js";
import * as http from "./sattleme-checkout/http.js";
import * as i18n from "./sattleme-checkout/i18n.js";
import * as jobs from "./sattleme-checkout/jobs.js";
import * as pages from "./sattleme-checkout/pages.js";
import * as payments from "./sattleme-checkout/payments.js";
import * as plugin from "./sattleme-checkout/plugin.js";
import * as privacy from "./sattleme-checkout/privacy.js";
import * as refs from "./sattleme-checkout/refs.js";
import * as safety from "./sattleme-checkout/safety.js";
import * as sdk from "./sattleme-checkout/sdk.js";
import * as store from "./sattleme-checkout/store.js";
import * as wix from "./sattleme-checkout/wix.js";

// The payment provider (service-plugins/payment-provider/sattlemeCheckout/sattlemeCheckout.js).
export const connectAccount = plugin.connectAccount;
export const createTransaction = plugin.createTransaction;
export const refundTransaction = plugin.refundTransaction;

// The HTTP functions (http-functions.js): the payment page, its stylesheet, the status page.
export const payRequest = http.payRequest;
export const styleRequest = http.styleRequest;
export const statusForm = http.statusForm;
export const statusRequest = http.statusRequest;

// The backend events (events.js): a contact deleted, contacts merged.
export const contactDeleted = privacy.contactDeleted;
export const contactsMerged = privacy.contactsMerged;

// The scheduled job (jobs.config: functionLocation "/sattleme-plugin.js").
export const sattlemeCheckoutJob = jobs.sattlemeCheckoutJob;

/**
 * The plugin's modules, for its tests (test/helpers.mjs), which run on a release's very file as
 * on the modules: nothing of Wix calls them. A backend file's exports are not reachable from a
 * browser (only a web module's, .web.js or .jsw, are).
 */
export const modules = Object.freeze({
  amounts,
  constants,
  currencies,
  http,
  i18n,
  jobs,
  pages,
  payments,
  plugin,
  privacy,
  refs,
  safety,
  sdk,
  store,
  wix
});
