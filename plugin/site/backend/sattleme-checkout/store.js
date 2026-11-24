// What the plugin keeps, in its Wix Data collection (Admin-only: the backend alone reads and
// writes it), and the lock of each payment.
//
// Items: `kind` says what an item is, `active` and `dueAt` make the background checks' queue,
// `contactId` (of a payment, once its order gave it) finds a customer's payments, `unpaid` marks a
// settled payment that ended with nothing paid (removed sooner), `data` holds the rest.
//   "site"               kind "config": the site's URL for HTTP functions (status page, http.js).
//   "merchant"           kind "config": the merchant as connectAccount read it, and the language.
//   "connection"         kind "config": the last connection refused, its time and code.
//   "p<32 hex>"          kind "payment": the payment of one order (payments.js).
//   "lock-<payment>-<n>" kind "lock": a lock of a payment (below).
//   "run-<hour>"         kind "run": the background job's last run at that hour, UTC (jobs.js).
//   "refusal-<hash>"     kind "refusal": a payment refused, and why (status page).
//   "warning-<hash>"     kind "warning": a warning of the SDK, or the invoices made in Lightning
//                        only (status page).
//   "erasure-<hash>"     kind "erasure": a contact Wix deleted (the hash of its id), whose
//                        payments still being checked are erased once settled (privacy.js).

import { LOCK_MS } from "./constants.js";
import { sha256Hex } from "./refs.js";
import { data, ensureCollection, isDuplicate, writeCount } from "./wix.js";

export { ensureCollection, writeCount };

// The generations of a payment's lock one lock walks through at most (each one taken by a holder
// that died, or left released by a write that failed), and how often a lock held by another is
// read while it waits for it.
const LOCK_WALK = 20;
const LOCK_POLL_MS = 250;
// A holder writes its payment, or removes its lock without having written it, only with this much
// of its lease left: more than Wix Data's longest time limit (10 s, Business Elite; 5 s on other
// plans: "Data Features"), so that the request is done, applied or refused, while the lease runs:
// no one takes the lock over before.
export const WRITE_MARGIN_MS = 15000;

function now() {
  return Date.now();
}

/** The payment of the order of key `orderKey` (a Wix order id, or a transaction's): its _id. */
export function paymentIdOf(orderKey) {
  return `p${sha256Hex(orderKey).slice(0, 32)}`;
}

export function isPaymentId(id) {
  return typeof id === "string" && /^p[0-9a-f]{32}$/.test(id);
}

/** Payment `id` as Wix Data's primary instance holds it (consistentRead), or null. */
export function readPayment(id) {
  return data.get(id);
}

export function savePayment(item) {
  // Its customer's contact, where a query finds it (privacy.js).
  item.contactId = typeof item.data.contactId === "string" ? item.data.contactId : null;
  return data.save(item);
}

/**
 * The ids of the payments of contact `contactId`, all of them, 1 000 per query, from Wix Data's
 * primary instance: a payment settled seconds ago is erased now or never (privacy.js).
 */
export async function paymentIdsOfContact(contactId) {
  const ids = [];
  for (let skip = 0; ; skip += 1000) {
    const page = await data.query({
      kind: "payment",
      contactId,
      limit: 1000,
      skip,
      consistent: true
    });
    for (const item of page) ids.push(item._id);
    if (page.length < 1000) return ids;
  }
}

/**
 * Active payments due by `at`, the soonest first, from a mirror: the job reads each again from
 * the primary before it checks it, and one due since a few seconds waits for the next run.
 */
export function duePayments(at, limit) {
  return data.query({ kind: "payment", active: true, dueBefore: at, limit });
}

/** Active payments, the soonest due first (status page), as they are now. */
export function activePayments(limit) {
  return data.query({
    kind: "payment",
    active: true,
    dueBefore: Number.MAX_SAFE_INTEGER,
    limit,
    consistent: true
  });
}

/** The latest items of `kind` (runs, refusals, warnings, payments: status page), as they are now. */
export function latest(kind, limit) {
  return data.query({ kind, limit, consistent: true });
}

/**
 * Removes the items of `kind` older than `before` (by `dueAt`), 50 at a time: only the inactive
 * ones when `active` is false. Read from a mirror: an item older than `before` is there.
 */
export async function forget(kind, before, active) {
  const old = await data.query({ kind, active, dueBefore: before, limit: 50 });
  if (old.length) await data.bulkRemove(old.map((item) => item._id));
  return old.length;
}

/** Removes the settled payments that ended with nothing paid, last changed before `before`. */
export async function forgetUnpaid(before) {
  const old = await data.query({
    kind: "payment",
    active: false,
    unpaid: true,
    dueBefore: before,
    limit: 50
  });
  if (old.length) await data.bulkRemove(old.map((item) => item._id));
  return old.length;
}

/**
 * Removes the lock items whose lease ended before `before` (a holder that died, or whose write
 * failed, left them), by the lock's rule (below): once their payment is gone, or its `lockGen`
 * passed them (read from the primary).
 */
export async function forgetLocks(before) {
  const old = await data.query({ kind: "lock", dueBefore: before, limit: 50 });
  const ids = [];
  for (const item of old) {
    const named = /^lock-(p[0-9a-f]{32})-([0-9]+)$/.exec(item._id);
    if (!named) continue;
    const payment = await readPayment(named[1]);
    const lockGen = payment && payment.data ? payment.data.lockGen : null;
    if (!payment || (Number.isSafeInteger(lockGen) && lockGen > Number(named[2]))) {
      ids.push(item._id);
    }
  }
  if (ids.length) await data.bulkRemove(ids);
  return ids.length;
}

export async function readConfig(id) {
  const item = await data.get(id);
  return item && item.data ? item.data : null;
}

export function saveConfig(id, value) {
  return data.save({ _id: id, kind: "config", active: false, dueAt: now(), data: value });
}

function rememberedId(kind, key) {
  return `${kind}-${sha256Hex(key).slice(0, 24)}`;
}

/** What `remember` keeps of `key` of `kind`, or null. */
export async function recall(kind, key) {
  const item = await data.get(rememberedId(kind, key));
  return item && item.data ? item.data : null;
}

/**
 * Keeps one item per `key` of `kind` (a refusal, a warning, an erasure), the time of its last
 * occurrence; its id is a hash of the key, never the key.
 */
export async function remember(kind, key, value) {
  const id = rememberedId(kind, key);
  const before = await data.get(id);
  const count = before && before.data ? (before.data.count || 1) + 1 : 1;
  const first = before && before.data ? before.data.first : now();
  return data.save({
    _id: id,
    kind,
    active: false,
    dueAt: now(),
    data: Object.assign({}, value, { first, count })
  });
}

/** Keeps the background job's run, under its hour ("00"…"23", UTC): the last 24 runs. */
export function saveRun(hour, value) {
  return data.save({ _id: `run-${hour}`, kind: "run", active: false, dueAt: now(), data: value });
}

/*
 * The lock of a payment. Wix Data has no lock, but refuses to insert an item whose _id exists
 * (WDE0074: measured on a Wix site, one insert of eight at once wins). A lock is such an insert,
 * of a lease of LOCK_MS. Each lock is a new item, of the next generation: "lock-<payment>-<n>";
 * the payment keeps the generation to take next (`lockGen`), which each holder sets past its own
 * as it saves the payment. Whoever finds a generation taken reads it: held (its lease running), it
 * waits, reading it again (a read, never an insert: Wix counts each insert as a write request,
 * refused or not); gone, its holder is done: the payment is read again, from its new `lockGen`;
 * left released by a write that failed, or past its lease (its holder died), the next generation.
 * A lease is taken over that way, never by removing its item: a removal racing with an insert
 * could let two holders in.
 *
 * The rule that keeps two holders out: an item is removed only once the payment's `lockGen`
 * passed it (saved, read from Wix Data's primary), but by its own holder, while its lease runs.
 * A holder that took a generation its payment had passed (from a `lockGen` read before another
 * holder was done) holds nothing (holdsLatest): it removes its item, and reads the payment again.
 *
 * Wix counts items against the site's quota of CMS items, all collections together (Wix: 4 000 on
 * a Core plan; past it, no insert succeeds): a holder that is done removes the generations it
 * walked through and its own, so a payment keeps no lock item between its checks, one while it is
 * checked, and none once no check follows (dropLocks).
 */

function lockId(paymentId, gen) {
  return `lock-${paymentId}-${gen}`;
}

/** Whether lock item `taken` holds its payment: not released, its lease running. */
function holding(taken) {
  return !!taken && taken.active === true && taken.dueAt > now();
}

function pause(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Locks payment `paymentId`, from generation `fromGen` (its `lockGen`), waiting up to `waitMs` for
 * a holder: `{ held: { paymentId, id, gen, from, until } }`; `{ freed: true }` when a holder it
 * waited for is done (the payment moved on: read it again, and lock from its `lockGen`);
 * `{ busy: true }` when another holds it past `waitMs`.
 */
export async function lock(paymentId, fromGen, waitMs) {
  const end = now() + (waitMs || 0);
  const from = Number.isSafeInteger(fromGen) && fromGen >= 0 ? fromGen : 0;
  let gen = from;
  // Whether this generation was seen held: gone since, its holder is done.
  let seenHeld = false;
  for (let walked = 0; walked < LOCK_WALK;) {
    const id = lockId(paymentId, gen);
    const taken = await data.get(id);
    if (holding(taken)) {
      if (now() + LOCK_POLL_MS > end) return { busy: true };
      seenHeld = true;
      await pause(LOCK_POLL_MS);
      continue;
    }
    if (taken) {
      // Released by a holder whose write failed, or past its lease: the next generation.
      gen += 1;
      walked += 1;
      seenHeld = false;
      continue;
    }
    if (seenHeld) return { freed: true };
    const until = now() + LOCK_MS;
    try {
      await data.insert({ _id: id, kind: "lock", active: true, dueAt: until, data: { gen } });
      return { held: { paymentId, id, gen, from, until } };
    } catch (error) {
      if (!isDuplicate(error)) throw error;
      // Another taker's insert came first: its holder is waited for as any other.
      seenHeld = true;
    }
  }
  return { busy: true };
}

/**
 * Whether `held` is the payment's latest lock: of a generation no lower than the payment's
 * `lockGen`, which each holder sets past its own when it is done. One of a lower generation was
 * taken from a `lockGen` read before another holder was done: not a lock.
 */
export function holdsLatest(held, lockGen) {
  return !Number.isSafeInteger(lockGen) || held.gen >= lockGen;
}

/** Whether `held` still has `marginMs` of its lease: no side effect is started past it. */
export function leaseLeft(held, marginMs) {
  return now() + marginMs < held.until;
}

/**
 * Ends `held` once its payment was saved with `lockGen` past it: removes the generations it walked
 * through and its own, in one request, all below that `lockGen` (nothing reads them).
 */
export async function unlock(held) {
  const ids = [];
  for (let gen = Math.min(held.from, held.gen); gen <= held.gen; gen += 1) {
    ids.push(lockId(held.paymentId, gen));
  }
  await data.bulkRemove(ids);
}

/**
 * Ends `held` when its holder wrote nothing: removes its own item while its lease runs (no one
 * walked past it); past that, leaves it to the next holder, who walks past it.
 */
export async function leave(held) {
  if (leaseLeft(held, WRITE_MARGIN_MS)) await data.bulkRemove([held.id]);
}

/** Removes `held`, a lock of a generation its payment had passed (holdsLatest): nothing reads it. */
export async function dropLock(held) {
  await data.bulkRemove([held.id]);
}

/**
 * Ends `held` after a write of its payment failed (refused, or past Wix Data's time limit: done
 * or not): marks it released, so that the next lock walks past it, and removes nothing, since the
 * payment's `lockGen` may not have passed it.
 */
export async function abandon(held) {
  await data.save({
    _id: held.id,
    kind: "lock",
    active: false,
    dueAt: held.until,
    data: { gen: held.gen }
  });
}

/**
 * Removes every lock item of a payment no check will follow (settled, or refused before its
 * invoice), `held` (its last) included, once the payment was saved with `lockGen` past it. Wix's
 * bulkRemove passes over an id it does not have.
 */
export async function dropLocks(held) {
  const ids = [];
  for (let gen = 0; gen <= held.gen; gen += 1) ids.push(lockId(held.paymentId, gen));
  for (let start = 0; start < ids.length; start += 500) {
    await data.bulkRemove(ids.slice(start, start + 500));
  }
}
