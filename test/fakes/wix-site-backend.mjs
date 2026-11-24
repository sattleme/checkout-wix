// wix-site-backend: the site's language and time zone (General Info).
import { state } from "./state.mjs";

export default {
  generalInfo: {
    async getLanguage() {
      return state.siteLanguage;
    },
    async getTimeZone() {
      if (state.siteTimeZone instanceof Error) throw state.siteTimeZone;
      return state.siteTimeZone;
    }
  }
};
