// A customer's data, as Wix's contacts erase it (backend/events.js: wixCrm_onContactDeleted,
// wixCrm_onContactMerged, of wix-crm-backend's events). Wix deletes a contact when the merchant
// does, or on the customer's request under a privacy law (`triggeredByAnonymizeRequest`).
//
// The plugin keeps no name, email or postal address: a payment keeps its customer's Wix contact
// id, once the order gave it, and, paid on-chain, the deposit address and the transactions, which
// lead to the customer's coins on the blockchain (payments.js, erasePayment). When Wix deletes a
// contact, its final payments lose them at once; those still being checked, once final (the
// address is what their checks ask about), before any comment, task or notification of them is
// written, which then says they were erased. The deletion is kept meanwhile, as a hash of the
// contact's id, for 200 days (jobs.js): longer than a payment is checked. A contact merged into
// another is not erased: its payments follow the other.

import { changePayment } from "./payments.js";
import { logError, logInfo } from "./safety.js";
import * as store from "./store.js";

// A payment another call holds is tried this many times.
const TRIES = 3;

async function changeEach(ids, change) {
  const counts = { changed: 0, erased: 0, busy: 0, failed: 0 };
  for (const id of ids) {
    /** @type {{ changed?: boolean, erased?: boolean, busy?: boolean, failed?: boolean }} */
    let result = { busy: true };
    for (let attempt = 0; attempt < TRIES && result.busy; attempt += 1) {
      try {
        result = await changePayment(id, change);
      } catch (error) {
        logError("could not change a payment of a deleted or merged contact", error);
        result = { failed: true };
      }
    }
    if (result.changed) counts.changed += 1;
    if (result.erased) counts.erased += 1;
    if (result.busy) counts.busy += 1;
    if (result.failed) counts.failed += 1;
  }
  return counts;
}

/** Wix deleted contact `event.metadata.entityId`: its payments are erased, now or once settled. */
export async function contactDeleted(event) {
  const metadata = (event && event.metadata) || {};
  const contactId = typeof metadata.entityId === "string" ? metadata.entityId : "";
  // Merged into another contact (contactsMerged): the customer's data lives on there.
  if (contactId === "" || metadata.originatedFrom === "merge") return null;
  const anonymize = metadata.triggeredByAnonymizeRequest === true;
  await store.ensureCollection();
  await store.remember("erasure", contactId, { at: Date.now(), anonymize });
  const ids = await store.paymentIdsOfContact(contactId);
  // Each settled one is erased as it is saved (changePayment); the others once settled.
  const counts = await changeEach(ids, () => false);
  logInfo(
    `a contact was deleted: ${counts.erased} of its ${ids.length} payment(s) erased, the others ` +
      `once settled${counts.busy + counts.failed ? ` (${counts.busy + counts.failed} not reached)` : ""}`
  );
  return Object.assign({ payments: ids.length }, counts);
}

/** Wix merged contacts `event.data.sourceContactIds` into `targetContactId`: their payments follow. */
export async function contactsMerged(event) {
  const merged = (event && event.data) || {};
  const target = typeof merged.targetContactId === "string" ? merged.targetContactId : "";
  const sources = Array.isArray(merged.sourceContactIds)
    ? merged.sourceContactIds.filter((id) => typeof id === "string" && id !== "" && id !== target)
    : [];
  if (target === "" || sources.length === 0) return null;
  await store.ensureCollection();
  let payments = 0;
  const counts = { changed: 0, erased: 0, busy: 0, failed: 0 };
  for (const source of sources) {
    const ids = await store.paymentIdsOfContact(source);
    payments += ids.length;
    const result = await changeEach(ids, (data) => {
      if (data.contactId !== source) return false;
      data.contactId = target;
      return true;
    });
    for (const key of Object.keys(counts)) counts[key] += result[key];
  }
  if (payments) {
    logInfo(`contacts were merged: ${counts.changed} payment(s) follow the contact kept`);
  }
  return Object.assign({ payments }, counts);
}
