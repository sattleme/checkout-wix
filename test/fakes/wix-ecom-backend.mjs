// wix-ecom-backend: getOrder, which throws for an order it does not have. The order's activities
// hold the comments made on it (@wix/ecom's addActivities, wix-ecom-sdk.mjs), as Wix's Order has
// them: { _id, type: "MERCHANT_COMMENT", merchantComment: { message } }.
import { maybeFail, state } from "./state.mjs";

export const orders = {
  async getOrder(id) {
    maybeFail("getOrder");
    const order = state.orders.get(id);
    if (!order) throw new Error(`order ${id} not found`);
    const activities = state.comments
      .map((comment, i) => ({ comment, i }))
      .filter(({ comment }) => comment.orderId === id)
      .map(({ comment, i }) => ({
        _id: `activity-${i + 1}`,
        type: "MERCHANT_COMMENT",
        merchantComment: { message: comment.message }
      }));
    return JSON.parse(JSON.stringify(Object.assign({ activities }, order)));
  }
};
