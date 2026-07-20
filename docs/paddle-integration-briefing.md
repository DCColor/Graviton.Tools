# Paddle Live-Integration Briefing — graviton.tools Standalone Checkouts

*Prepared from lessons learned during the Scope (tryscope.studio) Paddle integration, July 2026. Hand this to whoever is building the graviton.tools product checkouts.*

---

## Context

- **Account:** Amigo Media LLC / graviton.tools Paddle account is **fully verified and live** (business identity, domain, and payouts all approved).
- **Products:** Already built in the live Paddle catalog (GradeShare, Manifold, Flip, Scaffold = one-time/perpetual; Scope = subscription).
- **This project's model:** Standalone, **accountless** product checkouts launched directly from graviton.tools. No login, no user account to reconcile a payment against. This is *simpler* than the Scope flow — see "How this differs from Scope" below.

---

## The environment gotchas (these cost hours in the Scope project — do NOT repeat them)

These are the highest-value items in this doc. Every one of them caused a silent failure that only surfaced during live payment testing.

### 1. `Paddle.Environment.set()` accepts only `"sandbox"` or `"production"` — never `"live"`
Paddle.js recognizes exactly two environment names: `sandbox` and `production`. If you use `"live"` as an internal label anywhere (env var, config), you **must translate it to `"production"`** before passing it to `Paddle.Environment.set()`.

Passing `"live"` makes Paddle.js try to resolve `live` as a hostname, and checkout dies with:
> "live's server IP address could not be found."

Keep one translation helper in a single file; don't sprinkle the raw string around. Example:
```js
// Our internal label may be 'live'; Paddle.js needs 'production'.
export const PADDLE_JS_ENV = MY_ENV === 'live' ? 'production' : 'sandbox'
// ...
window.Paddle.Environment.set(PADDLE_JS_ENV)
```

### 2. Build-time env vars are inlined at BUILD time, not runtime
If this project builds locally and uploads the output (rather than having Cloudflare build from a connected Git repo), then **the Cloudflare Pages dashboard environment variables are IGNORED** — the build reads local `.env` files on the machine doing the build.

- Put the live Paddle client token + env in the **local** `.env.production`.
- Watch for `.env.local`: in Vite, `.env.local` **overrides `.env.production` even during a production build**. A stale `.env.local` with sandbox values will silently win. If you build locally and never run a local dev server, the cleanest setup is to not have a `.env.local` with production-relevant keys at all.

### 3. Verify the environment actually flipped BEFORE testing a payment
After deploying, hard-reload the site and run this in the browser console:
```js
window.Paddle.Environment.get()
```
It must return **`production`**. This single check would have prevented the entire Scope debugging session. Do it every time you change env config.

### 4. Client token vs. secret API key — know which is which
- The **frontend** uses the Paddle **client-side token** (`live_...`). It is *publishable* — it ships in the browser bundle and is safe to expose.
- The **secret API key** and **webhook secret** are backend-only. They must never appear in frontend code. (A pure client-side checkout may not need them at all — see fulfillment below.)

### 5. Domain approval + default payment link
- `graviton.tools` is an **approved checkout domain** and the account's default payment link is set. Checkouts launched from graviton.tools will work.
- Launching a checkout from an **unapproved** domain/subdomain fails. Subdomains are approved individually, not inherited.

### 6. Price IDs are environment-specific
Sandbox and live have **different** `pri_` IDs. Use the **live** price IDs from the live catalog in production config. Never assume a sandbox ID works in live.

---

## How this differs from the Scope flow (do NOT copy Scope blindly)

Scope uses a **backend-created transaction**: a Cloudflare Worker creates the Paddle transaction with `custom_data.user_profile_id` attached, then the frontend calls `Paddle.Checkout.open({ transactionId })`. This exists so the webhook can reconcile the payment back to a logged-in Clerk user.

**Standalone graviton products don't need any of that.** There's no user to reconcile to. Use the simpler **price-based client-side checkout**:
```js
Paddle.Checkout.open({
  items: [{ priceId: 'pri_...live...', quantity: 1 }],
  customer: { email }, // optional prefill; overlay collects it otherwise
})
```
No worker, no transaction pre-creation, no reconciliation-by-user — *unless* you need post-purchase fulfillment (see below).

---

## Name / email capture

Paddle's checkout needs a customer email. You have two options:

- **Simplest (recommended for a straight sale):** don't build a pre-capture form. Pass `customer: { email }` if you have it, or just let Paddle's overlay collect the email itself. The overlay handles name/email/address.
- **Pre-capture (only if you want the lead before checkout, e.g. abandoned-cart):** collect + validate the email client-side, then pass it into `Checkout.open` so the customer doesn't retype it. Don't build a form that duplicates or fights Paddle's own fields.

If using Joey's JS cart template, the integration point is: on "buy," call `Paddle.Checkout.open(...)` with the item(s) — let Paddle own the customer-detail collection inside the overlay.

---

## Other gotchas specific to standalone product checkouts

### Success handling — prefer the event callback over a redirect URL
Scope hit a bug where a `successUrl` pointed at a route that had to exist. For a cart, the cleaner approach is to **handle success via Paddle's checkout event callback** and show your own confirmation inline — no redirect, no dead-route risk.
```js
Paddle.Initialize({
  token: PADDLE_CLIENT_TOKEN,
  eventCallback: (event) => {
    if (event.name === 'checkout.completed') {
      // show your own "thank you" UI, trigger fulfillment, etc.
    }
  },
})
```
If you *do* use a `successUrl`, it must be a real, existing page on the approved domain.

### Perpetual vs. subscription products behave differently
- One-time products (GradeShare, Manifold, Flip, Scaffold) emit **`transaction.completed`** only — no `subscription.*` events.
- Subscription products (Scope) emit the `subscription.*` lifecycle. Don't write post-purchase logic that assumes subscription events for a one-time product.

### Fulfillment / license delivery — the big architectural decision
This is the question standalone products raise that Scope did not: **after someone buys a product, how do they receive it?** (License key? Download link? Activation email?)

- If Paddle's automatic receipt email is enough, you may need **no backend at all** — pure client-side checkout.
- If you must deliver a license key or gated download, you need a **backend webhook** listening for `transaction.completed` to generate + email the license. That means this project *does* need a worker/webhook handler and the secret webhook signing key — unlike a pure "take the money" checkout.

**Decide this per product before building**, because it determines whether the project is frontend-only or frontend + webhook backend.

### Tax & address
Paddle is Merchant of Record and handles tax. It may collect a billing address in the overlay for some products/regions. Let the overlay do it; don't build a custom address form that competes with Paddle's.

---

## Pre-launch checklist for each product checkout

- [ ] Live `pri_` price ID (from live catalog) wired in — not a sandbox ID.
- [ ] `Paddle.Environment.set('production')` (translated from any internal 'live' label).
- [ ] `window.Paddle.Environment.get()` returns `production` in the deployed site's console.
- [ ] Client token is the `live_...` publishable token; no secret keys in frontend.
- [ ] Checkout launches from the approved graviton.tools domain.
- [ ] Success handled via event callback (or a real, existing successUrl).
- [ ] Fulfillment path decided (receipt-only vs. webhook-driven license delivery).
- [ ] One real card test payment end-to-end, then refunded.

---

*Questions on the Scope-side implementation can reference that project; but remember the standalone flow is deliberately simpler — resist importing Scope's backend-transaction + reconciliation machinery unless a product genuinely needs post-purchase fulfillment.*
