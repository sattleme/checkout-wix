# Manual tests on a Wix site

What the automated tests cannot show: Wix itself (its editor, its checkout, its dashboard, its
scheduled job, how it serves the plugin's pages), browsers, wallets, the merchant's real relays,
breez.tips, mempool.space (or the merchant's Bitcoin node), and real payments. Run these on a **test
site** connected to a **staging** merchant of the sattle.me app, with small amounts, before a
release. Note for each the time, the order's number (or its Wix order id while it has none), and
what the customer and the dashboard showed.

The whole procedure passed on 16 October 2026 with an earlier build of the plugin (`9c92b51`,
which sent the customer to a page of the merchant's sattle.me web app and checked payments with 20
scheduled jobs) and the SDK's release before its renaming (numbered 1.0.0 then, under another
package name). Version 1.0.0 of the plugin, on `@sattleme/checkout` 1.0.0, ran part of it on a
Wix development site on 23 November 2026 (classic editor with Velo, Node v18.17.1), from the same
sources merged into one file rather than the release's files; what it showed was fixed since
(README, [What was measured on Wix](../README.md#what-was-measured-on-wix), which lists what
remains to measure). Run it in full with the release's files before the release is published.
Use the six files of the CI's archive (the `checkout-wix` artifact of its run on the commit to
release), or `dist/plugin-site/` of that commit, and note its version and the files' SHA-256s. What Wix does, as measured on
a Wix development site in October 2026 (README,
[Payments and orders](../README.md#payments-and-orders)): an order that is not paid has number 0
and is not in **Orders** (open it by its direct link); Wix shows its own messages to the customer
and the merchant, not the plugin's (the status page and the site's logs give the reason).

## Setup

1. A Wix site on a plan that takes payments, Velo on. Install the plugin from those six files
   (or `dist/plugin-site/`) as the README says
   ([Installation](../README.md#installation)): its six files, `backend/sattleme-plugin.js` (the
   whole plugin, about 645 KB: note whether the code panel takes it in one paste, and how long it
   takes), the payment provider's two, `http-functions.js`, `events.js` and `jobs.config`, with the
   staging integration's key. A site with an earlier build's files (a folder
   `backend/sattleme-checkout/`, or a file `backend/sattleme-checkout.js`): delete them first.
   **Before each paste, check which file is open**: the plugin's file and the payment provider's
   `sattlemeCheckout.js` sit side by side, and a paste once went into the wrong one (measured).
   **Before publishing, check each file against `SHA256SUMS`** (the pasted text saved to a file,
   then `sha256sum`), and again after reloading the editor: the editor once typed stray keystrokes
   at the top of three files (measured). Note any file that differed.
2. Publish. The code panel shows no error at all, of Wix's linter or of its type checker (the
   payment provider's file, `http-functions.js` and `events.js` import `sattleme-plugin.js`,
   which imports Wix's modules, `@wix/ecom`, `@wix/essentials` and Node's own modules: `events`,
   `http`, `https`, `net`, `tls`, `crypto`, `stream`, `url`, `zlib`, `buffer`, `util`,
   `querystring`). If it shows some, note each (file, line, message), then **Publish with
   errors**. The site's history (from the editor's Site menu; in French
   "Historique du site") then lists the publication: note its time. Click **Publish** once: Wix
   confirms nothing, and each click makes one publication in the site's history (measured on 23
   November 2026); the site's logs show a publication only while they are open.
3. **Before the status page**: **Accept Payments → sattle.me Checkout → Connect**, with
   `sattleme-checkout-key` in the first field and `15` in the second: refused (Wix shows its own
   message: "A technical problem occurred", measured). The status page, opened next, says the last
   connection was refused (`SITE_ADDRESS_UNKNOWN`).
4. Open `https://<site>/_functions/sattlemeCheckoutStatus`: a form, under the sattle.me logo, which
   says under its field that the token has 32 characters or more (a shorter one is not sent: the
   browser's minlength, without a message, measured). A wrong token of 32 characters: "Wrong token".
   The right one: the page shows the logo, the versions (plugin, SDK and specification 1.0.0) and
   the Node.js version the site's backend runs (note it: Wix does not document it; v18.17.1 when
   measured in October and on 23 November 2026), the business, its bounds and its lot, "Customers'
   payment page" with the site's address, and "The job has not run yet" or the job's last runs. It
   says its times are in the site's time zone, the one **Settings → General Info** shows: note it,
   and check one time against the clock. In the CMS, the collection `SattlemeCheckout` has an item
   `site`, with that address.
5. **Accept Payments → sattle.me Checkout → Connect.** Two fields: note how Wix shows their labels.
   First, in the first field, type what looks like a key (`sattleme_ck_test`: never the real key,
   which stays in the Secrets Manager), then another name: each is refused (Wix shows its own
   message: "Cannot connect. Check your credentials…", measured), and the status page says the last
   connection was refused (`KEY_TYPED`, then `SECRET_NAME`). Then type `sattleme-checkout-key`, and
   in the second field `61`, then `abc`: each is refused (`MINUTES_TO_PAY`; Wix: "A technical
   problem occurred"). Then enter `15`: Wix says the account is connected and shows its name masked;
   the status page no longer says a connection was refused, and says "15 minutes to pay". Place an
   order: it gets its payment page. In the logs, note each line "connected in … ms (language …, key
   …, merchant …, records …)" and "connection refused: …, after … ms"; if Wix reports a technical
   problem, note the time, then connect again. To connect again after publishing, when the fields
   already hold their values, Wix shows **Save** only once a field changed: add a space at the end
   of the first one (the plugin ignores it).
6. **The job.** Within the hour, at minute 17 (Wix's documentation: "within 5 minutes of the
   specified time"), the status page lists the job's run, with no error. During the tests, note
   when each run started, and its counts (checks, errors, left for the next run).
7. **Developer Tools → Logs**, during all the tests below: no line holds the key (`sattleme_ck_…`)
   or the status token; the plugin's lines start with `[sattleme-checkout]`. Wix Data's errors on
   `lock-…` items and on items that do not exist are expected, and so is Node 18's
   `MaxListenersExceededWarning` (README, [Troubleshooting](../README.md#troubleshooting)): note
   how many of each. Wix's live logs stop showing new lines without notice (measured): reload
   them before each test.

## The payment page

Measured in part with 1.0.0's sources on 23 November 2026 (its headers, README, "What was measured
on Wix"): check each point, on a computer and on a phone, and note what differs.

1. **What it shows.** Place an order (a product in the cart, checkout, the method "Bitcoin
   (Lightning / on-chain)", in a private window, as a customer): Wix sends the browser to
   `https://<site>/_functions/sattlemeCheckoutPay?o=…&k=…`. The page shows the sattle.me logo,
   "Pay with Bitcoin" (or the order's language: French, German, Italian), the amount in sats and
   in the order's currency, the time left, a QR code, "Open in my wallet", the Lightning invoice
   and, from 1 000 sats, the deposit address, then the "Check the payment" button.
2. **The stylesheet** (`/_functions/sattlemeCheckoutStyle`), from the site's own origin: the page
   is laid out in one column, the text in a sans-serif font, the wallet's link an orange button,
   the QR code no wider than the screen on a phone. If the page is unstyled, open the
   stylesheet's address: note whether Wix serves it (its text, `text/css`), and the browser's
   console (a Content-Security-Policy message?). The page must work unstyled too.
3. **The meta refresh.** The time left goes down by about 10 s every 10 s, without a click; the
   browser's network panel shows a request for the page every 10 s. Note whether it does on each
   browser (desktop and phone). If it does not, the "Check the payment" button reloads the page.
4. **The QR code**: a Lightning wallet scans it from the computer's screen and offers to pay the
   amount; an on-chain wallet (an amount of 1 000 sats or more) reads the address and the amount.
   On the phone, "Open in my wallet" opens the wallet with the payment.
5. **Copy**: the invoice and the address are text in their own boxes: select one (inside its box,
   Ctrl+A or Cmd+A selects that box alone; on a phone, a long press, then "Select all"), copy it,
   and paste it in a wallet: it is taken as it is.
6. **Nothing from elsewhere**: the browser's network panel lists the page and its stylesheet only,
   both from the site's address; its console shows no blocked script or style of the plugin's
   (Wix's own, if any, note them).
7. **An address altered**: change one character of `k` in the address: "This link is not valid",
   nothing else; the same for `o`.
8. **In a frame**: in the browser's network panel, the page's response headers: note its
   `Content-Security-Policy` (measured on 23 November 2026: Wix's own, without the plugin's
   `frame-ancestors 'none'`) and whether `X-Frame-Options: DENY` is there. Then open, from a local
   file or another site, a page whose `iframe` has the payment page's address as its `src`: the
   browser refuses to show it in the frame (its console says why). Note what each browser does.

## Payments

For each: a product in the cart, checkout, the method "Bitcoin (Lightning / on-chain)", in a
private window, as a customer.

1. **Lightning, on the page.** Before paying, wait a minute on the page: the order's page in the
   dashboard (by its direct link) shows its payment as "Bitcoin (Lightning / on-chain)" pending, no
   longer "Paid offline" (the plugin's pending event, at the page's first view: note how long after
   the click it showed). Pay from a Lightning wallet. Within 10 s the page sends the customer to
   Wix's thank-you page. In the dashboard the order is **Paid**, in **Orders** with a number, with
   a comment "sattle.me: paid", the method Lightning and the preimage. The merchant's app shows
   the sale ("Wix …", the invoice's note). In the CMS, after the job's next run, the payment's
   `recorded` holds `state: "yes"` and `paymentStatus: "PAID"`: the plugin read the order back,
   and Wix showed it paid.
2. **On-chain** (an amount of 1 000 sats or more). Pay the exact amount on-chain. At the page's
   next view the order is pending (number 0, not in **Orders**), and the page says the payment is
   being confirmed, with its confirmations, every 30 s, and a link back to the shop (Wix's
   pending page). Stay on the page: after 3 confirmations (about 30 minutes), within 30 s, it
   sends the customer to the thank-you page; the order is **Paid**, in **Orders**, with a comment
   with the transaction. Then again with another order, leaving the page once the payment is being
   confirmed: the order turns **Paid** at the job's first run after the third confirmation. In
   the CMS, the payment's item has `confirmations: null` once paid.
3. **Paid in part, then the rest.** Pay about half on-chain. At the page's next view the page
   shows what was received and the rest, with its QR code: on-chain, and Lightning once the rest's
   invoice is made (note after how many views it showed). Pay the rest in Lightning. Once the
   on-chain part is confirmed: **Paid**, a comment with the transaction and the preimage of the
   rest.
4. **Paid in part, then expired.** Pay part on-chain, then nothing, and stay on the page: after
   the time to pay it says the time is over; about 2 minutes later it says "Payment incomplete":
   what was received of what was due, that the order is not paid and that the shop settles it,
   with "Back to the shop" (Wix's pending page), and no QR code, invoice, address nor button to pay
   again. Open the page's address again later: the same. The order stays pending (not in
   **Orders**), with:
   - a comment (received, due, the amount for the order's price, the rate and its source, the
     address);
   - a task, on the customer's contact card ("Tasks & Reminders") and with the dashboard's
     search: due now, linked to the customer, its title with the invoice's note, what was received
     of what was due, and what to do; the status page's "Task" column says "made";
   - a notification to the site's owner (logged in as the site's owner, not a collaborator): in
     the dashboard's bell (top of the dashboard), its text "Order …: underpaid, invoice expired.
     Details in the dashboard's task and on the status page." with a link to the status page; in
     the Wix app, signed in as the owner, its push and its notifications list, titled "Bitcoin
     payment needs you". Note where it showed, or that it did not, and the owner's settings in
     **Notification Preferences** (Dashboard) and in the app (Notifications → More Actions →
     Manage notifications); in the CMS, the payment's `report.notice` says `done` once Wix took
     the call, shown or not (measured on 23 November 2026: `done`, nothing in the bell; the app
     not checked);
   - on the status page, a line under "Payments that need you", with its Wix order id and its
     deposit address, which opens on mempool.space.
5. **Within the merchant's tolerance** (set it in the app, for example 5 %): pay 97 % on-chain. The
   page says the payment is being confirmed; once confirmed, the order is **Paid**, and its comment
   says the payment was accepted by the business in its sattle.me app. The same for the
   merchant's acceptance: pay 50 % on-chain, then accept the sale in the app before the invoice's
   end.
6. **Expired, nothing paid, the page left.** Close the page. The order stays pending until the
   job's first run after the time to pay plus 2 minutes, which declines the payment: no comment,
   no task; the order never shows in **Orders**. By its direct link, the order says "Payment
   declined" ("Paiement refusé"), its payment line "Bitcoin (Lightning / on-chain)" declined, with
   the transaction's id (measured with the earlier build). If it stays pending, note it, with its
   item in the CMS (`transactions`, `sent`, `sentAt`), and whether another order of the same cart
   was placed before its first event. Open the page's address again: Wix's error page.
7. **Paid after leaving the page.** Scan the QR code with a Lightning wallet, close the page, then
   pay. The order stays pending until the job's next run (within the hour), which approves it:
   **Paid**, with its comment. Note the time between the payment and **Paid**.
8. **Canceled while pending.** Pay part on-chain (the order is pending) and try to cancel the order
   in the dashboard: Wix greys the action out (measured). If Wix lets you cancel it, pay the rest:
   the order is not approved; it gets a comment with the proof, a task and a notification, and the
   page sends the customer to Wix's pending page.
9. **Refund.** In the paid order, try a refund through this payment method: refused, with Wix's
   own message; the order stays paid.
10. **Two orders of one cart.** Place an order, wait on its page (its order's page shows "Bitcoin
    (Lightning / on-chain)" pending), then place the same cart again, in another tab: two Wix
    orders, each with its own invoice and its own page (README,
    [Known limits](../README.md#known-limits)). Pay the first on its page: it is **Paid**, with
    one payment line, no "Paid offline" left, and, after the job's next run, its `recorded` is
    `state: "yes"` in the CMS; the second's invoice expires unpaid and is declined at a run after.
    Note each order's page. (With the earlier build, which sent the pending event 40 to 50 s after
    the click, an order whose cart was placed again before it kept a "Paid offline" line: 7 of 7.)
11. **The order's payments.** On the page of each order of the tests above, note its payment lines
    (method, amount, state), before and after the plugin's first event (its pending event, at the
    payment page's first view): "Paid offline" until then, then "Bitcoin (Lightning / on-chain)"
    with the transaction's id, which is the payment's reference followed by `.1` (`.2` for a second
    attempt): note where Wix shows it, and whether it is whole. In the CMS, note how many entries
    the payment's `transactions` holds, with each one's `wixTransactionId`, `sent`, `at` and
    `answer` (the answer given to Wix: the payment page's address, never `null` once the order
    got its page), and, once paid, its `recorded` (`state`, `lookups`, `paymentStatus`). In the
    logs, note each line "a transaction answered in …", "Wix asked again for a transaction" and
    "Wix did not record paid order …", and on the status page any `TRY_AGAIN` under "Payments
    refused".
12. **Locks.** In the CMS, an item `lock-<its _id>-<n>` exists for a payment only while a check
    of it runs (a released one, `active` false, after a write of Wix Data failed); between two
    checks, and once the payment's item has `active` false (settled, and nothing left to tell Wix
    or to read back), none. Open the payment page in five tabs at once: the logs show at most one
    "already exists" error per tab, and the page shows the same check in each. Note what you see
    on an order left unpaid until declined, and on a paid one.
13. **The time to pay.** In **Accept Payments → sattle.me Checkout → Manage**, set the second
    field to `5` and save: the status page says "5 minutes to pay". Place an order: its page
    counts down from 5 minutes, then says the time is over; about 2 minutes later it sends the
    customer to Wix's error page, and the payment is declined. Set the field back to `15` and
    save.
14. **An order edited.** Place an order and wait on its payment page; open the order in the
    dashboard by its direct link and try **More Actions → Edit order** (change a price, or add an
    item). Note whether Wix lets you, and what the order shows. If it does, pay the invoice: the
    order is not marked paid; it gets a comment with what was received and its total now, a task
    and a notification ("paid, the order's total changed" on the status page). Note what the
    dashboard offers then to complete the order (mark it paid, request the difference).
15. **The comment of a paid order.** On the order paid on-chain (test 2), the comment gives the
    amount in sats for the order's price, the rate and its source (CoinGecko or Coinbase), the
    deposit address, and the transaction as a link to mempool.space, which opens it. On the order
    paid in Lightning (test 1), it gives the amount and the preimage, and no "Received: 0".
16. **Overpaid on-chain.** Pay about 10 % more than the amount on-chain. The page says the payment
    is being confirmed; once confirmed, the order is **Paid**, and its comment gives what was
    received (more than the amount) and no line of acceptance. The surplus is in the merchant's
    wallet: the app refunds it, if the merchant chooses to.
17. **On-chain in two transactions.** Pay about 60 % on-chain, then, from the page's rest (its QR
    code's on-chain part, or the address), the rest on-chain in a second transaction, both before
    the invoice's end. The page shows the rest after the first, then the payment being confirmed;
    once both have 3 confirmations, **Paid**, the comment listing both transactions.
18. **The wallet link, on a phone.** On a phone, place an order and pay it with "Open in my
    wallet" (a Lightning wallet, then, for another order of 1 000 sats or more, an on-chain one):
    the wallet opens with the amount; once paid, the page, back in the browser, sends the customer
    to Wix's thank-you page (or says the payment is being confirmed), and the order is **Paid** as
    in tests 1 and 2.
19. **One invoice at a time.** On an order's payment page, note its invoice; open the page's
    address in a second tab, and reload the first: the same invoice and the same address in each
    (never a second one for the order). Then go back in the browser to Wix's checkout and place
    the order again: note whether Wix makes a new order (a new Wix order id, its own invoice, its
    own page; the first order's invoice still payable until its end, README, Known limits, "One
    invoice per Wix order") or calls the plugin again for the same order (the same invoice, its
    item in the CMS with a second transaction, `.2`). Pay one of them only, and let the other
    expire: the paid one is **Paid**, the other declined.
20. **The merchant's Bitcoin node**, if the staging merchant's app lets it name one. A node of the
    Internet (`https`, a name): pay an order on-chain; it is **Paid** as in test 2, its invoice
    made with an address. A node on the merchant's own network (`http://192.168.…`, `.local`),
    which Wix's servers cannot reach: with its fallback "mempool", an order of 1 000 sats or more
    still gets an address and is paid as in test 2; with "none", the invoice is Lightning only
    (the status page's "Warnings" counts it), and an amount payable on-chain only is refused
    (`TRY_AGAIN`, under "Payments refused"). Set the merchant's app back as it was.

## Failures

1. **No key.** Remove the secret `sattleme-checkout-key`: a checkout is refused at once (the
   customer sees Wix's message); the status page says "No key in the Secrets Manager" and lists
   `KEY_MISSING` under "Payments refused". Put it back: the next order gets its payment page.
2. **Integration removed.** In the app, remove the integration: a checkout is refused; the status
   page lists `INTEGRATION_REMOVED`. Connect again (**Manage → Save**): refused, and the status
   page says the last connection was refused. Make a new integration and save its key in
   `sattleme-checkout-key`, then connect again (**Manage → Save**) until it succeeds: the status
   page no longer says a connection was refused, and the next order gets its payment page.
3. **The site's address unknown.** In the collection `SattlemeCheckout` (CMS), delete the item
   `site`: a checkout is refused (`SITE_ADDRESS_UNKNOWN`, under "Payments refused"). Open the status
   page again: the item is back, and the next order gets its payment page.

## Privacy

1. **A contact deleted.** Note the contact of the customer of the order paid on-chain (test 2):
   in the CMS, its payment's item has a `contactId`, and its `data` holds the deposit address and
   the transaction. In the dashboard, **Contacts**, delete that contact. In the logs: "a contact
   was deleted: 1 of its 1 payment(s) erased". In the CMS, the payment's item has `contactId`
   empty, `erased` set, and none of the address, the payment URI, the Lightning invoice
   (`bolt11`), its `verifyUrl`, the transaction, nor the payment page's address (the
   transactions' `answer` holds `page: true`, no `redirectUrl`); its reference, amounts, rate,
   state, method, payment hash and preimages are still there (measured on 23 November 2026, before
   its fix: `bolt11`, `verifyUrl` and the page's address were left). The order's comment is unchanged (Wix's). The order's
   payment page sends to Wix's success page, and shows nothing of it.
2. **A contact deleted while its payment is being confirmed.** Pay a new order on-chain and,
   while it waits for its confirmations, delete the customer's contact: the logs say "a contact
   was deleted: 0 of its 0 payment(s) erased" (the plugin learns an order's contact once it is
   paid). Once the payment is paid, its item has lost the address and the transaction, `erased`
   set; the order's comment "sattle.me: paid." says the payment's data was erased at the
   customer's request, and holds neither the address nor the transaction (measured on 23 November
   2026, before its fix: it held both).
3. **Contacts merged.** Merge a customer's contact (with a paid order) into another: no erasure in
   the logs; the payment's item's `contactId` is the contact kept.

At the end, the status page's "Warnings": an invoice of 1 000 sats or more made without an
on-chain address, if any, is counted there, with the last one's reference.

## What to send back

The list above, each with: passed or not, the order's number or Wix order id, the time, and what
was seen when it differs; for the payment page, a screenshot on a computer and on a phone. With
the status page's "Background checks" table at the end.
