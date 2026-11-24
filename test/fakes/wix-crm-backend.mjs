// wix-crm-backend: notifications.notify, recorded (state.failures: refused before Wix takes it, or
// once it did), refused past the lengths Wix documents (body, title, action's title: 512 each).
import { checkLength, maybeFail, state } from "./state.mjs";

export const notifications = {
  async notify(body, channels, options) {
    const late = maybeFail("notify");
    checkLength("body", body, 512, 1);
    if (options && options.title !== undefined) checkLength("title", options.title, 512);
    if (options && options.actionTitle !== undefined) {
      checkLength("actionTitle", options.actionTitle, 512);
    }
    state.notifications.push({ body, channels, options });
    if (late) late();
  }
};
