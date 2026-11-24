// The plugin's records and the lock of a payment (store.js), on the fake of Wix Data, which, as
// measured on a Wix site, refuses an insert whose _id exists.

import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import { clock, freshSite, items, site, state } from "../helpers.mjs";

const store = await site("sattleme-checkout/store.js");
const wix = await site("sattleme-checkout/wix.js");

beforeEach(() => freshSite());

const PAYMENT = `p${"1".repeat(32)}`;

/** Lock `n` takers of PAYMENT at once, from generation `gen`: what each got. */
function takers(n, gen, waitMs = 0) {
  return Promise.all(Array.from({ length: n }, () => store.lock(PAYMENT, gen, waitMs)));
}

const lockItems = () =>
  items("lock")
    .map((l) => [l.data.gen, l.active])
    .sort((a, b) => a[0] - b[0]);

test("of 8 locks asked at once, one is held; the others are busy", async () => {
  const taken = await takers(8, 0);
  const held = taken.filter((t) => t.held);
  assert.equal(held.length, 1);
  assert.equal(held[0].held.gen, 0);
  assert.equal(taken.filter((t) => t.busy).length, 7);
});

test("a holder done removes its lock: the next lock is the generation the payment kept, one insert", async () => {
  const { held } = await store.lock(PAYMENT, 0, 0);
  assert.equal((await store.lock(PAYMENT, 0, 0)).busy, true);
  // Its payment saved with lockGen 1, the holder removes its item.
  await store.unlock(held);
  assert.deepEqual(lockItems(), []);
  const writes = state.writes;
  const next = await store.lock(PAYMENT, 1, 0);
  assert.equal(next.held.gen, 1);
  assert.equal(state.writes - writes, 1);
});

test("a lock whose holder died is taken over once its lease ends, by one taker", async () => {
  await store.lock(PAYMENT, 0, 0);
  assert.equal((await store.lock(PAYMENT, 0, 0)).busy, true);
  clock.advance(61000);
  try {
    const taken = await takers(6, 0);
    const held = taken.filter((t) => t.held);
    assert.equal(held.length, 1);
    assert.deepEqual([held[0].held.gen, held[0].held.from], [1, 0]);
    // Done (its payment saved with lockGen 2): the dead holder's item and its own, removed.
    await store.unlock(held[0].held);
    assert.deepEqual(lockItems(), []);
  } finally {
    clock.advance(-61000);
  }
});

test("a lock held by another is waited for by reading it, never by inserting again", async () => {
  const { held } = await store.lock(PAYMENT, 0, 0);
  const inserts = state.writes;
  setTimeout(() => store.unlock(held), 300);
  // Its holder done meanwhile: freed, the payment to read again (its lockGen moved on).
  assert.deepEqual(await store.lock(PAYMENT, 0, 2000), { freed: true });
  // One write: the holder's removal; the wait was reads.
  assert.equal(state.writes - inserts, 1);
  assert.ok(state.reads >= 2);
  // Held past the wait: busy, after the wait, with no insert.
  await store.lock(PAYMENT, 1, 0);
  const before = state.writes;
  const start = Date.now();
  assert.deepEqual(await store.lock(PAYMENT, 1, 600), { busy: true });
  assert.ok(Date.now() - start >= 500);
  assert.equal(state.writes, before);
});

test("a holder that wrote nothing removes its own lock alone; one past its lease, nothing", async () => {
  const { held } = await store.lock(PAYMENT, 0, 0);
  await store.leave(held);
  assert.deepEqual(lockItems(), []);
  const again = (await store.lock(PAYMENT, 0, 0)).held;
  assert.equal(again.gen, 0);
  // Its lease almost over: another may be walking past it; left to the next holder.
  clock.advance(50000);
  try {
    await store.leave(again);
  } finally {
    clock.advance(-50000);
  }
  assert.deepEqual(lockItems(), [[0, true]]);
});

test("a lock item is removed only once its payment's lockGen passed it: never two holders", async () => {
  // The audit's case, by the lock's rule: a holder whose write failed leaves its generation
  // released (5); the next one walks past it, holds 6, writes nothing, and removes 6 alone. Had it
  // removed 5 too (the generation before its own, its payment's lockGen still 5), a lock from 5
  // would hold 5 while one walked past 5 to 6: two holders.
  const failed = (await store.lock(PAYMENT, 5, 0)).held;
  await store.abandon(failed);
  assert.deepEqual(lockItems(), [[5, false]]);
  const walker = (await store.lock(PAYMENT, 5, 0)).held;
  assert.deepEqual([walker.gen, walker.from], [6, 5]);
  await store.leave(walker);
  assert.deepEqual(lockItems(), [[5, false]]);
  const taken = await takers(6, 5);
  assert.equal(taken.filter((t) => t.held).length, 1);
  assert.equal(taken.find((t) => t.held).held.gen, 6);
  // The next holder done (its payment saved with lockGen 7): 5 and 6 removed.
  await store.unlock(taken.find((t) => t.held).held);
  assert.deepEqual(lockItems(), []);
});

test("a lock of a generation its payment passed holds nothing; a settled payment's locks are all removed", async () => {
  const stale = (await store.lock(PAYMENT, 2, 0)).held;
  assert.equal(store.holdsLatest(stale, 3), false);
  assert.equal(store.holdsLatest(stale, 2), true);
  await store.dropLock(stale);
  assert.deepEqual(lockItems(), []);
  const failed = (await store.lock(PAYMENT, 0, 0)).held;
  await store.abandon(failed);
  const last = (await store.lock(PAYMENT, 0, 0)).held;
  assert.equal(last.gen, 1);
  await store.dropLocks(last);
  assert.deepEqual(lockItems(), []);
});

test("refusals are kept once per order and reason, counted, then forgotten", async () => {
  await store.remember("refusal", "order-1:currency", { at: 1, reason: "currency" });
  await store.remember("refusal", "order-1:currency", { at: 2, reason: "currency" });
  await store.remember("refusal", "order-2:amount", { at: 3, reason: "amount" });
  const kept = items("refusal");
  assert.equal(kept.length, 2);
  assert.equal(kept.find((i) => i.data.reason === "currency").data.count, 2);
  // Forgotten from a query of Wix Data's mirrors, which have them a few seconds later.
  clock.advance(5000);
  try {
    assert.equal(await store.forget("refusal", Date.now()), 2);
  } finally {
    clock.reset();
  }
  assert.equal(items("refusal").length, 0);
});

test("the collection is made Admin-only, with the fields the plugin queries", async () => {
  freshSite({ collection: false });
  await store.ensureCollection();
  const [made] = state.createdCollections;
  assert.equal(made._id, "SattlemeCheckout");
  assert.deepEqual(made.permissions, {
    read: "ADMIN",
    insert: "ADMIN",
    update: "ADMIN",
    remove: "ADMIN"
  });
  assert.deepEqual(
    made.fields.map((f) => f.key),
    ["kind", "active", "dueAt", "contactId", "unpaid", "data"]
  );
});

test("Wix Data gets a copy of what the plugin saves: its objects stay its own, dates as dates", async () => {
  const when = new Date(Date.UTC(2026, 9, 15, 12, 0, 0));
  const item = {
    _id: PAYMENT,
    _createdDate: when,
    kind: "payment",
    active: true,
    dueAt: 1,
    data: { transactions: [{ sent: "none", answer: null }], tags: ["a", { b: null }] }
  };
  const tx = item.data.transactions[0];
  await wix.data.save(item);
  // The fake changes the object it is given, as Velo's wix-data does: not the plugin's.
  assert.equal(item.data.transactions[0], tx);
  tx.answer = { redirectUrl: "https://pay.example/x" };
  await wix.data.save(item);
  assert.deepEqual(items("payment")[0].data.transactions[0].answer, tx.answer);
  // A copy all the way down; dates stay dates.
  const copy = wix.copyOf(item);
  assert.deepEqual(copy, item);
  assert.notEqual(copy.data, item.data);
  assert.notEqual(copy.data.tags[1], item.data.tags[1]);
  assert.ok(copy._createdDate instanceof Date);
  assert.equal(copy._createdDate.getTime(), when.getTime());
});
