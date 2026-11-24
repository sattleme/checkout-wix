// The tests' fakes of Wix's modules (test/fakes/), checked against what Wix documents and what was
// measured on a Wix site: the other tests rely on them behaving as Wix does.

import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import { clock, freshSite, state } from "../helpers.mjs";

const wixData = (await import("wix-data")).default;
const { orders } = await import("wix-ecom-backend");
const ecom = await import("@wix/ecom");
const { tasks } = await import("wix-crm.v2");
const { notifications } = await import("wix-crm-backend");

const C = "SattlemeCheckout";
// Wix's contact ids are GUIDs (a task's contact must be one).
const C1 = "0c0c0c0c-0000-4000-8000-0000000000c1";
const C2 = "0c0c0c0c-0000-4000-8000-0000000000c2";

beforeEach(() => freshSite());

test("Wix Data: reads see a mirror, seconds behind the primary, unless they ask for consistentRead", async () => {
  // Wix: "there may be a short delay (typically a few seconds) until all mirror instances are up
  // to date"; a test puts what it needs in the primary itself, there since ever.
  state.collections.get(C).set("given", { _id: "given", kind: "x", n: 0 });
  assert.equal((await wixData.get(C, "given")).n, 0);
  clock.set(1800000000);
  try {
    await wixData.insert(C, { _id: "i", kind: "x", n: 1 });
    await wixData.save(C, { _id: "given", kind: "x", n: 2 });
    assert.equal(await wixData.get(C, "i"), null);
    assert.equal((await wixData.get(C, "given")).n, 0);
    assert.deepEqual(
      (await wixData.query(C).eq("kind", "x").find()).items.map((item) => item._id),
      ["given"]
    );
    const primary = { consistentRead: true };
    assert.equal((await wixData.get(C, "i", primary)).n, 1);
    assert.equal((await wixData.get(C, "given", primary)).n, 2);
    assert.equal((await wixData.query(C).eq("kind", "x").find(primary)).items.length, 2);
    // Removed: still on a mirror for a few seconds.
    await wixData.bulkRemove(C, ["given"]);
    assert.equal((await wixData.get(C, "given")).n, 0);
    assert.equal(await wixData.get(C, "given", primary), null);
    clock.advance(state.lagMs);
    assert.equal((await wixData.get(C, "i")).n, 1);
    assert.equal(await wixData.get(C, "given"), null);
  } finally {
    clock.reset();
  }
});

test("Wix Data: each call of insert, save or bulkRemove is a write request, refused or not", async () => {
  await wixData.insert(C, { _id: "a", n: 1 });
  // An insert of an _id that exists is refused (WDE0074, measured), and counted all the same.
  await assert.rejects(wixData.insert(C, { _id: "a", n: 2 }), { code: "WDE0074" });
  await wixData.save(C, { _id: "a", n: 3 });
  await wixData.bulkRemove(C, ["a", "nothing"]);
  assert.equal(state.writes, 4);
  assert.equal(state.writeTimes.length, 4);
  await wixData.get(C, "a");
  await wixData.query(C).eq("kind", "x").find();
  assert.deepEqual([state.writes, state.reads], [4, 2]);
});

test("Wix Data: past its write requests a minute, the requests of that minute are refused (WDE0014)", async () => {
  state.writeQuota = 3;
  clock.set(1800000000);
  try {
    for (let i = 0; i < 3; i += 1) await wixData.save(C, { _id: `w${i}` });
    await assert.rejects(wixData.save(C, { _id: "w3" }), { code: "WDE0014" });
    await assert.rejects(wixData.insert(C, { _id: "w4" }), { code: "WDE0014" });
    // Not processed: nothing written.
    assert.equal(state.collections.get(C).has("w3"), false);
    // The next minute takes requests again.
    clock.advance(60000);
    await wixData.save(C, { _id: "w5" });
    assert.ok(state.collections.get(C).has("w5"));
  } finally {
    clock.reset();
  }
});

test("Wix Data: a request refused before it is applied, or failed once applied (WDE0028)", async () => {
  state.failures.set("wixData.save", { skip: 1, times: 1, code: "WDE0014" });
  await wixData.save(C, { _id: "s1" });
  await assert.rejects(wixData.save(C, { _id: "s2" }), { code: "WDE0014" });
  assert.equal(state.collections.get(C).has("s2"), false);
  await wixData.save(C, { _id: "s3" });
  // Past Wix Data's time limit: the caller gets an error, the write is done.
  state.failures.set("wixData.save", { times: 1, applied: true });
  await assert.rejects(wixData.save(C, { _id: "s4" }), { code: "WDE0028" });
  assert.ok(state.collections.get(C).has("s4"));
});

test("an order's comments are its activities, as Wix's getOrder gives them; tasks are queried", async () => {
  state.orders.set("o1", { _id: "o1", number: "1" });
  await ecom.orders.addActivities("o1", {
    orderActivities: [{ activityType: "MERCHANT_COMMENT", merchantComment: { message: "hi" } }]
  });
  const order = await orders.getOrder("o1");
  assert.deepEqual(
    order.activities.map((a) => [a.type, a.merchantComment.message]),
    [["MERCHANT_COMMENT", "hi"]]
  );
  clock.set(1800000000);
  try {
    await tasks.createTask({ title: "old", contact: { _id: C1 } });
    clock.advance(60000);
    await tasks.createTask({ title: "new", contact: { _id: C1 } });
    await tasks.createTask({ title: "other", contact: { _id: C2 } });
    const since = new Date(Date.now() - 1000);
    const found = await tasks.queryTasks().ge("_createdDate", since).eq("contact.id", C1).find();
    assert.deepEqual(
      found.items.map((t) => t.title),
      ["new"]
    );
  } finally {
    clock.reset();
  }
});

test("the fakes refuse what Wix documents it refuses: lengths, a contact that is not a GUID", async () => {
  state.orders.set("o1", { _id: "o1", number: "1" });
  const invalid = { code: "INVALID_ARGUMENT" };
  // Measured on a Wix site: a task's description of 624 characters.
  await assert.rejects(tasks.createTask({ title: "t", description: "x".repeat(624) }), {
    code: "INVALID_ARGUMENT",
    message: 'INVALID_ARGUMENT: "task.description" has size 624, expected 500 or less and 1 or more'
  });
  await tasks.createTask({ title: "t".repeat(250), description: "x".repeat(500) });
  await assert.rejects(tasks.createTask({ title: "t".repeat(251) }), invalid);
  await assert.rejects(tasks.createTask({ title: "t", contact: { _id: "c1" } }), invalid);
  const comment = (message) =>
    ecom.orders.addActivities("o1", {
      orderActivities: [{ activityType: "MERCHANT_COMMENT", merchantComment: { message } }]
    });
  await comment("m".repeat(5000));
  await assert.rejects(comment("m".repeat(5001)), invalid);
  await notifications.notify("b".repeat(512), ["Dashboard"], { title: "t".repeat(512) });
  await assert.rejects(notifications.notify("b".repeat(513), ["Dashboard"], {}), invalid);
  await assert.rejects(
    notifications.notify("b", ["Dashboard"], { actionTitle: "a".repeat(513) }),
    invalid
  );
});
