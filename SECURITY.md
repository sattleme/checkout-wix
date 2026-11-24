# Security

This repository holds sattle.me Checkout for Wix: the files of a payment provider that a Wix site
runs to take Lightning and on-chain payments for a sattle.me merchant. A flaw here could let an
attacker mark an order paid that is not, be paid instead of the merchant, or learn a key, a token
or a customer's order: please report it **privately**, never in a public issue, pull request or
discussion.

## How to report

- On GitHub: **Security** tab of this repository → **Report a vulnerability** (private
  vulnerability reporting).
- Or by email: security@sattle.me, subject starting with `[security] checkout-wix`.

Please include what you found, the version of the plugin (its status page shows it), and, when
you can, the steps or the input that show it. Do not test against real merchants' sites, funds or
keys.

## What is in scope

- This repository's code, used as its README says: the plugin's files as a Wix site gets them, the
  build of its SDK bundle, its workflows. A way to have an order marked paid without a payment, to
  leak the integration key or the status page's token, or to reach another host than the
  merchant's relays and the services the protocol names.
- A flaw in the SDK it bundles goes to
  [sattleme/checkout-node](https://github.com/sattleme/checkout-node/security), and one in the
  protocol itself (a rule of `SPEC.md` that, followed as written, is unsafe) to
  [sattleme/checkout-spec](https://github.com/sattleme/checkout-spec/security), through the same
  channels.

We will acknowledge your report, keep you informed, and credit you when the fix is published,
unless you prefer otherwise.
