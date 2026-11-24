// The background job (backend/jobs.config): one, hourly. Wix runs a site's job once an hour at
// most on most plans (its docs: "up to 20 scheduled jobs that run at a minimum of 1 hour
// intervals", every 5 minutes on Elite plans only), "within 5 minutes of the specified time", and
// stops one after about 305 s (measured). The payment page checks a payment while its customer is
// on it (http.js); the job does the rest, once an hour: a payment whose customer left (paid after
// they left, or expired), an on-chain payment being confirmed, an order read back after its
// approval, a comment or notification Wix refused before, and the cleanup. The site keeps its
// other job slots.
//
// Wix Data refuses a site's write requests past its quota of a minute, all of the site's writes
// together (WDE0014: "subsequent requests during the same minute are not processed"): 200 a minute
// on Wix's Core plan, 120 on Studio's Basic plan (Wix's help, "Changes to premium plan
// limitations", 10 November 2024). The job keeps its own to WRITES_PER_MINUTE in any minute, half
// of the least of these, and leaves the rest to the customers' payment pages and the site.

import { JOB_LIFE_MS, TIMEOUTS } from "./constants.js";
import { checkPayment, newContext } from "./payments.js";
import { logError } from "./safety.js";
import * as store from "./store.js";

// Payments checked at once, and read at a time; Wix Data's most items in one query.
const AT_ONCE = 3;
const BATCH = 30;
const MAX_QUERY = 1000;
// The job's write requests in any minute, at most; what a check writes at most (its lock, its
// outbox, its record, its lock removed: payments.js).
export const WRITES_PER_MINUTE = 60;
const WRITES_PER_CHECK = 4;
const MINUTE = 60000;
// No check starts with less than this left of the run's life.
const MARGIN_MS = TIMEOUTS.job.deadlineMs + 15000;
// What no check needs any more is kept this long, then removed: warnings, since their last time;
// a payment no check follows (paid, declined, for the merchant: inactive), since its last change
// (its `dueAt`); a lock item, since its lease ended (a holder that died leaves one), once its
// payment passed it. Wix counts every item against the site's quota of CMS items (Core: 4 000,
// all collections), and the proof of a payment stays in its order's comment. Wix makes a new
// order for each new attempt to pay (measured): an order 90 days old is not paid again.
const KEEP_MS = 90 * 24 * 3600 * 1000;
// Anyone can place orders and leave them unpaid: what they leave is kept a week, then removed. A
// payment that ended with nothing paid, since it ended: its invoice expired, the SDK's status of
// the stored invoice saying nothing came in time ("expired: never paid, for good", SPEC.md §3: a
// transaction that comes later is late, it reaches the merchant's wallet and pays no order; one
// made in time is reported unconfirmed or paid, never expired), or it was refused before its
// invoice; and a refusal of an order, since its last time. A week leaves the merchant time to
// answer a customer from the status page; the sales stay in the merchant's sattle.me app.
const UNPAID_KEEP_MS = 7 * 24 * 3600 * 1000;
// A contact Wix deleted is kept (as a hash of its id) longer than a payment is checked: 90 days
// after its invoice's end, then 90 days to tell Wix and the merchant (payments.js, GIVE_UP_MS).
const ERASURE_KEEP_MS = 200 * 24 * 3600 * 1000;

/**
 * Checks a payment the run found due, unless a payment page checked it since the run started:
 * read again first, it is skipped then, and locked from its latest generation.
 */
async function checkIfDue(item, startedAt, ctx) {
  const fresh = await store.readPayment(item._id);
  if (!fresh || !fresh.active || fresh.dueAt > startedAt) return { skipped: true };
  return checkPayment(fresh._id, fresh.data.lockGen, ctx);
}

function pause(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The job's budget of write requests: what it wrote in the last minute (store.writeCount, at each
 * step), and `room(n, until)`, which waits (`sleep`) until `n` more fit in the minute, or says
 * false when that would be past `until`.
 */
function budget(sleep) {
  const spent = [];
  let counted = store.writeCount();
  return {
    spend() {
      const count = store.writeCount();
      if (count > counted) spent.push({ at: Date.now(), writes: count - counted });
      counted = count;
    },
    async room(n, until) {
      for (;;) {
        const now = Date.now();
        while (spent.length && spent[0].at <= now - MINUTE) spent.shift();
        const used = spent.reduce((sum, step) => sum + step.writes, 0);
        if (used + n <= WRITES_PER_MINUTE || !spent.length) return true;
        const wait = spent[0].at + MINUTE - now;
        if (now + wait > until) return false;
        await sleep(wait);
      }
    }
  };
}

/**
 * One run: removes what is no longer needed, then checks each payment due when it started, once,
 * the longest due first, until its life ends, its writes within WRITES_PER_MINUTE in any minute; a
 * check makes a payment due again later, and what the run did not reach (`left`), or found held
 * by its page's check (`busy`), waits for the next run. Its record is kept under its hour (UTC):
 * the status page shows the last 24. `lifeMs` and `marginMs`, its life and the time a check
 * needs, and `sleep`, how it waits, are the tests'.
 */
export async function runJob({ lifeMs = JOB_LIFE_MS, marginMs = MARGIN_MS, sleep = pause } = {}) {
  const startedAt = Date.now();
  const stopAt = startedAt + lifeMs;
  const hour = new Date(startedAt).toISOString().slice(11, 13);
  const run = {
    startedAt,
    endedAt: /** @type {number | null} */ (null),
    checks: 0,
    busy: 0,
    errors: 0,
    left: 0
  };
  const ctx = newContext(TIMEOUTS.job);
  const tried = new Set();
  const writes = budget(sleep);
  let complete = false;
  let stopped = false;
  const timeLeft = () => !stopped && Date.now() + marginMs < stopAt;
  try {
    await store.ensureCollection();
    await store.saveRun(hour, run);
    const before = startedAt - KEEP_MS;
    await Promise.all([
      store.forget("refusal", startedAt - UNPAID_KEEP_MS),
      store.forget("warning", before),
      store.forget("payment", before, false),
      store.forgetUnpaid(startedAt - UNPAID_KEEP_MS),
      store.forgetLocks(before),
      store.forget("erasure", startedAt - ERASURE_KEEP_MS)
    ]).catch((error) => logError("could not remove old records", error));
    writes.spend();
    while (timeLeft() && tried.size < MAX_QUERY) {
      // Those tried stay due when held or failed: read past them.
      const limit = Math.min(MAX_QUERY, tried.size + BATCH);
      const due = (await store.duePayments(startedAt, limit)).filter(
        (item) => !tried.has(item._id)
      );
      if (!due.length) {
        complete = true;
        break;
      }
      for (let start = 0; start < due.length && timeLeft(); start += AT_ONCE) {
        const some = due.slice(start, start + AT_ONCE);
        // Within the budget of writes, the run's last record (one write) included, or what is
        // left waits for the next run.
        if (!(await writes.room(some.length * WRITES_PER_CHECK + 1, stopAt - marginMs))) {
          stopped = true;
          break;
        }
        for (const item of some) tried.add(item._id);
        /** @type {{ error?: Error, busy?: boolean, checked?: boolean, skipped?: boolean }[]} */
        const results = await Promise.all(
          some.map((item) => checkIfDue(item, startedAt, ctx).catch((error) => ({ error })))
        );
        for (const result of results) {
          if (result.error) {
            run.errors += 1;
            logError("a background check failed", result.error);
          } else if (result.busy) {
            run.busy += 1;
          } else if (result.checked) {
            run.checks += 1;
          }
        }
        writes.spend();
      }
    }
    if (!complete) {
      const due = await store.duePayments(startedAt, MAX_QUERY);
      run.left = due.filter((item) => !tried.has(item._id)).length;
    }
  } catch (error) {
    run.errors += 1;
    logError("the background job stopped", error);
  } finally {
    run.endedAt = Date.now();
    await store
      .saveRun(hour, run)
      .catch((error) => logError("could not keep the job's run", error));
  }
}

export const sattlemeCheckoutJob = () => runJob();
