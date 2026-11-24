# sattle.me Checkout for Wix

A payment method for Wix sites (Wix Stores and Wix's other business solutions that take payments
through Wix's checkout): **Bitcoin, in Lightning or on-chain, paid straight to the merchant's
[sattle.me](https://sattle.me) wallet**, on a payment page the site serves itself. sattle.me runs no
server: the plugin runs in the merchant's own site (Velo site code), which holds the integration's
secret key and calls the sattle.me SDK,
[`@sattleme/checkout`](https://github.com/sattleme/checkout-node) 1.0.0, pinned in `sdk/`. The
protocol is specified in [sattleme/checkout-spec](https://github.com/sattleme/checkout-spec)
(`SPEC.md`, version 1.0.0), and the plugin's conformance comes from the SDK's (`PORTING.md`,
"Packages that depend on an SDK"). The key can make invoices that pay the merchant, never spend the
funds.

**Status: version 1.0.0, on `@sattleme/checkout` 1.0.0.** The automated tests run the plugin
against fakes of Wix's modules, and with the SDK's real bundle, on Node 18.17.1 (the one a Wix
site's backend runs: measured) and on Node 20 to 26. **The plugin 1.0.0 ran on a real Wix site on
23 November 2026** (a development site, classic editor with Velo, Node v18.17.1), with real
payments, first from the same sources merged into one file by hand, then from this release's six
files, with its plugin's file under an earlier name; what each showed is fixed in this version,
the last fixes still to be confirmed on a real site ([What was measured on
Wix](#what-was-measured-on-wix)). What Wix itself does was first measured on a Wix development
site from 14 to 16 October 2026, with an earlier build of this plugin (`9c92b51`).

- [How it works](#how-it-works)
- [Requirements](#requirements)
- [Installation](#installation)
- [Configuration](#configuration)
- [Payments and orders](#payments-and-orders)
- [Background checks](#background-checks)
- [Security](#security)
- [Privacy](#privacy)
- [Known limits](#known-limits)
- [Troubleshooting](#troubleshooting)
- [Architecture](#architecture)
- [Versions and dependencies](#versions-and-dependencies)
- [What was measured on Wix](#what-was-measured-on-wix)
- [Development](#development)
- [Releases](#releases)
- [License](#license)

## How it works

1. At checkout, the customer chooses **"Bitcoin (Lightning / on-chain)"**. Wix calls the plugin
   on the site's server with the order's amount and currency; the plugin asks the SDK for the
   order's invoice, and Wix sends the customer to the plugin's **payment page**, on the site's own
   address: `https://<your site>/_functions/sattlemeCheckoutPay`, an HTTP function, with the
   payment and a key of 128 random bits.
2. The page, made on the site's server, runs no script: the amount in sats and in the order's
   currency, one QR code for Lightning and on-chain (on-chain from 1 000 sats), a link that opens
   the customer's wallet, the Lightning invoice and the deposit address to copy, and the time left
   (the merchant's time to pay, 15 minutes unless set otherwise). An on-chain payment short of the
   amount shows its rest; an on-chain payment received shows its confirmations.
3. The page loads itself again every 10 seconds (a meta refresh; every 30 seconds while an
   on-chain payment is being confirmed), and has a button to check again: each view checks the
   payment on the site's server (`getStatus`, at most every 5 s per payment). Once the payment is
   final, the page sends the customer to Wix's page of the order's state: Wix's thank-you page
   when paid (once Wix took the approval: until then, the page says the shop is recording the
   order, and each view sends the approval again), Wix's pending page when it needs the merchant,
   Wix's error page when the invoice expired unpaid. An on-chain underpayment whose invoice expired
   keeps the customer on the page, which then says what came of what was due, that the order is
   not paid and that the shop settles it, with a link back to the shop (Wix's pending page): no
   way to pay again, as no new invoice may follow it. Viewing the page proves nothing: only the
   server's check marks an order paid.
4. The same checks tell Wix: the order is approved on a `paid` status, once
   ([Payments and orders](#payments-and-orders)). A customer who leaves the page (or pays from
   their wallet after closing it) is not needed: the site's scheduled job, hourly, checks what
   remains ([Background checks](#background-checks)).

The merchant's sattle.me app has a web app, which shows an invoice's page (a checkout link,
`SPEC.md` §30). The plugin does not use it: its own page needs nothing but the site, keeps the
customer on the shop's address, and has their browser contact no one else ([Privacy](#privacy)).

## Requirements

- A Wix site on a plan that **accepts online payments** (Wix's Core plan, "Essentiel" in French,
  and above; a free site cannot take payments), with **Velo** (Dev Mode) turned on. Not a Wix
  Harmony site: it runs no site code. Not tried on a site of Studio Two, the editor Wix is rolling
  out (November 2026), whose code model differs.
- Wix runs the site's backend on a Node.js of its choice, which it does not document: **Node
  18.17.1** when measured (October 2026, and 23 November 2026), a release line Node.js stopped
  supporting on 30 April 2025 ([Versions and dependencies](#versions-and-dependencies)). The
  plugin is tested on it, and on Node 20, 22, 24 and 26; its status page shows the version a site
  runs.
- A **sattle.me** account with its app, and an **integration** made in it: the app's
  **Integrations** page gives its secret key, `sattleme_ck_…`. **One integration per site**: its
  key goes into this site only, and another site, or a copy of this one, gets its own
  (`SPEC.md` §8, "One key, one shop").
- The site's currency must be one sattle.me prices in ([Known limits](#known-limits)).
- **One of the site's scheduled jobs**: the plugin's, hourly. Wix allows a site 20 on most plans
  (30 on its Elite plans): the site keeps the others ([Background checks](#background-checks)).
- Outbound HTTPS and WebSocket connections from Wix's servers, which Wix allows site code
  (measured): to the merchant's Nostr relays, its Lightning address (breez.tips), the rate sources,
  mempool.space or the merchant's own Bitcoin node, and BlockCypher ([Privacy](#privacy), "What the
  site's server sends"). A Bitcoin node on the merchant's own network cannot be reached from Wix
  ([Known limits](#known-limits)).

## Installation

The files to put into the site are those of a release, `checkout-wix-<version>.zip` (its folder
`checkout-wix-<version>/`): a GitHub release of this repository, which the merchant's sattle.me app
offers to download. Or those of `dist/plugin-site/` after `npm run build`. Six files, all in
`backend/`, as listed in its `SHA256SUMS`:

| File (`backend/`)                                                              | What it is                                                                                   |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `sattleme-plugin.js`                                                           | The whole plugin, in one file (about 645 KB): its modules, the SDK and the QR code encoder   |
| `service-plugins/payment-provider/sattlemeCheckout/sattlemeCheckout.js`        | The payment provider's functions, which Wix calls: each calls into `sattleme-plugin.js`      |
| `service-plugins/payment-provider/sattlemeCheckout/sattlemeCheckout-config.js` | The payment provider's configuration (`getConfig`): its title and the connection's fields    |
| `http-functions.js`                                                            | The payment page, its stylesheet and the status page: four functions calling into the plugin |
| `events.js`                                                                    | A contact deleted or merged: two functions calling into the plugin                           |
| `jobs.config`                                                                  | The hourly job: a function of `sattleme-plugin.js`                                           |

Wix finds the last five only at these names and places (its documentation: the files a Payment
service plugin makes, `<name>.js` and `<name>-config.js`; `http-functions.js`; `events.js`;
`jobs.config`, all in the backend): each holds the least Wix needs. The plugin's own file stays
apart from them: a site's own `http-functions.js` or `events.js` keeps its code beside four or two
lines of the plugin's, and Wix documents a service plugin's folder importing other files, not
other files importing from it. In Wix Studio, the Wix IDE takes them by drag and drop into
`src/backend/`; in the Wix Editor, each file is created in the code panel with the same name, and
its content pasted.

> **Before each paste, check which file is open** (its tab's name, and where it is in the Code
> sidebar): Wix's panel shows the files side by side, and a paste once went into the wrong one
> (measured). **Before publishing, check each file's SHA-256** against `SHA256SUMS`: copy the
> file's text from the code panel into a file on your computer, then `sha256sum <file>` (on a
> Mac, `shasum -a 256 <file>`); do it again after reloading the editor, which once typed stray
> keystrokes at the top of three files (measured). Paste again any file whose SHA-256 differs.

1. **The key, in the Secrets Manager.** In the site's dashboard: **Developer Tools → Secrets
   Manager → Store Secret**:
   - name `sattleme-checkout-key`, value: the integration's key (`sattleme_ck_…`), from the
     sattle.me app (**Integrations**);
   - name `sattleme-checkout-status-token`, value: a random value of 32 characters or more (from a
     password manager): the password of the plugin's status page.

   The Secrets Manager keeps them encrypted and shows them masked; only the site's backend code
   reads them.

2. **Two packages of Wix's JavaScript SDK.** In the Code sidebar's **Packages & Apps**, install
   the npm packages `@wix/ecom` and `@wix/essentials` (Wix's own, MIT). The plugin uses them for
   one thing Velo cannot do: a comment on an order.
3. **The plugin.** In the Code sidebar, **Public & Backend → Backend**: a new file
   `sattleme-plugin.js`, with the content of `backend/sattleme-plugin.js` (open on that file
   only: not the payment provider's).
4. **The payment provider.** **Public & Backend → Service Plugins → + → Payment**, named
   `sattlemeCheckout`, then **Add & Edit Code**. Wix makes `payment-provider/sattlemeCheckout/`
   with `sattlemeCheckout.js` and `sattlemeCheckout-config.js`: replace their content with the
   files of the same name in `backend/service-plugins/payment-provider/sattlemeCheckout/`, each
   into the file of its own name (`sattlemeCheckout.js` holds a dozen lines, the plugin's file
   thousands).
5. **The HTTP functions, the events and the job**, in **Backend**: `http-functions.js`,
   `events.js` and `jobs.config`, the plugin's files. If the site has one of them already, add the
   plugin's lines to it instead: to `http-functions.js`, its import and its four functions
   (`get_sattlemeCheckoutPay`, `get_sattlemeCheckoutStyle`, `get_sattlemeCheckoutStatus`,
   `post_sattlemeCheckoutStatus`); to `events.js`, its import and its two functions
   (`wixCrm_onContactDeleted`, `wixCrm_onContactMerged`: [Privacy](#privacy), "Removing personal
   data"); to `jobs.config`, its job (one, hourly, at minute 17) in the list `jobs`.
6. **Check each file's SHA-256** against `SHA256SUMS` (above), then **publish** the site, once:
   Wix's **Publish** button gives no confirmation, and each click makes one publication
   (measured: the site's history, in the editor's Site menu, lists one per click).
7. **The status page.** Open `https://<your site>/_functions/sattlemeCheckoutStatus` and enter the
   status token (a browser does not send one shorter than 32 characters, and may say nothing:
   measured; the form says so under its field). It shows the connection to the business, and
   keeps the site's address, where the payment pages are: open it once after publishing, before
   connecting (until then, a connection and every payment are refused: `SITE_ADDRESS_UNKNOWN`),
   and again if the site's domain changes.
8. **Connect** ([Configuration](#configuration)).
9. **Test** with a real payment, on a test site first: [docs/manual-tests.md](docs/manual-tests.md).

To update the plugin, replace its files with the new release's (the same names), and publish. A
site with the files of an earlier build (a folder `backend/sattleme-checkout/` of 16 files, or a
file `backend/sattleme-checkout.js`): delete them, then add the six files. To remove it,
disconnect it in **Accept Payments**, then delete its files. The `SattlemeCheckout`
collection keeps the records of the payments of the last 90 days, their references and proofs of
payment (each proof is in its order's comment too), and of the last week for those that ended
with nothing paid: delete it once they are no longer needed.

## Configuration

In the dashboard: **Settings → Accept Payments → See More Payment Options → sattle.me Checkout →
Connect**. Two fields:

1. **"Type sattleme-checkout-key"**: type `sattleme-checkout-key`, the name of the secret that holds
   the key, never the key itself: a key typed there is refused (`KEY_TYPED`), never kept, as is
   any other name (`SECRET_NAME`). Wix keeps what a connection returns (the secret's name and the
   minutes) and gives it back with every payment; Wix does not document how it stores it: the key
   never goes there.
2. **"Minutes to pay an invoice"**: how long the customer has to pay: enter a whole number from 1
   to 60 (15 suggested). Wix keeps **Connect** disabled while a field is empty (measured).
   Anything else is refused (`MINUTES_TO_PAY`). It applies to the invoices made after the
   connection is saved.

The plugin then reads the key and checks it with the merchant's registry (`merchant()`): a removed
integration (`INTEGRATION_REMOVED`) or a key that is not one (`INVALID_KEY`) is refused, as is a
site currency the plugin cannot price (`CURRENCY_NOT_SUPPORTED`), or a site whose address the
status page has not kept yet (`SITE_ADDRESS_UNKNOWN`: open it once). Wix shows the connected
account's name masked (measured): the status page shows the business's name, its minimum and
maximum in sats, the size of its lot of on-chain addresses (leased or not), and the time to pay.
If connecting fails, Wix shows its own message, not the plugin's (measured on 23 November 2026):
"Cannot connect. Check your credentials…" for a refused key, "A technical problem occurred" for a
refused number of minutes or an unknown site address. The status page and the site's logs give
the reason. Fix it and connect again until it succeeds: after a failed connection, Wix refused this
payment method without calling the plugin until a connection succeeded (measured; see
[Troubleshooting](#troubleshooting)). The first connection after publishing may be slow enough
for Wix to report a technical problem while the plugin connected (measured): connect again. To
change a field later: **Manage**, change it, **Save** (Wix shows **Save** only once a field
changed: to save the same values again, add a space at the end of the first field, which the
plugin ignores).

- **The key**, to replace it: update the secret's value in the Secrets Manager, then remove the
  old integration in the app (its key stops working). Change it only while no Bitcoin payment is
  pending: a payment is checked with the key read at the time of the check, and an on-chain
  payment made under another integration's key would be judged without the records of its
  invoice.
- **No test mode**: sattle.me has no test network. Payments are real bitcoin payments, to the
  merchant's wallet: test with small amounts, on a test site.
- **What Wix shows**: the payment method's title, "Bitcoin (Lightning / on-chain)", reads the same
  in every language; the provider's name in the payment settings is "sattle.me Checkout". The
  plugin's own texts (connection, refusals, comments, tasks, notifications, status page) follow
  the site's language ([Known limits](#known-limits)).

## Payments and orders

Wix knows a payment by the events of its transaction (`submitEvent`). The plugin sends each one at
most once, never two contradictory ones (pending once, then one of approved or declined), from the
server's checks alone (`getStatus`).

**Told once, through an outbox.** A check that is about to tell Wix or the merchant something
saves the payment first, with what it will send marked as being sent, then sends it, then saves
it as sent. When that last save fails (Wix Data refuses writes past the site's quota of a minute,
WDE0014, or answers past its time limit, WDE0028, its write done or not), the next check finds
what was being sent, and tells no one twice: an event counts as sent (an approval is then read
back from the order, below), a comment is looked for among the order's comments and a task among
the dashboard's tasks (by the payment's reference), each made only if it is not there; a
notification counts as sent (Wix lists none to look for). A check that dies between that first
save and a notification may thus leave the merchant without that notification; never without the
task.

| The SDK (`SPEC.md` §3, §31)                               | Wix event                                   | The Wix order                          | The merchant                                              |
| --------------------------------------------------------- | ------------------------------------------- | -------------------------------------- | --------------------------------------------------------- |
| `open`, nothing received (the customer has the page)      | pending (5009), from the page's first check | pending, not listed yet                | —                                                         |
| `open`, an on-chain underpayment (its rest is payable)    | pending (5009)                              | pending, not listed yet                | waits                                                     |
| `unconfirmed` (on-chain, under 3 confirmations)           | pending (5009)                              | pending, not listed yet                | waits                                                     |
| `paid` (Lightning, on-chain, or both)                     | approved                                    | **Paid**, listed, a comment (proof)    | ships                                                     |
| `expired`, nothing received                               | declined (3035, expired)                    | declined, never listed                 | —                                                         |
| `expired`, an underpayment received (the page says so)    | pending (5009)                              | pending, not listed, a comment         | a task and a notification: settles with the customer      |
| `paid`, the order canceled meanwhile                      | pending (5009), never approved              | pending, a comment                     | a task and a notification: settles, or restores the order |
| `paid`, the order's total changed after its invoice       | pending (5009), never approved              | pending, not listed, a comment         | a task and a notification: settles the difference         |
| an invoice of another amount than the order's             | pending (5009), never approved              | pending, not listed, a comment         | a task and a notification: checks it in the app           |
| not final 90 days after the invoice's end                 | pending (as it was)                         | pending, not listed, a comment         | a task and a notification: checks it in the app           |
| `paid`, but Wix shows the order unpaid at its second read | approved, nothing more                      | not paid, not listed, a second comment | a task and a notification: delivers, or settles           |
| `paid`, but Wix refuses its approval for a minute or more | approval tried again, then nothing more     | not paid, not listed, a second comment | a task and a notification: delivers, or settles           |

- **Only a `paid` status marks an order paid**, from the server's own check of the invoice the
  plugin keeps for it, under the order's lock: never because the customer's browser says so or
  opens a page.
- **Accepted for less.** The merchant may accept an on-chain payment short of the amount in the
  sattle.me app, within its tolerance or by hand (the merchant's acceptance of what an order
  underpaid on-chain received, `SPEC.md` §31): the SDK then reports it `unconfirmed`, then `paid`
  with `received` below the invoice's sats, and the order is approved and **Paid** like any
  other, its comment saying what was received of what was due. An `expired` status is final, even
  in the rare case where the merchant's acceptance was missed at the invoice's last check: such an
  order is left to the merchant as an underpayment ([Known limits](#known-limits)).
- **One payable invoice per order.** Each order gets a reference drawn on the server, never
  reused: `wix.<the Wix order id>.<128 random bits>` (`SPEC.md` §17: no personal data; no other
  shop, restored backup or copy of the site makes the same). Its invoice is made under the
  order's lock (a double click, or Wix asking again: the same invoice), and the SDK hands an
  invoice that may still be paid out again (`InvoicePendingError`) rather than make a second one
  (`SPEC.md` §21). An order whose invoice expired unpaid may get a new one; a new payment of an
  order paid, or waiting for the merchant, is refused.
- **Where the reference appears**: it names the sale in the merchant's sattle.me app; it is Wix's
  id of each of the order's transactions, numbered (`wix.<order id>.<random>.1`, then `.2` for a
  second attempt to pay the same order), shown on the order's payment line in Wix's dashboard; and
  it is in the order's comment ("sattle.me reference: …"), in the merchant's task, and on the
  status page. The invoice's note, "Wix 8c1b2a3d" (the order id's first characters), names the
  sale in the app's lists.
- **Deadlines**: an invoice lives the time to pay, 60 minutes at most, and Wix documents no
  automatic cancellation of a pending order (a pending order cannot be shipped: its fulfillment
  waits for the payment), so no invoice outlives its order. A payment made in time is accepted
  however long its confirmations take, and an order whose on-chain payment is being confirmed
  stays pending, which nothing of Wix's cancels (nor its dashboard: the action is greyed out,
  measured).
- **The proof** is kept with the order, in its comment: the amount in sats for the order's price,
  the rate and its source, the method, the preimage or preimages, the deposit address and the
  transactions (linked to mempool.space), what was received, the reference. The plugin's records
  keep it too, until 90 days after the payment is done.
- **The status page** lists the payments under way (reference, state, what was received of what
  is due, the deposit address linked to mempool.space, the invoice's end, the last check and its
  error in plain words) and those that need the merchant (with their Wix order id, the reason,
  and whether their task was made).
- **Not listed until paid.** Wix lists an order in **Orders** once it is paid, and numbers it
  then: before, its number is 0 and it is in no list, that of payments included (measured). Wix's
  help says so of payment providers that do not process payments at once: "the orders appear only
  after the payment has been processed". An order that needs the merchant before it is paid (an
  underpayment that expired, above all) is found through its **task**, its notification, and the
  status page, which give its Wix order id and the invoice's note ("Wix 8c1b2a3d", the sale's
  name in the merchant's app).
- **The comment** is a merchant comment on the order's timeline. **The task** is a task of the
  site's dashboard, "Tasks & Reminders" (on the customer's contact card, or with the dashboard's
  search: it is not in the side menu), due at once, linked to the order's customer. Wix shows a
  task's title alone, not its description (measured): the title says what happened and what to
  do; the description gives the payment's reference and Wix order id first, then what came of
  what was due, the deposit address, the amount, its rate and the proof, as far as Wix's 500
  characters allow (a longer one is refused: measured), the comment holding all of it. Every text
  the plugin gives Wix keeps within the length Wix documents (a task's title 250 characters, its
  description 500, a comment 5000, a notification 512), cut at a character boundary when a value
  is long. The status page says whether each task was made.
- **The notification** is a Wix site notification (Velo's `notify()`, `wix-crm-backend`) to the
  site's **owner** alone (`recipients: Owner`: not to collaborators, nor to another account that
  manages the site), on two of Wix's channels: `Dashboard`, the bell at the top of the site's
  dashboard (Wix's help: the bell lists "site interactions such as purchases or bookings"), where
  Wix shows its text, "Order …: underpaid, invoice expired. Details in the dashboard's task and on
  the status page.", with a link to the status page; and `Mobile`, the Wix app (its push
  notifications and its list, under the site), with its title "Bitcoin payment needs you". Not by
  email (`notify()` has no email channel), nor in the browser (the plugin does not ask for
  `Browser`). Whether Wix shows it is the owner's choice, in the dashboard's **Notification
  Preferences** (**Dashboard → Customize**) and in the Wix app (**Notifications → More Actions →
  Manage notifications**): `notify()` returns nothing and resolves the same whether Wix shows the
  notification or not, so the plugin cannot know (its record says `notice: "done"` once Wix took
  the call). Not seen in the bell on Wix development sites, in October 2026 nor on 23 November
  2026 (the plugin's record said `done`); not looked for in the Wix app: the task and the status
  page are where the merchant finds such an order for sure.
- **"Paid offline"**: on the order's page, Wix shows the payment as "Paid offline" (in French "Payé
  hors ligne", pending) until the plugin sends its first event (its pending event, at the payment
  page's first check, as the customer arrives on it; measured with the earlier build, whose first
  check came 40 to 50 s after the customer's click), then as "Bitcoin (Lightning / on-chain)",
  with the transaction's id: pending after a pending event, declined after a declined one
  ("Payment declined", in French "Paiement refusé"), paid after an approval (measured). The plugin
  records no payment itself.
- **Two orders of one cart**: when a second order of the same cart was placed before an order's
  first event, Wix kept that order's "Paid offline" line, and its later events added a line beside
  it (pending, or paid) or none (declined) (measured: 7 orders of 7, one of them on purpose; none
  of 12 others). A paid order was then Paid and listed, Wix giving `PAID`, with a "Paid offline"
  line still pending beside its Bitcoin payment: nothing more is due, and that line is not to be
  marked paid. An unpaid one stayed pending instead of declined, in no list. Orders whose first
  event came before the next order of their cart kept one line, as they should: the plugin
  therefore sends its pending event at the invoice's first check, the payment page's first view,
  seconds after the customer's click (not measured on Wix with the page: 40 to 50 s with the
  earlier build). A second order placed within that time can still do it.
- **An order changed after its invoice** is never completed automatically: Wix lets a merchant
  edit an order (its items, prices, fees, discounts: Wix's help, "Editing Orders", which excludes
  only orders with a subscription, refunded, canceled, archived or not in the site's currency).
  When the payment is found paid, the plugin reads the order and compares what it has due (its
  total now, less what its other payments paid, a gift card say) with the invoice's price, in its
  currency: different, the order stays pending, with a comment giving what was received (in sats,
  the invoice's price) and the order's total now, and the merchant gets a task and a notification
  to settle the difference with the customer (refunds from the sattle.me app) and complete the
  order by hand. Not measured on Wix: whether its dashboard lets a merchant edit an order awaiting
  this payment (unlisted, its number 0), and how the merchant then completes it
  ([docs/manual-tests.md](docs/manual-tests.md), "An order edited").
- **The approval goes to the transaction that was paid**: Wix makes a transaction at each attempt
  to pay an order (`createTransaction`); events go to the latest it was not refused, and, once the
  payment is paid, to the one that was current then: a transaction Wix makes of a paid order is
  refused ("already paid"), and never takes the approval from it. An approval Wix refuses is sent
  again at each check (each view of the page, where the customer waits, then the job's runs);
  refused twice over a minute or more, it is given up: the merchant gets a comment with the proof,
  a task and a notification ("paid, not recorded by Wix", as below), the customer is sent to Wix's
  success page, and Wix is told nothing more.
- **A paid order read back**: Wix answers the same to every event, whether it applies it or not. For
  a paid order, the plugin does not rely on it: it reads the order back at the job's next run (2
  minutes after its approval at the earliest), then once more, at least 30 minutes later; if Wix
  still shows it unpaid at the second read, the order gets a second comment, with the proof, and the
  merchant a task and a notification ("paid, not recorded by Wix", on the status page too), since
  such an order is in none of Wix's lists. The customer, who paid, is sent to Wix's success page.
  When Wix gives no status, the logs say so, and nothing else. Every paid order of the tests on Wix
  was Paid.
- **What Wix cannot express**: a pending order "for the merchant" is Wix's ordinary pending order
  (code 5009, "pending general"), unlisted until paid; what the merchant must do is in the task,
  the comment and the notification.
- **Cancellation**: Wix gives a payment provider no say in it: the Payment Provider service plugin
  has no call for it (`getConfig`, `connectAccount`, `createTransaction`, `refundTransaction`
  only), nor a way to hide a cancel action. Wix's customers cannot cancel an order
  (their **My Orders** page shows it, its status and tracking, nothing more: Wix's help, "About the
  My Orders Page"), and the dashboard greyed out the cancellation of a pending order (measured with
  the earlier build): an order stays pending while its payment may still come, is being confirmed,
  or ended underpaid (the plugin never declines an order that received something). An order
  canceled some other way (Wix's API, another app) and then paid is never approved: a comment, a
  task and a notification tell the merchant (the table above).
- **Refunds** are never automatic: a Lightning payment can only be refunded to an invoice of the
  customer's, an on-chain one to an address of theirs, which Wix never asks. The plugin answers
  Wix's refund request "refund not allowed" (3022): the merchant refunds from the sattle.me app,
  and settles with the customer.

## Background checks

The SDK has no webhooks: the site's own server checks each invoice (`getStatus`), on the payment
page while the customer is on it, and in one scheduled job, hourly, for what remains.

- **The payment page** checks the payment at each view, at most every 5 s per payment (a view
  within 5 s of the last check, as its read of the payment says, shows that check: no lock, no
  write; one while a check runs waits for it, up to 2 s, reading its lock). It loads itself again
  every 10 s while the
  invoice can be paid, every 30 s while an on-chain payment is being confirmed; its button checks
  again at once. No request waits for a payment (`waitForPayment`).
- **One job, hourly** (`backend/jobs.config`, at minute 17): Wix runs a site's job once an hour at
  most on most plans (Wix's documentation: "up to 20 scheduled jobs that run at a minimum of 1
  hour intervals"; every 5 minutes on its Elite plans), "within 5 minutes of the specified time",
  and stops one after about 305 s (measured). Each run removes the records no longer needed, then
  checks every payment due when it started, once, the longest due first, 3 at once, each check
  bounded at 12 s, until 290 s, its writes of Wix Data 60 a minute at most (about 15 checks a
  minute, some 60 a run: [Known limits](#known-limits), "Wix's quotas"); a payment it does not
  reach waits for the next run, first (the status page counts them: "Left for the next run"). The
  site keeps its other job slots.
- **What it means for the merchant**: a customer who stays on the page sees their payment there,
  and Wix learns of it at once. An order whose customer left the page is updated at the job's next
  run, within the hour: approved when paid (a customer who closed the page, then paid from their
  wallet in time), declined when its invoice expired unpaid, for the merchant when underpaid. An
  on-chain payment takes about 30 minutes to be confirmed: its order turns **Paid** within 30 s
  if the customer is still on the page, else at the first run after its third confirmation. Ship
  an order once it is **Paid**.
- **After a payment**: an event Wix refuses is sent again at the next check; the comment, the
  task and the notification are tried 10 times at most, once per check, a comment or a task Wix
  answered with an error looked for first, as it may have been made ([Payments and
  orders](#payments-and-orders), "Told once"), one Wix refused outright (an invalid argument) made
  again. The status page's "Task" column says whether the task was made, is being made, was not
  made yet (after how many of its 10 checks, and what Wix answered), or was refused by Wix for
  good (and why), the order then listed under "Payments that need you" with its Wix order id.
  A paid order is read back from Wix.
- **Given up after 90 days**: an invoice whose payment is still not final 90 days after its end
  (an on-chain payment made in time, still unconfirmed on a congested network) is no longer
  checked; its order gets a comment, and the merchant a task and a notification: check it in the
  sattle.me app and settle it by hand. A pending or declined event Wix still refuses 90 days after
  its payment ended is given up too, with a line in the logs (an approval, after a minute: [Payments
  and orders](#payments-and-orders)).
- **A customer who leaves the page, then pays on-chain** before the end of the time to pay: no
  check sees the transaction while the invoice runs, and the next run asks BlockCypher when it
  received it (the SDK's rule for a transaction no check saw in time), which takes 100 requests
  an hour from an IP address, shared on Wix's hosting: a refusal fails that check, and the next
  run tries again.
- **Wix does not promise to run a job on time**: the status page shows the job's last 24 runs,
  and says so when the last one started more than 70 minutes ago. Measured with the earlier
  build's 20 jobs: a median start 5 s late, but around the top of the hour starts up to 5 min 45 s
  late, hence minute 17. A late run delays what only it checks.

## Security

- **The key** lives in the Secrets Manager only (encrypted, read by backend code with elevated
  permissions), read at each call, never cached in a record, never logged (every message the
  plugin logs or keeps is masked of it), never sent to a browser, and absent from Wix's payment
  settings ([Configuration](#configuration)). It is not in the site's exports of collections
  either: the collection holds no key. With it, anyone can make invoices that pay the merchant
  and mark sales as the integration's; it can never spend the merchant's funds nor read their
  wallet (the SDK's README).
- **One key, one site.** If the key leaks, remove the integration in the sattle.me app and make a
  new one: the old key stops working.
- **Public entry points**: three addresses (HTTP functions). The payment page's address carries the
  payment's id and the key of its transaction (128 random bits of Node's `crypto.randomBytes`,
  compared in constant time): it checks that payment and shows its invoice, or sends the customer to
  Wix's own return URL of its final state, and answers the same "not valid" page to anything else.
  It changes nothing a check would not, so a replayed or forged request does nothing (GET only; the
  SDK asked at most every 5 s per payment). Whoever has the address sees what the customer sees: the
  amount, the invoice, the deposit address, never a name or an email. The stylesheet is the same
  text for everyone. The status page takes its token in a form's body (never an address, a log or a
  referrer), compared in constant time, answers only with it, and keeps the site's address only
  then.
- **Paid only by the server**, on a `paid` status of `getStatus`, once, under the order's lock;
  never because of a view of the page. Nothing from the browser decides an amount, a currency, a
  reference or a status: Wix gives them from its server.
- **No float**: amounts are strings of digits, converted with integers (`BigInt`) or refused,
  never rounded.
- **Pages** carry no script, `Cache-Control: no-store`, `Referrer-Policy: no-referrer`,
  `X-Content-Type-Options: nosniff`, `noindex`, and escape every value; the QR code is drawn on
  the server, as an SVG path that holds no text. The SDK's errors become messages of the
  plugin's (their code), never its internals.
- **Framing.** The plugin sends `Content-Security-Policy: default-src 'none'; style-src 'self';
base-uri 'none'; form-action 'self'; frame-ancestors 'none'`, and `X-Frame-Options: DENY`.
  Measured on 23 November 2026 (a site on wix-dev-sites.org, behind Cloudflare): Wix replaced
  that policy with its own, `default-src 'self'; script-src 'nonce-…'`, which says nothing of
  frames, and the page had no `X-Frame-Options` (sent since): another site could show the
  payment page in a frame. The other headers came through. What a framing site could do: show a
  payment page whose address it has (its own order's: a customer's page is reachable only with
  its 128-bit key) inside its own page, and have a visitor click its button, which only checks
  the payment again (at most every 5 s), or its wallet link, which opens the visitor's wallet
  with that invoice; a visitor who then pays pays that order, to the merchant, as with the
  page's address sent to them. It cannot read the page (another origin), change a payment,
  learn the integration key or a customer's address, nor mark anything paid; the status page
  framed takes the token only into the site's own page, and shows the attacker nothing. Measured
  since, with the release's files: Wix passes `X-Frame-Options: DENY` on, and the browser refused
  the payment page in a frame ([docs/manual-tests.md](docs/manual-tests.md), "In a frame").
- **Outbound requests.** The SDK connects to hosts the merchant chooses (its relays, its Lightning
  address): `https` and `wss` only, no IP address, no `localhost` nor a name under it, no redirect
  followed. The merchant's Bitcoin node, when the merchant's app names one, follows the SDK's own
  rule (`SPEC.md` §31): `https`, or `http` to a host of a local network, an IPv4 address allowed,
  never `localhost`; GET requests at the paths of mempool.space's API and its WebSocket, deposit
  addresses alone sent. What it shows decides whether an order is paid, as mempool.space's would:
  it is the merchant's own choice, made in the app, for this merchant's site alone.
- **Supply chain**: the SDK is a tarball pinned by its SHA-256 and installed at the lockfile's
  integrity, and the bundle holds only the packages pinned at exact versions, the QR code encoder
  included ([Versions and dependencies](#versions-and-dependencies)); no CDN, nothing loaded from
  elsewhere.
- Report a vulnerability privately: [SECURITY.md](SECURITY.md).

## Privacy

- **What the plugin keeps**, in the site's `SattlemeCheckout` collection (Admin only), for each
  order to pay in Bitcoin: its Wix order id, its number once paid, and its customer's contact id
  (no name, email or address); its reference, its price, its invoice (the Lightning invoice, the
  deposit address, the payment URI, the rate); its state and the proof of its payment
  (preimages, transactions); and its Wix transactions (each with the key of its payment page). It
  removes them 90 days after the payment is done, a week after it ended for one that ended with
  nothing paid; the proof stays in the order's comment.
- **What the site's server sends**, through the SDK (never the key), and to whom:

  | Who                                           | What, and why                                                                   |
  | --------------------------------------------- | ------------------------------------------------------------------------------- |
  | The merchant's Nostr relays                   | encrypted for the merchant: the invoice, its price and note, leases             |
  | breez.tips (the merchant's Lightning address) | the invoice's amount and note, then its payment checks (LUD-21)                 |
  | CoinGecko, then Coinbase                      | the price of bitcoin in the site's currency                                     |
  | mempool.space, or the merchant's Bitcoin node | the deposit address, its transactions and the chain's height (below)            |
  | BlockCypher                                   | a transaction, only one no check saw while its lease ran                        |
  | Wix                                           | the site's own services (data, secrets, orders, contacts, tasks, notifications) |

  Each of them sees the IP address of Wix's server, never the customer's. The blockchain is read
  from one explorer: mempool.space, or, when the merchant's sattle.me app names one, the merchant's
  own Bitcoin node, with mempool.space as its fallback unless the merchant chose none (the SDK's
  README, "The merchant's Bitcoin node"). The plugin's links to a deposit address or a transaction,
  on the status page and in an order's comment, open mempool.space in the merchant's browser.

- **What the customer's browser contacts**: the site alone. The payment page and its stylesheet
  are the site's HTTP functions, its QR code is drawn on the site's server, and the page asks for
  nothing from elsewhere. The customer's wallet reaches the Lightning or Bitcoin network when it
  pays, as for any payment; the page's link hands it the payment URI.
- **Removing personal data.** When Wix deletes a contact (the merchant deletes it, or the customer
  asks under a privacy law), the plugin (`backend/events.js`) removes from that contact's payments
  what leads to the customer's coins on the blockchain and to the customer, and every copy of how
  they paid that a final payment no longer needs: the deposit address, the payment URI (the wallet
  link, which holds it), the Lightning invoice and its verify URL, the transactions, the contact's
  id, and the payment page's address as Wix was answered (made again from its key, should Wix ask
  for that transaction again). What stays answers the payment's page, which then shows only the
  order's state ("Payment incomplete", or Wix's page of it: the key of each transaction's page and
  Wix's return addresses), and the merchant's accounting: references, the Wix order, amounts,
  rates, dates, states, Wix's events and the Lightning proofs (payment hash, preimages, which name
  the merchant's node, never the customer's); a test lists every field the record keeps. A payment still being checked then (an on-chain
  payment being confirmed) loses them once final, before the plugin writes anything of it: the
  deletion is kept until then, as a hash of the contact's id, for 200 days. Every comment, task
  and notification written after the erasure leaves out what it removed (the address, the
  transactions, the payment link, the contact: the task is linked to no contact), and says that
  the payment's data was erased at the customer's request (measured on a Wix site before this:
  the comment written on payment held the address and the transaction). A contact merged into
  another is not erased: its payments follow the contact kept. What the merchant's relays
  received stays the merchant's: the app keeps its sales. A comment written before the erasure
  (the proof of a payment made before, with its address and transactions) stays on the order, in
  Wix, with the rest of the order's data.
- **Exports**: Velo gives site code no hook of a data export request; the plugin's records hold no
  name, email or postal address.

## Known limits

- **No refund** ([Payments and orders](#payments-and-orders)).
- **Amounts**: within the merchant's Lightning address's minimum and maximum (shown when
  connected); on-chain from 1 000 sats; an amount outside the Lightning bounds is payable on-chain
  only, with a free address in the merchant's lot (else refused, "open the app to refill the
  lot").
- **Currencies**: the site's currency must be in both Wix's table (161 currencies, no BTC) and
  checkout-spec's `currencies.json` (ISO 4217 List One, the decimals the merchant's app uses). Ten
  of Wix's are refused at connection and checkout: ANG, BGN, BOV, CHE, CHW, COU, CUC, HRK, MXV,
  SLL. For thirteen, Wix gives more decimals than the merchant's app (AFN, ALL, IRR, KPW, LAK, LBP,
  MGA, MMK, RSD, SOS, SYP, YER: 2 at Wix, 0 in the app; IQD: 3, 0): an amount is taken only if it
  is a whole number of the app's units, never rounded.
- **One currency per payment**: the one Wix's `createTransaction` gives ("the merchant's preferred
  currency", Wix's documentation). Wix's multi-currency checkout works with Wix Payments, PayPal
  and Stripe only.
- **One invoice per Wix order, not per cart**: Wix makes an order each time a customer places one,
  the same cart included, and deletes a cart once an order of it is paid (Wix's documentation).
  Measured: the same cart placed in two tabs made two orders; one checkout made three orders in 18
  minutes, the first of them waiting for its on-chain confirmations. A second order placed before
  the first one's first event leaves the first one a "Paid offline" line
  ([Payments and orders](#payments-and-orders), "Two orders of one cart"). Each order has its own
  invoice: a customer could pay two. Both orders are then paid and listed, and the merchant
  refunds one from the app.
- **Other payment methods**: with offline payments on, Wix preselected "Manual Payment" at
  checkout (measured): the customer must choose "Bitcoin (Lightning / on-chain)".
- **One title, no logo at checkout**: Wix reads the method's title once, when the site is
  published, whatever the customer's language; and takes a logo only as an address of an image
  on the web, which would have the customer's browser load it from elsewhere: there is none.
- **The site's CMS items**: Wix counts the items of all the site's collections against its plan's
  quota (Wix's help, "CMS: Understanding Collection Storage Limits and Quotas": 1,500 on Light,
  4,000 on Core, 20,000 on Business), and refuses any insert past it, after which the plugin could
  no longer lock a payment to check it. The plugin's collection holds a few items of
  configuration, the job's last 24 runs, the refusals and warnings, a lock item per payment being
  checked, one item per order, its payment, and one per deleted contact whose payment was still
  being checked. Anyone can place orders and leave them unpaid: what they leave is removed a week
  later, a payment that ended with nothing paid (its invoice expired with nothing received, or it
  was refused before its invoice) a week after it ended, a refusal (one per order and reason) a
  week after its last time. It is safe: only the SDK's status of the stored invoice proves a
  payment, and it said `expired` with nothing received, which is final ("never paid, for good",
  `SPEC.md` §3: a transaction that comes after the invoice's end and its 2 minutes is late, it
  reaches the merchant's wallet and pays no order; one made in time is reported `unconfirmed`,
  then `paid`, never `expired`); the sale stays in the merchant's sattle.me app. The rest is
  removed 90 days after it was last needed (a deleted contact's, after 200 days): a warning after
  its last time, a payment after it is done (paid, declined after an underpayment, for the
  merchant), a lock item a holder left after its lease, once its payment passed it. Unpaid orders
  thus fill a Core plan's 4,000 items only at some 280 a day or more (two items each at most, its
  payment and a refusal), every day of a week, the site's other items aside.
- **Wix's quotas**: Wix Data refuses a site's write requests past its quota of a minute, all of
  the site's writes together ("WDE0014: Requests per minute quota exceeded", Wix's "Data
  Features"); each call of insert, save or bulkRemove is one, refused or not. The quota depends on
  the plan: 200 writes a minute on Wix's Core plan, 120 on Studio's Basic plan (Wix's help,
  "Changes to premium plan limitations", effective 10 November 2024; its article "About Data
  Quotas" gives 1 500 writes and 3 000 reads a minute for every site). Other plans' figures were
  not found in Wix's documentation; none was measured. What the plugin writes (tests count each):
  - a check of an invoice: 3 writes (its lock taken, its record saved, its lock removed), 4 when
    it tells Wix or the merchant something (its outbox first), and a few reads;
  - a view of the payment page within 5 s of the last check: none (it reads the payment); a view
    while another check runs waits for it, reading its lock;
  - a customer on the payment page: a check every 10 s, 18 writes a minute (6 while an on-chain
    payment is being confirmed, every 30 s); an invoice made: 4 writes;
  - the job: 60 writes a minute at most, while it runs (up to 5 minutes an hour).

  On a Core plan, that leaves room for about 11 customers on their payment page at once (7 while
  the job runs); on Studio's Basic plan, 6 (3); the site's own writes (forms, members, stores)
  aside. Past the quota, a check that cannot take its lock or save its record fails, the page shows
  the payment as it last saw it, and the next view or run tries again; Wix and the merchant are
  never told twice (the outbox, [Payments and orders](#payments-and-orders)). What Wix does past
  its quota was not measured. The job checks about 60 payments a run: with more due in an hour,
  the others wait for the next run.

- **Wix's APIs**: Wix marked `wix-payment-provider-backend` (which tells Wix a transaction's
  status) as Developer Preview when the plugin was first built; its reference (checked on 23
  November 2026) shows no such label, nor a deprecation of any module the plugin uses
  ([Versions and dependencies](#versions-and-dependencies)). Wix is moving site code from Velo's
  modules to its JavaScript SDK, and rolls out a new editor, Studio Two, gradually: a change there
  may need a new version of the plugin.
- **Lightning only, at times**: an invoice of 1 000 sats or more is made in Lightning only, without
  an error, when the merchant's lot of addresses is empty or has no free address, or when the
  explorer does not answer (mempool.space, or the merchant's Bitcoin node: `SPEC.md` §31, "Leasing
  an address"); the merchant's app fills the lot again when it is opened. Many orders left unpaid
  at once can empty the lot. Measured once, cause not established. The status page counts such
  invoices, with the last one's reference.
- **The merchant's Bitcoin node**: when the merchant's sattle.me app names one, the SDK reads the
  blockchain from it, from Wix's servers. A node on the merchant's own network
  (`http://192.168.1.10:3006`, `http://umbrel.local`) cannot be reached from there: with its
  fallback `"mempool"`, mempool.space is read in its place; with `"none"`, the site takes no
  on-chain payment at all (invoices in Lightning only, an amount payable on-chain only refused,
  `TRY_AGAIN`, and the check of an invoice that has an address fails until the node answers, never
  ending it as expired). A node of the Internet (`https`, a name) works as mempool.space does. Not
  measured on Wix.
- **`expired` is final.** The plugin ends a payment as soon as the SDK reports it `expired`, and
  never checks it again. One rare case of `SPEC.md` §3 follows from it: the merchant accepted an
  underpayment in the sattle.me app, and a relay that holds that acceptance fails at the check
  after the invoice's end: that check gives `expired`, where a later one would give `unconfirmed`,
  then `paid`. The order then stays pending with the comment, task and notification of an
  underpayment that expired ([Payments and orders](#payments-and-orders)), although the merchant
  accepted it in the app: the merchant settles that order by hand, as `SPEC.md` §3 says.
- **Wix's own messages**: a customer whose payment is refused sees Wix's generic message, and the
  merchant sees Wix's own message when a refund is refused (refunds are made from the app). A
  payment's refusal is on the status page ("Payments refused") and in the site's logs.
- **The site's address**: the payment pages are on the address the status page was opened at
  ([Installation](#installation), step 7); until it is opened once, every connection and payment
  is refused (`SITE_ADDRESS_UNKNOWN`). After a change of the site's domain, open it again: the
  next payments get their pages on the new address.
- **The payment page is plain HTML**, without script (Wix's Content-Security-Policy blocks them,
  measured): it loads itself again to show a payment (a meta refresh), has a button to check
  again, and takes its one stylesheet from the site's own origin. **To check on a real Wix site**,
  not measured: that browsers follow its meta refresh, and that Wix serves its stylesheet and lets
  the page load it ([docs/manual-tests.md](docs/manual-tests.md), "The payment page"). Without
  the refresh, the customer taps the button; without the stylesheet, the page is unstyled but
  complete.
- **Languages**: the merchant's texts (connection, refusals, comments, notifications, status page)
  follow the site's language (dashboard, **Settings → General Info**); the payment page follows
  the order's (Wix's buyer language) when it is one of these, else the browser's (its
  `Accept-Language`): English, French, German or Italian, English otherwise. Counts take the
  singular where the language does ("1 minute"; in French, 0 and 1).
- **Times**: the status page shows its times in the site's time zone (dashboard, **Settings →
  General Info**, as Wix's `getTimeZone()` gives it), and says which; in UTC when Wix gives none
  or the runtime does not know it. The payment page shows no clock time, only the time left; Wix
  dates the comments and tasks itself.

## Troubleshooting

- **The code panel shows errors when publishing**: with an earlier build, Wix's linter reported
  `no-undef` on `BigInt` and `globalThis`, which Node 18 has, then "it must be installed in the
  site" for two optional modules of the WebSocket library; its type checker, with Velo's types,
  later flagged four lines of `payments.js` (measured). The plugin's modules declare `BigInt` and
  pass Velo's types, with stricter settings than Wix's (`npm run types`, in CI); its one file,
  generated, turns the linter and the type checker off, and imports only Wix's modules and Node's
  own. Wix's types
  change often: if some errors still show, publish anyway ("Publish with errors"): the code runs
  (measured).
- **Connecting reports a technical problem**, though the status page then shows the business:
  the plugin took longer than Wix waits (measured: 21 s or more, the first connection after
  publishing). Connect again: Wix keeps the method refused until a connection succeeds in its
  eyes. The site's logs say how long each connection took, step by step ("connected in …").
- **Payments fail, and the status page lists no refusal**: Wix is not calling the plugin. After a
  failed connection (measured: saving the connection while the integration was removed in the
  app), Wix refused the payment method until its connection was saved again: **Accept Payments →
  sattle.me Checkout → Manage → Save**. The status page says when the last connection was
  refused, and why, until one succeeds.
- **Wix's live logs stop showing new lines** (Developer Tools → Logging): they stop without
  notice (measured): reload the page of the logs.
- **`MaxListenersExceededWarning: Possible EventTarget memory leak detected. 11 abort listeners
added to [AbortSignal]`** in the logs (measured on Wix's Node 18.17.1: 11 times in 10 minutes,
  two payment pages reloading every 10 s): Node 18's warning when more than 10 listeners wait on
  one signal at once, not a leak. The SDK adds one to a call's signal for each request to a relay
  while it runs (its `src/nostr/relay.ts`, `#request`, at `3085eb4`), and removes it when the
  request ends, its timeout included: 5 relays and 3 reads at once make 15. Nothing grows, and
  nothing changes in what the plugin does; Node 22 does not warn.
- **A customer's further order says "connection problem"**: the cart of an unpaid order stays open,
  and a second order from the same browser went through the same checkout; after two, Wix's
  checkout showed a connection problem (measured). An invoice left unpaid expires, and its order is
  declined ([Known limits](#known-limits), "One invoice per Wix order"). What lets that browser
  order again at once was not measured.
- **The site's logs show Wix Data errors** ("An item with \_id [lock-…] already exists", "Item […]
  does not exist"): expected. The lock of a payment is an insert that fails when another check
  took it at the same moment, and the plugin reads records that may not exist (a lock no one
  holds); Wix logs both as errors. "Sandbox environment is disabled" (`WDE0179`, logged with
  `viewMode` "Preview") is Wix's answer to a read made in the editor's preview while the site's
  sandbox database is off; it was seen once, with the editor open, and does not concern the
  published site.
- **The site's logs** say how long each connection and each answer to Wix took, step by step
  ("connected in …", "a transaction answered in …"), and when Wix asked again for a transaction
  it had no answer for in time: the plugin then gives it the first call's answer.
- **"a payment check failed: network (…)"** in the logs: a check could not read the invoice's
  status; the reason, in parentheses, is the SDK's: the host that gave no answer or an error
  ("No answer from mempool.space"), too few of the merchant's relays that answered, or a
  service's refusal. Wix learns nothing from such a check; the next one tries again: the payment
  page's next view, 10 s later, or the job's next run (measured on a Wix site with the earlier
  build: a few a day). Many in a row point to that host or the relays.
- **An order is not in Orders**: see [Payments and orders](#payments-and-orders), "Not listed
  until paid": its task, or the status page, gives it.
- **Connecting, or every payment, is refused with `SITE_ADDRESS_UNKNOWN`**: the plugin does not
  know the site's address yet: open the status page once ([Installation](#installation), step 7).
- **The payment page has no style**: its stylesheet did not load. Check that
  `backend/http-functions.js` exports `get_sattlemeCheckoutStyle`, and open
  `https://<your site>/_functions/sattlemeCheckoutStyle`: it shows the stylesheet. The page works
  without it.
- **The status page says the job's last run is late**: check `backend/jobs.config` (one job,
  `sattlemeCheckoutJob` of `/sattleme-plugin.js`) and publish; the site's logs show each
  run's errors.
- **A paid order shows "Paid offline" pending beside its Bitcoin payment**: a second order of its
  cart was placed before its first event ([Payments and orders](#payments-and-orders), "Two
  orders of one cart"): nothing more is due; do not mark that line paid.
- **"Wix did not record paid order … as paid"** in the logs: the order was paid, and Wix still
  showed it unpaid at its second read, half an hour or more after its approval (its id and its
  status follow); the merchant has its task. "Wix refused the approval of paid order … times:
  given up": Wix refused the approval of a paid order at every try over a minute or more (the
  reason of each is in the line "Wix refused an event of a transaction" before it); the merchant
  has its task. "Could not tell whether Wix recorded paid order …": Wix
  gave no status of the order in that time; check that order in Wix (its id follows).

## Architecture

```
 Wix checkout ──createTransaction──▶ sattlemeCheckout.js ─▶ payments.js ──createInvoice──▶ SDK
      ▲                                    │               │  (lock, reference,       (checkout-sdk.js:
      │ events (submitEvent)               │               │   one invoice per order)  relays, breez.tips,
      │                                    ▼               ▼                           rates, explorer;
      │                   { redirectUrl: the payment page }                            the QR code encoder)
      │                                                    │
 http-functions.js ─ /_functions/sattlemeCheckoutPay ─▶ http.js ─▶ checkPayment ─getStatus─▶ SDK
                   │   (the customer's page, every 10 s)     └▶ its invoice, or 303 to Wix's page
                   ─ /_functions/sattlemeCheckoutStyle ─▶ http.js ─▶ the pages' stylesheet
                   ─ /_functions/sattlemeCheckoutStatus ─▶ http.js ─▶ status page (token)
 jobs.config ─ one job, hourly, up to 290 s ──▶ jobs.js ─▶ checkPayment ─getStatus─▶ SDK
 events.js ─ a contact deleted or merged ─▶ privacy.js ─▶ its payments erased, or moved
 Wix Data "SattlemeCheckout" (Admin only): payments, locks, runs, refusals, warnings, erasures
 Secrets Manager: sattleme-checkout-key, sattleme-checkout-status-token
```

In a release, `backend/sattleme-plugin.js` holds every module below (`sattleme-checkout/…` of
`plugin/site/backend/`) and the SDK's bundle, merged; the repository keeps them apart, and the
tests run on both.

| File (`backend/`)                                    | What it does                                                                                   |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `service-plugins/payment-provider/sattlemeCheckout/` | Wix's Payment Provider service plugin: `getConfig`, and its three other functions              |
| `http-functions.js`, `events.js`, `jobs.config`      | Wix's other entry points: the payment page, its stylesheet, the status page; contacts; the job |
| `sattleme-plugin.js`                                 | What those entry points call; in a release, the whole plugin                                   |
| `sattleme-checkout/payments.js`                      | Connection, invoices, checks, Wix's events, comments, tasks, notifications                     |
| `sattleme-checkout/jobs.js`                          | The hourly job: the payments to check, and the records to remove                               |
| `sattleme-checkout/http.js`, `pages.js`              | The payment page and the status page: their HTML, the QR code, the stylesheet                  |
| `sattleme-checkout/privacy.js`                       | A deleted contact's payments erased, a merged one's moved                                      |
| `sattleme-checkout/store.js`, `wix.js`               | The records and the lock in Wix Data; every Wix module behind plain functions                  |
| `sattleme-checkout/sdk.js`, `checkout-sdk.js`        | The SDK's client and the QR code encoder, and their bundle (built; merged in a release)        |
| `sattleme-checkout/amounts.js`, `currencies.js`      | Wix's amounts to the SDK's exact decimals, and Wix's currencies                                |
| `sattleme-checkout/refs.js`, `safety.js`, `i18n.js`  | References and secrets compared, logs masked of secrets, the texts in 4 languages              |
| `sattleme-checkout/constants.js`, `plugin.js`        | Names, versions, time budgets; the service plugin's functions                                  |

- **Wix's entry points**: the Payment Provider service plugin (`getConfig`, `connectAccount`,
  `createTransaction`, `refundTransaction`), four HTTP functions (three addresses), two backend
  events, one scheduled job. Everything runs on the site's backend.
- **An order, from the cart to its payment**: Wix calls `createTransaction` with the order's amount
  (its minor units) and currency, as Wix records them as due, from Wix's server. The plugin converts
  the amount to the SDK's decimal string exactly, or refuses it. It locks the order's payment, draws
  its reference and keeps it, then asks for the invoice, for the time to pay. Wix sends the customer
  to the payment page. `invoice_pending` resumes the invoice in progress (the page shows it),
  `order_paid` approves at once (when of the order's amount), `onchain_unavailable`, a network or
  rate failure, and the others of `SPEC.md` §5 refuse the payment with a message for the merchant.
  Wix calls `createTransaction` again when it had no answer within about 15 s: the same transaction
  gets the same answer.
- **The lock**: Wix Data has no lock, but refuses to insert an item whose `_id` exists. A lock is
  such an insert, of a lease of 60 s, around each invoice's creation and each check (one at a time
  per order: page, job; measured: one insert of 8 at once wins). Each lock is an item of the next
  generation (`lock-<payment>-<n>`); the payment keeps the generation to take next (`lockGen`),
  which its holder moves past its own as it saves the payment. A lock held by another is waited
  for by reading its item, never by inserting again (Wix counts each insert as a write, refused or
  not); once it is gone, the payment is read again (a page then shows the check that holder made).
  A lease whose holder died is taken over with an insert of the next generation, never by removing
  it: exactly one taker wins. An item is removed only once the payment's `lockGen` passed it, or by
  its own holder while its lease runs: no two holders ever hold the same payment (a test runs the
  case the audit found against the earlier rule). A holder done removes its item, and those of the
  holders that died before it, in one request: a payment keeps no lock item between its checks, one
  while it is checked; a holder whose write failed marks its item released, for the next one to
  walk past. A holder writes the payment only with 15 s of its lease left, more than Wix Data's
  longest time limit (10 s), so that no one takes the lock over before the write is done.
- **Reads from Wix Data's primary**: Wix Data is eventually consistent ("Wix Data and Eventual
  Consistency": a write reaches the mirrors that reads go to "typically" seconds later). Every read
  a decision follows asks for `consistentRead`: a payment, its lock, the site's address and the
  merchant's settings, a deleted contact's payments, and the status page's lists. Only the job's
  list of payments due (each read again from the primary before its check) and its removal of old
  records read a mirror.

### Time limits

A Wix request ends at 14 s, and Wix calls `createTransaction` again after about 15 s without an
answer (measured): every call has a deadline under these, and the SDK's own timeouts bound each
step.

The worst case of `createInvoice`, each step waiting its full timeout (`relayTimeoutMs` R,
`httpTimeoutMs` H; the SDK's README, "What createInvoice does", and its code at `3085eb4`): the
channel (R, up to 4 R when it follows 3 moves of the merchant's relays), then at once the registry
(R), the Lightning address (H) and the rate (H per source asked, one after the other), the
Lightning invoice (H), the lease of an address (the lot and its leases, 2 R; the explorer, H, or
2 H when the merchant's Bitcoin node does not answer and mempool.space answers in its place; the
lease published, read again on every relay, then marked confirmed, 3 R; more for each address
skipped, 3 at most) and the declaration (R). With R = H = 3 s and two rate sources: 3 + 6 + 3 +
(6 + 3 + 9) + 3 = 33 s (36 s through a node's fallback), 42 s with 3 moves. The plugin bounds it
with a deadline:

| Call                                    | Wix's limit             | R, H | Deadline                     |
| --------------------------------------- | ----------------------- | ---- | ---------------------------- |
| `createTransaction` (`createInvoice`)   | ~15 s (Wix calls again) | 3 s  | 8 s, plus ≤ 2.5 s for a lock |
| `connectAccount` (`merchant()`)         | 14 s                    | 3 s  | 9 s                          |
| payment page, status page (`getStatus`) | 14 s                    | 3 s  | 7 s, plus ≤ 2 s for a lock   |
| the job's check (`getStatus`)           | a job ends after ~305 s | 4 s  | 12 s each, 3 at once         |

A call cut by its deadline is safe: an invoice whose creation was cut is resumed by the next attempt
(`invoice_pending`, `SPEC.md` §21; a lease confirmed before the cut stays the order's); a check cut
is made again at the page's next view or the job's next run. When Wix asks again for a transaction
whose first call is still making its invoice, the second call waits up to 9 s for its answer.
Measured on a Wix site in October 2026, with the SDK's release before its renaming (numbered 1.0.0
then, under another package name: not this SDK 1.0.0): `merchant()` answered in 0.25 s, and the whole invoice
creation, emulated against real relays, took 0.7 s.

## Versions and dependencies

- **The SDK**: `@sattleme/checkout` **1.0.0**, from sattleme/checkout-node at `3085eb4`, which
  implements **checkout-spec 1.0.0** (the specification's commit `1bd7966`, which the SDK pins).
  `sdk/` holds the tarball `npm pack` made from a clean clone at that commit (the same bytes with
  Node 22.23.5 and npm 10.9.9, and with Node 24.22.3 and npm 11.19.1; the same bytes, and so the
  same integrity, as the 1.0.0 that npm's registry publishes), and `sdk/PIN.json` its repository, commit, version, SHA-256, and the SHA-256 of each file it
  holds. `package.json` installs it from that file, so that `package-lock.json` records its
  integrity; the build bundles what it installed ([Development](#development), "The pinned SDK").
- **Wix's runtime**: Node **18.17.1**, measured on a Wix site's backend (October 2026; again on 23
  November 2026, on the status page). Wix
  documents no version: its help says only that a package must align with "Wix's current Node.js
  version", and its changelog (checked on 23 November 2026) announces no change of it. Node.js
  ended its support of Node 18 on 30 April 2025: Wix does not say whether it fixes that runtime
  itself, and a Wix site cannot choose another. The status page shows the version a site runs
  (`process.version`), which the test on a real site notes. The plugin is tested on 18.17.1 and on
  Node 20, 22, 24 and 26, and its bundle loads on each. The SDK asks for
  Node 22: on 18 it needs the Web Crypto global, which the bundle gives (`installWebCrypto`, from
  Node's own `crypto` module); its source uses nothing else newer than Node 18.17. Its own tests
  need Node 22 (their runner does): on 18.17.1, the SDK runs in the plugin's tests, its real
  bundle against fakes of the relays and the services, with checkout-spec's vectors.
- **Syntax**: ECMAScript 2020, the level Wix documents for site code (checked: `npm run syntax`).
- **What Wix documents today** (its reference at dev.wix.com, read on 23 November 2026): the
  Payment Provider service plugin (`getConfig`, `connectAccount`, `createTransaction`,
  `refundTransaction`, its reason codes) and `wix-payment-provider-backend`'s `submitEvent`, as the
  plugin uses them; `wix-data` (insert, save, get, bulkRemove, query, `consistentRead`),
  `wix-data.v2` (collections), `wix-auth`'s `elevate`, `wix-secrets-backend.v2`'s
  `getSecretValue`, `wix-ecom-backend`'s `orders.getOrder`, `wix-crm-backend`'s `notify`,
  `wix-crm.v2`'s tasks (`createTask`, `queryTasks`), `wix-site-backend`'s `generalInfo`
  (`getLanguage`, `getTimeZone`), `wix-http-functions`, scheduled jobs (`jobs.config`, one hour
  at least between runs, in UTC); and in Wix's JavaScript SDK, `@wix/ecom`'s `addActivities` and
  `@wix/essentials`' `auth.elevate`. None is marked deprecated; `npm run types` checks the
  plugin against Velo's declarations (`@wix/wix-code-types`). What only a real Wix site shows
  (its Node.js, how it runs the job, serves the pages, applies the events and shows the orders):
  [What was measured on Wix](#what-was-measured-on-wix).
- **Development**: Node 22 or later, the versions Node.js supports (`.nvmrc`: 22.23.5).

**In the release's one file** (`backend/sattleme-plugin.js`: esbuild, an ES module, ES2020, the
plugin's modules, then these packages, their licenses at its end; the modules' build has the same
packages in `backend/sattleme-checkout/checkout-sdk.js`, CommonJS), from the lockfile:

| Package              | Version | License | npm integrity (SHA-512)                                                                    | Tarball SHA-256                                                    |
| -------------------- | ------- | ------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `@sattleme/checkout` | 1.0.0   | MIT     | `AASIOefXCj/6h1vjtdpBVonyYzOzVU9EyQ2HTN3QpypDf37jqn4OJ9if5EQO+OBCu8YL7rJ49RBNkb/rYLxh0A==` | `bba51ccd0c2ad8f82393d97db2edc1f097d67e998daf6f775a7907bf46f63856` |
| `uqr`                | 0.1.3   | MIT     | `0rjE8iEJe4YmT9TOhwsZtqCMRLc5DXZUI2UEYUUg63ikBkqqE5EYWaI0etFe/5KUcmcYwLih2RND1kq+hrUJXA==` | `5636ef70bfb9f2685d885a4c0fbfe53fec9d6e8346361bd3f149146f1a9ec1af` |
| `ws`                 | 8.23.0  | MIT     | `wCkmX8QMOrKjgO8HW2WyDbTSGeqkocxgDzS9iR79rEAexty6/2qzilx3Ag8Tqf9ykop3irLKle0MtVn5qjVnoQ==` | `b8bd105a274ae9ca114f8c6ce4d9dbb0c764fe5118ba633c557e1703e297c587` |
| `@noble/curves`      | 2.4.0   | MIT     | `P4/62zrgfH33CneE3Dn4WhJVA22YUU0eR51wKIan4NVRvwsA0YnPTwWGpNbpuacSujmSFLvyzpyuR30+fbq2Ew==` | `55279c71b0201d6c0e58d0206d15825359e02a3932f326ba7b7909ac2d334aa9` |
| `@noble/hashes`      | 2.4.0   | MIT     | `X5XaVWZIBCT7HHZGm5I7ZQXDwLG+bGXuSrMQAW+7Zvl87h1kmc1ZB1VSRJcpUfoUrGQp4Fkoxm5kZ+Ms+aW+eA==` | `e1946149b780017b2564fcc092cb01c04e1d7f20627d0296c17da8868f4436dc` |
| `@noble/ciphers`     | 2.4.0   | MIT     | `AnjFn0Jv92laAkvMrghlFZq4qQCIN/4DxFV/eooqtC2YTjB7kBeLMS2T9KJX4Dn+ZVXLOwK0lSgqDtx9gvxtiw==` | `4a398bcc280c8742d474f9162f6d3c153e52ab1078e8ab592b4720410fb3c3e9` |

The packages the SDK requires are those its own `package.json` pins, at exact versions. The QR code
encoder of the payment page, [uqr](https://github.com/unjs/uqr) (UnJS; its algorithm is Project
Nayuki's QR Code generator, modified), is the plugin's own dependency, at an exact version. The
build checks that each package is installed once, at the lockfile's version, and that the file
holds nothing else but the plugin's modules; it writes the SDK's commit and the integrity of each
package in the file's header and in `PROVENANCE.json`, and the SHA-256 of every file in
`SHA256SUMS`. The file imports Wix's modules and Node's own (`events`, `http`, `https`, `net`,
`tls`, `crypto`, `stream`, `url`, `zlib`, `buffer`, `util`, `querystring`, which the WebSocket
library requires: the build turns each require into an import, an ES module having no `require`),
and requires nothing. Two builds give the same bytes (`npm run build:check`, in CI).

**Installed by the merchant** ([Installation](#installation), step 2): `@wix/ecom` and
`@wix/essentials`, Wix's, MIT. **For development only**: esbuild, Prettier, acorn and jsQR 1.4.0
(Apache-2.0: the tests read the payment page's QR codes back with it), in `package-lock.json`;
TypeScript, Velo's type declarations (`@wix/wix-code-types`) and the two packages of Wix's SDK, for
the type check (`tools/velo-types/package-lock.json`). **Test data**: `test/vectors/` holds three
files of checkout-spec's public vectors (1.0.0, at the commit the SDK pins:
`test/vectors/PIN.json`), under its license.

## What was measured on Wix

**On 23 November 2026, the plugin 1.0.0** ran on a Wix development site (classic editor with
Velo; its status page showed Node v18.17.1), with real payments to a staging merchant: paid in
Lightning; paid on-chain; on-chain in part, then the rest in Lightning; on-chain in part, then
expired; expired with nothing paid; a refund (refused: Wix showed its own message, as
[Payments and orders](#payments-and-orders) says); no key; the integration removed; the site's
address unknown; a customer's contact deleted while their payment was being confirmed; contacts
merged. It ran the same sources as this release, merged by esbuild into one file of the plugin's
15 modules, not this release's files. What it showed, and what 1.0.0 does since:

- Wix refused the task of an underpayment that expired (`INVALID_ARGUMENT: "task.description" has
size 624, expected 500 or less`): no task was made, its record stayed `report.task: "sending"`,
  the status page's Task column showed "–". The plugin now keeps every text within the lengths
  Wix documents, and a task Wix refuses ends as refused, with its reason, on the status page
  ([Payments and orders](#payments-and-orders), [Background checks](#background-checks)).
- Wix served the payment page with its own Content-Security-Policy, without the plugin's
  `frame-ancestors 'none'`, and no `X-Frame-Options`: the page could be framed. The plugin now
  sends `X-Frame-Options: DENY` ([Security](#security), "Framing").
- Wix kept **Connect** disabled while the "Minutes to pay" field was empty: its label now asks for
  a number, 15 suggested ([Configuration](#configuration)).
- The order's comment written on payment, after the customer's contact was deleted, held the
  deposit address and the transaction: notes written after an erasure now leave them out
  ([Privacy](#privacy)).
- The owner's notification of the underpayment (its record: `notice: "done"`) did not show in the
  dashboard's bell; the Wix app was not checked ([Payments and orders](#payments-and-orders),
  "The notification").
- Node 18's `MaxListenersExceededWarning` in the logs, 11 times in 10 minutes
  ([Troubleshooting](#troubleshooting)).
- Wix's **Publish** button gave no confirmation (each click, one publication in the site's
  history); Wix's live logs stopped without notice (a reload showed them again); an unpaid cart
  stayed open, a second order from the same browser went through its checkout, and Wix showed a
  connection problem after two; a refused key showed "Cannot connect. Check your credentials…", a
  refused number of minutes or site address "A technical problem occurred"; a status token
  shorter than 32 characters was not sent, without a message (the form now says it).

**A recheck of the release's files** (`06a3f38`, its plugin's file then named
`backend/sattleme-checkout.js`), on the same site and Node v18.17.1: the six files installed, their
imports (Wix's modules, Node's own) loaded; Wix sent `X-Frame-Options: DENY`, and a browser
refused the payment page in a frame; a payment in Lightning, its preimage verified; an
underpayment that expired, its customer's contact deleted: its task made, within 500 characters,
and its comment, task and notification without the address or the wallet link. It showed two
more things, fixed since: the plugin's file and the payment provider's `sattlemeCheckout.js`, side
by side under nearly the same name, took a paste meant for the other (the plugin's file is now
`backend/sattleme-plugin.js`, and the installation says to check the open file and each file's
SHA-256); and the erased payment's record still held its Lightning invoice, its verify URL and its
page's address (erased now).

**Not measured on Wix yet**: those two fixes; the job at `/sattleme-plugin.js`; the minutes'
label, the task's states on the status page when Wix refuses one, the token's hint; the owner's
notification in the Wix app; and the cases of [docs/manual-tests.md](docs/manual-tests.md) the
tests did not run (among them the page's meta refresh and stylesheet on phones, an overpayment,
on-chain in two transactions, the merchant's tolerance and acceptance, an order edited, two
orders of one cart, the merchant's Bitcoin node).

**Earlier, in October 2026**, on a Wix development site: first a feasibility probe (in this
repository's history, removed since), then, from 14 to 16 October, the whole procedure of
[docs/manual-tests.md](docs/manual-tests.md) with real payments (Lightning, on-chain, both, the
merchant's tolerance) to a staging merchant, with this plugin at `9c92b51` (which sent the
customer to a page of the merchant's sattle.me web app, and checked payments with 20 scheduled
jobs), as recorded on 16 October (`72fe4bb`), and the SDK's release before its renaming
(numbered 1.0.0 then, under another package name, on the specification's earlier 0.1.0). On 23
November, before the 1.0.0 test, that site held a later build of the same plugin, `88f9271`:
16 October's `main` (`fd7f7f8`: `9c92b51` and three fixes, for the editor's type checker and
the reason of a failed check in the logs) with `ws` 8.23.0 (20 November); `88f9271` did not
exist in October. Every line of the table below is of the October tests, unless it says 23
November 2026.

| What                         | Measured                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime                      | Node 18.17.1; no global `crypto` nor `WebSocket`; `fetch`, `AbortSignal.any`, `AbortSignal.timeout`, `Object.hasOwn` there                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Runtime, 23 November 2026    | v18.17.1 on the status page (`process.version`); Node 18 warns `MaxListenersExceededWarning` when more than 10 listeners wait on one AbortSignal (the SDK's relay requests: not a leak)                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Tasks, 23 November 2026      | a description of 624 characters refused, `INVALID_ARGUMENT: "task.description" has size 624, expected 500 or less`, as Wix's reference documents (500)                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Settings, 23 November 2026   | Connect disabled while a field is empty; a refused key: "Cannot connect. Check your credentials…"; a refused number of minutes or site address: "A technical problem occurred"; the Publish button confirms nothing, one publication per click in the site's history; the live logs stop without notice                                                                                                                                                                                                                                                                                                     |
| Checkout, 23 November 2026   | an unpaid cart stays open; a second order from the same browser went through its checkout, and a connection problem showed after two; a refund through the method refused, with Wix's message                                                                                                                                                                                                                                                                                                                                                                                                               |
| Notifications, 23 November   | `notify()` to the owner, Dashboard and Mobile, accepted (`notice: "done"`): nothing in the dashboard's bell; the Wix app not checked                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| The SDK's bundle             | loads as CommonJS (a namespace import); with the Web Crypto global, every check passes, in requests and in jobs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| WebSocket out, HTTP out      | the `ws` client opens the relays (0.1 to 0.6 s); the global `fetch` refuses redirects and honors aborts                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `merchant()` with a test key | 0.25 s, 5 relays                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Wix Data as a lock           | an insert of an existing `_id` fails (WDE0074): one of 8 at once wins, in each of 10 rounds; Velo's `save()` changes the object it is given: a write through a reference taken before it is lost                                                                                                                                                                                                                                                                                                                                                                                                            |
| Time limits                  | a request ends at 14 s (its code goes on); Wix calls `createTransaction` again after ~15 s, same transaction, and declines it past that; with the plugin, Wix called `createTransaction` 6 to 7 s after the customer's click, and the plugin answered in 6 to 7 s (the SDK's invoice: 4.5 to 5.1 s)                                                                                                                                                                                                                                                                                                         |
| Jobs                         | each runs ~305 s, starts a median 5 s late; 20 jobs 3 minutes apart covered 2 h 10 with one gap of 19 s                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| HTTP functions               | Wix sends its own `Content-Security-Policy: default-src 'self'; script-src 'nonce-…'` (no script, no inline style) in place of the plugin's, which is lost, `frame-ancestors 'none'` with it (measured again on 23 November 2026: the page could be framed); `Cache-Control`, `Referrer-Policy` and `X-Content-Type-Options` came through; Wix opens a provider's page as a full page (desktop)                                                                                                                                                                                                             |
| Events                       | Wix answers `{}` to every event, duplicates included; pending then approved: paid; pending then 3035: rejected; no event and the success page: pending                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Orders                       | at `createTransaction`, the order is initialized (number 0); a new attempt after cancellation makes a new order and a new transaction                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Orders, with the plugin      | unpaid orders keep number 0 and stay out of Orders until paid; a second order of the same cart placed before an order's first event left that order's "Paid offline" line pending, its later events adding a line beside it or none (7 of 7; 0 of 12 others); the same cart placed twice makes two orders; a pending order cannot be canceled; unpaid orders are not in the list of payments either; with the test site's email settings, the customer got no email at the order nor at its pending event; a task shows its title alone; the payment shows as "Paid offline" until the plugin's first event |
| Payment settings             | no checkbox field is shown (a text field is); the connected account's name is shown masked; after a failed connection, Wix refuses the method; the first connection after publishing took 21 s or more, and Wix reported a failure though the plugin connected                                                                                                                                                                                                                                                                                                                                              |
| Jobs, with the earlier build | every 3 minutes, each run 4 min 03 s, no error in an evening; around the top of the hour, starts late: 5 min 45 s, 3 min 46 s, 3 min 11 s, 49 s (19:00 to 23:00 UTC)                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Locks, with the plugin       | one lock item per payment being checked, at every reading (9 readings, 7 payments); none once its item is inactive (16 October 2026)                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

## Development

```sh
npm ci --ignore-scripts
npm run check   # the pinned SDK, format, build twice, ES2020 syntax and imports, tests, archive
npm ci --ignore-scripts --prefix tools/velo-types
npm run types   # the built modules against Velo's types (after npm run build)
```

| Path                   | What it is                                                                    |
| ---------------------- | ----------------------------------------------------------------------------- |
| `plugin/site/`         | The plugin's files (`backend/…`), its modules apart                           |
| `plugin/bundle/`       | The entry of the bundle: the SDK and the QR code encoder                      |
| `dist/`                | Built: `plugin-site/` (the release), `plugin-modules/`, `plugin-test/`        |
| `sdk/`                 | The pinned SDK: its tarball and `PIN.json`                                    |
| `scripts/`             | The build and its checks, the SDK's import, the archive, the test runner      |
| `test/unit/`           | The plugin with fakes of the Wix modules and of the SDK                       |
| `test/journeys/`       | Whole orders, from `createTransaction` to the last event: the page, the job   |
| `test/integration/`    | The plugin with the SDK's real bundle, against fakes, with the spec's vectors |
| `tools/velo-types/`    | The type check: TypeScript with Velo's declarations, in a lockfile of its own |
| `docs/manual-tests.md` | What to test on a real Wix site                                               |

- **The build** (`npm run build`, `scripts/build.mjs`) makes `dist/plugin-site/`, the release:
  the plugin's modules, the SDK and the QR code encoder merged by esbuild into one ES module,
  `backend/sattleme-plugin.js`, with the five files Wix requires copied from `plugin/site/`;
  `dist/plugin-modules/`, `plugin/site/` as it is with the SDK's bundle beside it, for the type
  check; and `dist/plugin-test/`, the release's file with the SDK left out, for the tests' fake
  SDK. `npm run syntax` checks both builds' syntax (ES2020) and imports, and the release's files.
- **The tests** run on the built plugin (`npm run build` first) with Node's test runner, on Node
  22 or later and on Node 18.17.1 and 20 (`node scripts/test.mjs`), each group twice: on the
  modules, then on the release's one file (the integration tests on the very file the archive
  holds); no test reaches the network.
- **The type check** (`tools/velo-types/tsconfig.json`): TypeScript 6 with the declarations Wix
  publishes for its code editor (`@wix/wix-code-types`) and their settings for a site's backend,
  stricter (every `strict` flag but `noImplicitAny` and `useUnknownInCatchVariables`, unused
  names, missing returns). Not TypeScript 7: it removed the module resolution Wix's settings set
  (`node`, which 6 deprecates); Dependabot leaves it aside, and a maintainer moves to it by hand
  once Wix's settings allow it. Wix publishes no coding standard for site code (its ESLint plugin for
  the Wix CLI checks only imports from pages and public files, which the plugin has none of): the
  code's is Prettier's format.
- **The archive** of a release (`npm run archive`): `dist/checkout-wix-<version>.zip`, the built
  files and CHANGELOG.md, LICENSE and README.md, the same bytes from the same files;
  `npm run archive:check` reads it back, and `node scripts/archive.mjs --extract <dir>` gives its
  files back, for the tests to run on them.
- **The pinned SDK.** `node scripts/sdk.mjs check` (in `npm run check`, and a test) checks `sdk/`
  file for file against `PIN.json`, and that the lockfile installs it. To take another version,
  clone sattleme/checkout-node, check out its commit, then `node scripts/sdk.mjs import <clone>`:
  it requires a clean clone, packs it (`npm ci --ignore-scripts`, `npm pack`), replaces `sdk/`,
  writes `PIN.json` and installs the tarball. Then set `SDK_VERSION` and `SPEC_VERSION` in
  `plugin/site/backend/sattleme-checkout/constants.js` (the build refuses others), take the
  specification's vectors of the commit that SDK pins into `test/vectors/` (with
  `test/vectors/PIN.json`), adapt the plugin to the SDK's changes, and run `npm run check`.
- **Dependencies** (`.github/dependabot.yml`): one grouped pull request a week per ecosystem and
  directory (the actions, the tools, the type check's packages), for versions 7 days old or more.
  Not the SDK (`sdk/`, taken from a commit as above), nor the Node.js versions the CI tests (its
  matrix, 18.17.1 for Wix's runtime, and `.nvmrc`), which a maintainer updates by hand: the newest
  release of each line, 7 days old or more.
- **CI** ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)), on GitHub's hosted runners
  (Ubuntu 26.04), on every pull request and push to `main`: the checks on Node 22, 24 and 26; the
  tests on Node 18.17.1 and 20; the type check; the archive, checked, and the tests run again on
  the files it holds, kept as an artifact.

## Releases

Releases are the maintainers' only. First run the procedure of
[docs/manual-tests.md](docs/manual-tests.md) on a test site; then set the version in
`package.json`, `plugin/site/backend/sattleme-checkout/constants.js` (`PLUGIN_VERSION`) and
`CHANGELOG.md` (a section `## <version> - <date>`, the date in ISO 8601), in a pull request. Once merged, a maintainer pushes the
tag `v<version>` on that commit of `main`;
[`release.yml`](.github/workflows/release.yml) runs the CI again, checks the tag (its form, the
version in those three files, a commit of `main`), and, once a maintainer approves it in the
`release` environment, makes a **draft** GitHub release of the tag with the archive and the
CHANGELOG's section. A maintainer checks it and publishes it.

There is no marketplace to submit to: Wix's App Market does not take a Velo payment provider
("You can't publish the plugin you create on the Wix App Market"). The published release is where
the sattle.me app's download points; each merchant installs the files in their own site.

## License

[MIT](LICENSE). The sattle.me name and logo are not under that license.
