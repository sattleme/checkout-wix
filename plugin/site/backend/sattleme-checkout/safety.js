// What the plugin writes to Wix's logs and its records: never a secret. The integration key and the
// status page's token are remembered here when they are read, and masked, plain or URL-encoded, in
// every message, error or warning the plugin logs or keeps (an error's message may hold a URL, a
// third party's answer anything).

const SECRETS = [];

/** Remembers `value` as a secret, to be masked from then on. */
export function rememberSecret(value) {
  if (typeof value === "string" && value.length >= 8 && SECRETS.indexOf(value) === -1) {
    SECRETS.push(value);
    // An integration key's parts too (SPEC.md §8: dot-separated), should one appear alone.
    for (const part of value.split(".")) {
      if (part.length >= 16 && SECRETS.indexOf(part) === -1) SECRETS.push(part);
    }
  }
}

/** `text` with every secret this container has read masked. */
export function redact(text) {
  let out = String(text);
  for (const secret of SECRETS) {
    for (const form of [secret, encodeURIComponent(secret)]) out = out.split(form).join("[secret]");
  }
  return out;
}

/** An error as data, masked: its name, its SDK code (or other code), its message (300 at most). */
export function describeError(error) {
  if (error && typeof error === "object") {
    return {
      name: redact(error.name || "Error").slice(0, 80),
      code:
        error.code === undefined || error.code === null ? null : redact(error.code).slice(0, 80),
      message: redact(error.message || "").slice(0, 300)
    };
  }
  return { name: typeof error, code: null, message: redact(error).slice(0, 300) };
}

/** Wix's site logs (Developer Tools → Logging), masked, prefixed. */
export function logInfo(message) {
  console.info(`[sattleme-checkout] ${redact(message)}`);
}

export function logWarning(message) {
  console.warn(`[sattleme-checkout] ${redact(message)}`);
}

export function logError(message, error) {
  const detail = error === undefined ? "" : ` ${JSON.stringify(describeError(error))}`;
  console.error(`[sattleme-checkout] ${redact(message)}${detail}`);
}
