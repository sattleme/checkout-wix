// What the fakes of the Wix modules hold, shared with the tests: the collections, the secrets, the
// orders, what was sent to Wix (events, comments, notifications, tasks), and what the tests make
// fail.

export const state = {};

export function reset() {
  Object.assign(state, {
    collections: new Map(),
    // What Wix Data's mirrors hold (wix-data.mjs): each item's versions, by collection and _id.
    history: new Map(),
    // How long a write takes to reach the mirrors that reads go to, unless they ask for
    // consistentRead (Wix: "a short delay (typically a few seconds)"); 0: at once.
    lagMs: 3000,
    createdCollections: [],
    secrets: new Map(),
    orders: new Map(),
    // Each transaction's order (transactionOptions), for the events Wix applies to it.
    transactionOrders: new Map(),
    events: [],
    // Whether Wix applies the events it gets to their orders (measured: not always).
    applyEvents: true,
    comments: [],
    notifications: [],
    tasks: [],
    siteLanguage: "fr",
    // The site's time zone (General Info), or an Error Wix throws.
    siteTimeZone: "Europe/Zurich",
    // Names of the fakes' calls that fail, and how (maybeFail).
    failures: new Map(),
    // Wix Data's write requests, each call of insert, save or bulkRemove, refused or not: their
    // count, and the time of each; and its read requests (get, find).
    writes: 0,
    writeTimes: [],
    reads: 0,
    // Wix Data's write requests a minute, past which a request is refused (WDE0014).
    writeQuota: Infinity,
    // Called with the id of each get() before it reads: what another request changed meanwhile.
    beforeGet: null,
    // A function giving how many turns of the event loop each Wix Data call waits first (null: one),
    // so that concurrent calls interleave in other orders.
    jitter: null
  });
}

reset();

/** An error of Wix Data: its code first in its message, as Wix's are. */
export function dataError(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  return error;
}

/**
 * Wix's refusal of a value longer than its documented limit (measured: `INVALID_ARGUMENT:
 * "task.description" has size 624, expected 500 or less`), counted as UTF-16 code units, the
 * strictest count; or of a value that must be a GUID.
 */
export function checkLength(name, value, max, min = 0) {
  const length = typeof value === "string" ? value.length : 0;
  if (length > max || length < min) {
    const error = new Error(
      `INVALID_ARGUMENT: "${name}" has size ${length}, expected ${max} or less` +
        (min ? ` and ${min} or more` : "")
    );
    error.code = "INVALID_ARGUMENT";
    throw error;
  }
}

export function checkGuid(name, value) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value))) {
    const error = new Error(`INVALID_ARGUMENT: "${name}" must be a valid GUID`);
    error.code = "INVALID_ARGUMENT";
    throw error;
  }
}

/**
 * Applies what the test asked of call `name` (`state.failures`): a number n fails the next n
 * calls, before anything is done (Wix refused them); an object `{ skip, times, code, applied }`
 * lets `skip` calls through, then fails `times` calls with an error of `code` (and `message`):
 * WDE0014 (the quota of requests a minute) when it names none, or, with `applied`, WDE0028 (Wix Data's time limit)
 * once the call was applied: its answer came too late, its write is done. Returns, for such a
 * call, the function that throws its error once it is applied; else null.
 */
export function maybeFail(name) {
  const rule = state.failures.get(name);
  if (!rule) return null;
  if (typeof rule === "number") {
    state.failures.set(name, rule - 1);
    throw new Error(`${name} failed (fake)`);
  }
  if (rule.skip > 0) {
    rule.skip -= 1;
    return null;
  }
  if (!(rule.times > 0)) return null;
  rule.times -= 1;
  if (rule.applied) {
    const late = dataError(rule.code || "WDE0028", "Operation time limit exceeded.");
    return () => {
      throw late;
    };
  }
  throw dataError(rule.code || "WDE0014", rule.message || "Requests per minute quota exceeded.");
}
