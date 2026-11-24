# Changelog

Versions of sattle.me Checkout for Wix ([semantic versioning](https://semver.org)); tags are
`vX.Y.Z`.

## 1.0.0 - 2026-11-24

First version: a payment provider for Wix sites (Velo's Payment Provider service plugin), paid in
bitcoin, in Lightning or on-chain, to the merchant's sattle.me wallet, on the sattle.me SDK
`@sattleme/checkout` 1.0.0 (checkout-spec 1.0.0), bundled for a Wix site's backend (Node 18.17.1
when measured; the status page shows the one a site runs). Its sources ran on a Wix development
site on 23 November 2026, with real payments, merged into one file; what that test showed is fixed
here (the README, "What was measured on Wix", says what and what remains to measure): the task's
description within Wix's 500 characters, every text within Wix's limits, a task Wix refuses ending
as refused with its reason; X-Frame-Options: DENY, Wix replacing the pages' policy; the minutes'
label; notes after an erasure without what it removed; the status token's hint.

- **The connection** in the site's payment settings: the integration key stays in the Secrets
  Manager, the connection's field naming its secret (a key typed there is refused, never kept);
  the key checked with the merchant's registry; the time to pay an invoice, 1 to 60 minutes (15
  suggested).
- **Payments on the plugin's own page**, served by the site (an HTTP function, its address bound to
  the order's transaction by 128 random bits): no script; the QR code of the payment drawn on the
  server (uqr 0.1.3, bundled); the invoice and the address to copy, the amount in sats and in the
  order's currency, the time left, the rest of an underpayment, the confirmations of an on-chain
  payment; a meta refresh and a button to check again; Wix's page of the order's state once the
  payment is final, but for an underpayment that expired, whose page says what came of what was due,
  with the way back to the shop; a stylesheet from the site's own origin. The order's exact price
  from Wix's minor units, or refused; a reference per order drawn on the server, with 128 random
  bits, which Wix's transaction ids carry, numbered; one payable invoice per order, made under a
  lock in Wix Data (one holder at a time, waited for by reading, its records read from Wix Data's
  primary), Wix's repeated calls given the first call's answer.
- **Checks** on the payment page while the customer is on it (at most every 5 s per payment, a
  view within 5 s writing nothing), and in one scheduled job, hourly, for the rest (a customer who
  left, on-chain confirmations, the invoice's end, the cleanup), its writes paced to 60 a minute,
  given up after 90 days with a note to the merchant. Wix's events sent once each, from the
  server's checks alone, through an outbox (a write refused after Wix was told tells no one
  twice); the approval to the transaction that was paid, the customer kept on the page until Wix
  took it; a paid order read back from Wix.
- **The merchant told** of what needs them (an underpayment that expired, a payment of an order
  canceled meanwhile or whose total changed after its invoice, an invoice of another amount, a
  payment Wix did not record or whose approval it refused): a comment on the order, a task in the
  dashboard and a notification, each saying what came (Lightning, on-chain or both) of what the
  invoice asked; the records of orders that ended with nothing paid removed after a week. An
  on-chain payment short of the amount that the merchant accepted in the sattle.me app (its
  tolerance, or by hand what an order underpaid received) is approved as paid, its comment saying
  what was received of what was due. An `expired` status is final (SPEC.md section 3's one
  exception left to the merchant).
- **A status page** behind a token: the versions and the site's Node.js, the connection, the
  background checks, the payments under way and those that need the merchant (amount and rate,
  deposit address and transactions linked to mempool.space, last check and its error in plain
  words), the refusals and the warnings, its times in the site's time zone.
- **The blockchain** read from one explorer, through the SDK: mempool.space, or the merchant's own
  Bitcoin node when the sattle.me app names one (mempool.space as its fallback unless the merchant
  chose none).
- **Privacy**: the customer's browser contacts the site alone; when Wix deletes a contact, its
  payments lose the deposit address (and the payment URIs that hold it), the transactions and the
  contact's id (at once, or once final, before anything is written of them: the comments, tasks
  and notifications that follow leave them out and say so); a merged contact's payments follow
  the contact kept.
- **Texts** in English, French, German and Italian, following the site's language (the payment
  page, the order's, else the browser's), counts in the singular where the language takes it; the
  sattle.me logo on the plugin's pages.
- **Six files to install**: the whole plugin in one file, `backend/sattleme-plugin.js` (its
  modules, the SDK and the QR code encoder, merged), and the five files Wix requires at fixed
  names (the payment provider's two, `http-functions.js`, `events.js`, `jobs.config`), each only
  calling into it.
- **A reproducible build** of the files a site gets, with `SHA256SUMS` and `PROVENANCE.json`, the
  SDK pinned in `sdk/` as the tarball of a commit; a release archive, checked; a type check
  against Velo's types; tests at three levels on Node 18.17.1, 20, 22, 24 and 26, on the plugin's
  modules and on the release's one file; a release workflow that makes a draft GitHub release of
  a tag.
