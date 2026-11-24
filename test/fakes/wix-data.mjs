// wix-data, in memory, as Wix documents it and as measured on a Wix site:
// - insert() rejects an item whose _id exists (WDE0074; measured), save() inserts or replaces,
//   get() resolves null for no item, a missing collection rejects (WDE0025), bulkRemove() removes
//   the ids it has;
// - eventually consistent ("Wix Data and Eventual Consistency": "it always updates your data in
//   the primary database instance first, then propagates your changes to the mirror instances
//   ... there may be a short delay (typically a few seconds)"; a read "goes to the closest mirror
//   database instance" unless it sets consistentRead): writes go to state.collections, the
//   primary; get() and find() read the items as they were state.lagMs ago (state.history, each
//   item's versions), or, with consistentRead, the primary. An item a test put in
//   state.collections itself is there since ever, until something writes it;
// - each call of insert(), save() or bulkRemove() is one write request, refused or not, and each
//   get() or find() one read request (Wix's "Data Features": "count as 1 request towards the
//   write quota"): counted in state.writes (the time of each in state.writeTimes) and
//   state.reads; past state.writeQuota write requests in a minute, a write is refused with
//   WDE0014, "Requests per minute quota exceeded": "subsequent requests during the same minute
//   are not processed and return an error";
// - state.failures (state.mjs) refuses a call before it is applied, or fails it once applied
//   (WDE0028, "Operation time limit exceeded": Wix Data's time limit, 5 s on most plans, 10 s on
//   Business Elite; the write may be done).
// Items are stored as JSON, and each call yields to the event loop first, as a request would:
// concurrent calls interleave. insert() and save() change the object they are given, as Velo's
// wix-data does (Wix's migration guide: @wix/data's insert() "no longer modifies the original
// object passed to it"; measured on a Wix site: a write made through a reference taken before a
// save was lost): the object gets the stored item's fields, as new copies.

import { dataError, maybeFail, state } from "./state.mjs";

const MINUTE = 60000;

function collection(name) {
  const items = state.collections.get(name);
  if (!items) throw dataError("WDE0025", `The ${name} collection does not exist.`);
  return items;
}

async function tick() {
  const turns = state.jitter ? state.jitter() : 1;
  for (let i = 0; i < turns; i += 1) await new Promise((resolve) => setImmediate(resolve));
}
const copy = (value) => (value === null ? null : JSON.parse(JSON.stringify(value)));

/** The versions of item `id` the mirrors have had, oldest first: [{ at, item | null }]. */
function versions(name, id) {
  if (!state.history.has(name)) state.history.set(name, new Map());
  const byId = state.history.get(name);
  if (!byId.has(id)) {
    // Before its first write: as a test put it in the primary, there since ever, or none.
    const now = collection(name).get(id);
    byId.set(id, [{ at: -Infinity, item: now ? copy(now) : null }]);
  }
  return byId.get(id);
}

/** Item `id` as a read sees it: the primary's with consistentRead, else a mirror's. */
function seen(name, id, options) {
  const items = collection(name);
  const byId = state.history.get(name);
  if ((options && options.consistentRead) || !state.lagMs || !byId || !byId.has(id)) {
    return items.has(id) ? copy(items.get(id)) : null;
  }
  const at = Date.now() - state.lagMs;
  let found = null;
  for (const version of byId.get(id)) if (version.at <= at) found = version.item;
  return copy(found);
}

function stored(item, before) {
  const now = new Date(Date.now()).toISOString();
  return copy(
    Object.assign({}, item, { _createdDate: before ? before._createdDate : now, _updatedDate: now })
  );
}

/**
 * A write request of call `name`: counted, refused past the quota of its minute, or as the test
 * asked; the function that fails it once applied, or null.
 */
function writeRequest(name) {
  const at = Date.now();
  state.writes += 1;
  state.writeTimes.push(at);
  const minute = Math.floor(at / MINUTE);
  const inMinute = state.writeTimes.filter((t) => Math.floor(t / MINUTE) === minute).length;
  if (inMinute > state.writeQuota) {
    throw dataError("WDE0014", "Requests per minute quota exceeded.");
  }
  return maybeFail(name);
}

function query(name) {
  const filters = [];
  let order = null;
  let max = 50;
  let from = 0;
  const builder = {
    eq(field, value) {
      filters.push((item) => item[field] === value);
      return builder;
    },
    le(field, value) {
      filters.push((item) => item[field] <= value);
      return builder;
    },
    ascending(field) {
      order = [field, 1];
      return builder;
    },
    descending(field) {
      order = [field, -1];
      return builder;
    },
    limit(n) {
      max = n;
      return builder;
    },
    skip(n) {
      from = n;
      return builder;
    },
    async find(options) {
      await tick();
      state.reads += 1;
      maybeFail("wixData.find");
      const ids = new Set([
        ...collection(name).keys(),
        ...(state.history.get(name) || new Map()).keys()
      ]);
      let items = [...ids]
        .map((id) => seen(name, id, options))
        .filter((item) => item && filters.every((f) => f(item)));
      if (order) {
        const [field, sign] = order;
        items = items.sort((a, b) =>
          a[field] < b[field] ? -sign : a[field] > b[field] ? sign : 0
        );
      }
      return { items: items.slice(from, from + max).map(copy) };
    }
  };
  return builder;
}

export default {
  async insert(name, item) {
    await tick();
    const late = writeRequest("wixData.insert");
    const items = collection(name);
    if (typeof item._id !== "string" || item._id === "")
      throw dataError("WDE0002", "Item ID must be a string.");
    if (items.has(item._id)) throw dataError("WDE0074", "WD_ITEM_ALREADY_EXISTS");
    const list = versions(name, item._id);
    items.set(item._id, stored(item, null));
    list.push({ at: Date.now(), item: copy(items.get(item._id)) });
    Object.assign(item, copy(items.get(item._id)));
    if (late) late();
    return copy(items.get(item._id));
  },
  async save(name, item) {
    await tick();
    const late = writeRequest("wixData.save");
    const items = collection(name);
    const list = versions(name, item._id);
    items.set(item._id, stored(item, items.get(item._id)));
    list.push({ at: Date.now(), item: copy(items.get(item._id)) });
    Object.assign(item, copy(items.get(item._id)));
    if (late) late();
    return copy(items.get(item._id));
  },
  async get(name, id, options) {
    await tick();
    state.reads += 1;
    maybeFail("wixData.get");
    if (state.beforeGet) state.beforeGet(id);
    return seen(name, id, options);
  },
  async bulkRemove(name, ids) {
    await tick();
    const late = writeRequest("wixData.bulkRemove");
    const items = collection(name);
    let removed = 0;
    for (const id of ids) {
      if (!items.has(id)) continue;
      const list = versions(name, id);
      items.delete(id);
      list.push({ at: Date.now(), item: null });
      removed += 1;
    }
    if (late) late();
    return { removed, skipped: ids.length - removed };
  },
  query
};
