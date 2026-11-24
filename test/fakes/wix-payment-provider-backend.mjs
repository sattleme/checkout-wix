// wix-payment-provider-backend: submitEvent records each event, duplicates included (measured: Wix
// answers the same to every event), or fails when the test says so (state.failures: before Wix
// takes it, or once it did). An approved event makes its order paid, as Wix does, unless the test
// says Wix does not apply its events (measured: Wix left two orders pending after their declined
// events).
import { maybeFail, state } from "./state.mjs";

export default {
  async submitEvent(request) {
    await new Promise((resolve) => setImmediate(resolve));
    const late = maybeFail("submitEvent");
    const transaction = JSON.parse(JSON.stringify(request.event.transaction));
    state.events.push(transaction);
    const order = state.orders.get(state.transactionOrders.get(transaction.wixTransactionId));
    if (order && state.applyEvents && transaction.reasonCode === undefined) {
      Object.assign(order, { status: "APPROVED", paymentStatus: "PAID" });
    }
    if (late) late();
    return {};
  }
};
