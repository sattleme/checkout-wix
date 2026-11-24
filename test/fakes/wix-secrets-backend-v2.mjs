// wix-secrets-backend.v2: getSecretValue answers { value }, as documented and as measured on a Wix
// site; it throws for a name the site does not have.
import { state } from "./state.mjs";

export const secrets = {
  async getSecretValue(name) {
    if (!state.secrets.has(name)) throw new Error(`secret ${name} not found`);
    return { value: state.secrets.get(name) };
  }
};
