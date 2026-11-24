// @wix/ecom (Wix's JavaScript SDK): orders.addActivities, recorded as comments (state.failures:
// refused before Wix takes it, or once it did), refused past the length Wix documents (a
// comment's message: 1 to 5000 characters).
import { checkLength, maybeFail, state } from "./state.mjs";

export const orders = {
  async addActivities(orderId, options) {
    const late = maybeFail("addActivities");
    if (!state.orders.has(orderId)) throw new Error(`order ${orderId} not found`);
    for (const activity of options.orderActivities) {
      if (activity.activityType !== "MERCHANT_COMMENT") throw new Error("not a comment");
      checkLength("merchantComment.message", activity.merchantComment.message, 5000, 1);
      state.comments.push({ orderId, message: activity.merchantComment.message });
    }
    if (late) late();
    return { activityIds: options.orderActivities.map((_, i) => `activity-${i}`) };
  }
};
