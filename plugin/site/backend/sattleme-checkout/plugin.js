// The Payment Provider service plugin's functions, which backend/service-plugins/payment-provider/
// sattlemeCheckout/sattlemeCheckout.js exports for Wix (its getConfig is in
// sattlemeCheckout-config.js, on its own: Wix reads it when the site is published).

import { TIMEOUTS } from "./constants.js";
import {
  connectAccount as connect,
  createTransaction as create,
  newContext,
  REASON
} from "./payments.js";
import { logError } from "./safety.js";

function failed(error) {
  logError("the payment plugin failed", error);
  return {
    reasonCode: REASON.general,
    errorCode: "GENERAL_ERROR",
    errorMessage: "Unexpected error."
  };
}

export async function connectAccount(options) {
  try {
    return await connect(options, newContext(TIMEOUTS.connect));
  } catch (error) {
    return failed(error);
  }
}

export async function createTransaction(options) {
  try {
    return await create(options, newContext(TIMEOUTS.createTransaction));
  } catch (error) {
    return failed(error);
  }
}

/** No refund: the SDK cannot spend. The merchant refunds from the sattle.me app. */
export async function refundTransaction() {
  return {
    reasonCode: REASON.refund,
    errorCode: "REFUND_NOT_ALLOWED",
    errorMessage: "Refund from your sattle.me app: this plugin cannot send funds."
  };
}
