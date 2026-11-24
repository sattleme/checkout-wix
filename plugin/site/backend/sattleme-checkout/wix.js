// The plugin's door to Wix: every Wix module it uses, behind plain functions, so that the rest of
// the plugin is tested with fakes of these alone.
//
// Velo modules (built into every site): wix-data, wix-data.v2, wix-auth, wix-secrets-backend.v2,
// wix-payment-provider-backend, wix-ecom-backend, wix-crm-backend, wix-crm.v2, wix-site-backend.
// Two packages of Wix's JavaScript SDK, installed from the editor's package manager (README,
// "Installation"): @wix/ecom and @wix/essentials, for the one thing Velo cannot do, a comment on
// an order.

import wixData from "wix-data";
import { collections } from "wix-data.v2";
import { elevate } from "wix-auth";
import { secrets } from "wix-secrets-backend.v2";
import wixPaymentProviderBackend from "wix-payment-provider-backend";
import { orders as veloOrders } from "wix-ecom-backend";
import { notifications } from "wix-crm-backend";
import { tasks } from "wix-crm.v2";
import wixSiteBackend from "wix-site-backend";
import { orders as sdkOrders } from "@wix/ecom";
import { auth } from "@wix/essentials";

import { COLLECTION } from "./constants.js";
import { clip } from "./i18n.js";
import { rememberSecret } from "./safety.js";

// The lengths Wix documents for what the plugin writes, in characters (counted here as UTF-16 code
// units: never fewer than Wix's count): a task's title (1 to 250) and description (1 to 500), its
// contact a GUID (wix-crm.v2 tasks, createTask); a comment on an order (MERCHANT_COMMENT: 1 to
// 5000); a notification's body, title and action's title (wix-crm-backend notify: 512 each). Wix
// refuses a longer one (measured: a task's description of 624 characters, INVALID_ARGUMENT): the
// plugin builds its texts to fit (payments.js), and each is cut here too, at a character boundary.
export const LIMITS = {
  taskTitle: 250,
  taskDescription: 500,
  comment: 5000,
  notice: 512
};
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The collection is Admin-only; the backend reads and writes it on its own authority. Wix Data is
// eventually consistent ("Wix Data and Eventual Consistency"): a write goes to its primary
// instance, then reaches the mirrors that reads go to, "typically" seconds later; a read with
// consistentRead goes to the primary. Every read a decision follows is one: a payment, its lock,
// the site's address, a contact's payments.
const DATA = { suppressAuth: true, suppressHooks: true };
const CONSISTENT = { suppressAuth: true, suppressHooks: true, consistentRead: true };

/**
 * A secret of the Secrets Manager, remembered as one (never logged), or null when the site has
 * none of that name (the Secrets Manager then throws). Its answer is read as `{ value }`, as Wix
 * documents it and as a Wix site gave it, or as a plain string.
 */
export async function readSecret(name) {
  let answer;
  try {
    answer = await elevate(secrets.getSecretValue)(name);
  } catch (error) {
    return null;
  }
  const value =
    typeof answer === "string"
      ? answer
      : answer && typeof answer.value === "string"
        ? answer.value
        : null;
  if (value === null || value.trim() === "") return null;
  // Masked as it is used, trimmed: a secret saved with a line break or a space around it.
  const secret = value.trim();
  rememberSecret(secret);
  return secret;
}

/** The plugin's collection, made with Admin-only permissions on first use (wix-data.v2). */
export async function ensureCollection() {
  try {
    await elevate(collections.getDataCollection)(COLLECTION);
  } catch (missing) {
    try {
      // Wix's types ask for its enums (Role, Type); its API takes their values, these strings.
      await elevate(collections.createDataCollection)(
        /** @type {*} */ ({
          _id: COLLECTION,
          displayName: "sattle.me Checkout",
          permissions: { read: "ADMIN", insert: "ADMIN", update: "ADMIN", remove: "ADMIN" },
          fields: [
            { key: "kind", displayName: "kind", type: "TEXT" },
            { key: "active", displayName: "active", type: "BOOLEAN" },
            { key: "dueAt", displayName: "dueAt", type: "NUMBER" },
            { key: "contactId", displayName: "contactId", type: "TEXT" },
            { key: "unpaid", displayName: "unpaid", type: "BOOLEAN" },
            { key: "data", displayName: "data", type: "OBJECT" }
          ]
        })
      );
    } catch (error) {
      // Made meanwhile by another call? Then this finds it; else it throws.
      await elevate(collections.getDataCollection)(COLLECTION);
    }
  }
}

/** Whether a wix-data error is the refusal of an insert whose _id exists (WDE0074). */
export function isDuplicate(error) {
  return !!error && (error.code === "WDE0074" || /WDE0074/.test(String(error.message)));
}

/**
 * A copy of an item, its dates kept as dates. Velo's wix-data changes the object it is given
 * (Wix's migration guide: @wix/data's insert() "no longer modifies the original object passed to
 * it"): a write made after a save, through a reference taken before it, was lost (measured: a
 * transaction's answer). Wix gets this copy. Written here: a site's runtime may lack globals Node
 * has (measured: crypto), structuredClone among them perhaps.
 */
export function copyOf(value) {
  if (value instanceof Date) return new Date(value.getTime());
  if (Array.isArray(value)) return value.map(copyOf);
  if (value && typeof value === "object") {
    const copy = {};
    for (const key of Object.keys(value)) copy[key] = copyOf(value[key]);
    return copy;
  }
  return value;
}

// Wix counts each call of insert, save or bulkRemove as a write request, refused or not ("Data
// Features"): the plugin's, in this process, counted (the job keeps to its budget a minute).
let writes = 0;

/** The write requests the plugin made in this process so far. */
export function writeCount() {
  return writes;
}

export const data = {
  /** Inserts `item`; rejects (isDuplicate) when an item of its _id exists. */
  insert(item) {
    writes += 1;
    return wixData.insert(COLLECTION, copyOf(item), DATA);
  },
  /** Inserts or replaces `item`. */
  save(item) {
    writes += 1;
    return wixData.save(COLLECTION, copyOf(item), DATA);
  },
  /** The item `id` as Wix Data's primary instance has it (consistentRead), or null. */
  async get(id) {
    return (await wixData.get(COLLECTION, id, CONSISTENT)) || null;
  },
  bulkRemove(ids) {
    writes += 1;
    return wixData.bulkRemove(COLLECTION, ids, DATA);
  },
  /**
   * Items of `kind`, at most `limit`: with `dueBefore`, those due by then (`active` ones only, when
   * `active` is given, `unpaid` ones only when `unpaid` is), the soonest first; with `contactId`,
   * those of that contact, by id (from `skip`); else the latest first. From the primary instance
   * with `consistent`, else from a mirror (seconds behind).
   * @param {{ kind: string, active?: boolean, unpaid?: boolean, dueBefore?: number,
   *   contactId?: string, limit: number, skip?: number, consistent?: boolean }} criteria
   */
  async query({ kind, active, unpaid, dueBefore, contactId, limit, skip, consistent }) {
    let query = wixData.query(COLLECTION).eq("kind", kind);
    if (active !== undefined) query = query.eq("active", active);
    if (unpaid !== undefined) query = query.eq("unpaid", unpaid);
    if (contactId !== undefined) {
      query = query.eq("contactId", contactId).ascending("_id");
    } else {
      query =
        dueBefore !== undefined
          ? query.le("dueAt", dueBefore).ascending("dueAt")
          : query.descending("dueAt");
    }
    if (skip) query = query.skip(skip);
    const result = await query.limit(limit).find(consistent ? CONSISTENT : DATA);
    return result.items;
  }
};

/**
 * Tells Wix a transaction's status (submitEvent): approved without a reason code, else the code
 * (5009 pending, 3035 expired). Wix answers the same to every event, duplicates included: the
 * plugin sends each one once (payments.js).
 */
export async function submitTransactionEvent(transaction) {
  await wixPaymentProviderBackend.submitEvent({ event: { transaction } });
}

/** The eCommerce order `orderId`: `{ order }`, or `{ error }` (none, or Wix could not tell). */
export async function getOrder(orderId) {
  try {
    const order = await elevate(veloOrders.getOrder)(orderId);
    return order ? { order } : { error: "no order" };
  } catch (error) {
    return { error: String((error && error.message) || error).slice(0, 200) };
  }
}

/** The messages of the order's comments (its activities of type MERCHANT_COMMENT). */
export function orderComments(order) {
  const activities = order && Array.isArray(order.activities) ? order.activities : [];
  const messages = [];
  for (const activity of activities) {
    // Velo's types give `type` as an enum of strings.
    const type = /** @type {string | undefined} */ (activity && activity.type);
    const comment = activity && activity.merchantComment;
    if (type === "MERCHANT_COMMENT" && comment && typeof comment.message === "string") {
      messages.push(comment.message);
    }
  }
  return messages;
}

/** A comment on the order's timeline (its activities, MERCHANT_COMMENT: LIMITS.comment at most). */
export async function addOrderComment(orderId, message) {
  const comment = { message: clip(message, LIMITS.comment) };
  await auth.elevate(sdkOrders.addActivities)(orderId, {
    orderActivities: [{ activityType: "MERCHANT_COMMENT", merchantComment: comment }]
  });
}

/**
 * A notification to the site's owner alone, in the dashboard's bell and the Wix app
 * (wix-crm-backend notify, channels "Dashboard" and "Mobile"). notify() resolves with nothing:
 * whether Wix shows it follows the owner's notification settings, which the plugin cannot see.
 */
export async function notifyOwner(title, body, link) {
  const options = { title: clip(title, LIMITS.notice), recipients: { role: "Owner" } };
  if (link) {
    Object.assign(options, {
      actionTitle: clip(link.title, LIMITS.notice),
      actionTarget: { url: link.url }
    });
  }
  await notifications.notify(clip(body, LIMITS.notice), ["Dashboard", "Mobile"], options);
}

/**
 * A task in the site's dashboard (Tasks & Reminders, on the customer's contact card; wix-crm.v2,
 * elevated as Wix requires), due now, of the order's customer when known: what the merchant must
 * do, kept until they mark it done. Wix shows its title alone (measured). Its id, or null. A
 * contact id that is not a GUID, which Wix would refuse, is left out: the task is made unlinked.
 */
export async function createTask(title, description, contactId) {
  // Wix's types ask for its enum (TaskStatus); its API takes its value, this string.
  const task = /** @type {*} */ ({
    title: clip(title, LIMITS.taskTitle),
    description: clip(description, LIMITS.taskDescription),
    dueDate: new Date(Date.now()),
    status: "ACTION_NEEDED"
  });
  if (typeof contactId === "string" && GUID.test(contactId)) task.contact = { _id: contactId };
  const created = await elevate(tasks.createTask)(task);
  return created && created._id ? created._id : null;
}

/**
 * The tasks of the site's dashboard made since `since` (ms), the newest first, 50 at most (Wix's
 * TasksQueryBuilder: by creation date; elevated, as Wix requires): their titles and descriptions.
 */
export async function tasksSince(since) {
  const found = await elevate(tasks.queryTasks)().ge("_createdDate", new Date(since)).find();
  return found.items.map((task) => ({
    title: typeof task.title === "string" ? task.title : "",
    description: typeof task.description === "string" ? task.description : ""
  }));
}

/** The site's time zone, as its dashboard's General Info gives it ("Europe/Zurich"), or null. */
export async function siteTimeZone() {
  try {
    const zone = await wixSiteBackend.generalInfo.getTimeZone();
    return typeof zone === "string" ? zone.slice(0, 100) : null;
  } catch (error) {
    return null;
  }
}

/** The site's language, as its dashboard's General Info gives it ("fr"), or null. */
export async function siteLanguage() {
  try {
    const language = await wixSiteBackend.generalInfo.getLanguage();
    return typeof language === "string" ? language : null;
  } catch (error) {
    return null;
  }
}
