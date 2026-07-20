# Graviton.tools — Cart, Checkout & Fulfillment Build Plan

*Planning doc. Written after auditing Joey's Retrograde cart/checkout/fulfillment
implementation (studied locally, not committed) and cross-checking against
`docs/paddle-integration-briefing.md` (lessons from the Scope integration).*

*Status when written: Paddle account fully approved. NOT blocked on Paddle —
blocked on (1) finishing the apps to a shippable state, and (2) the redesign
off the temporary site. Pick this up when both are moving.*

---

## 0. TL;DR — the shape of the work

Three pieces, built in this order:

1. **Cart front-end** (static HTML/CSS/JS) — a right-side drawer, localStorage
   state, delegated add-to-cart, Paddle overlay checkout. Pure client-side.
2. **Fulfillment backend** (Cloudflare Worker/Function + webhook) — verifies the
   Paddle webhook, generates license keys, emails the buyer their key +
   download link. Required, because our desktop apps deliver license keys.
3. **Single source of truth for product data** — price IDs, Paddle IDs, icons,
   downloads all live in ONE place (the content workbook → a generated data
   file), never hardcoded in two places.

The cart is the easy half. The fulfillment backend is the real engineering, and
it's where the money and the license security live.

---

## 1. Decisions already made (don't re-litigate)

These were settled by the audit + briefing. Bank them.

- **Checkout type:** Paddle.js v2, **overlay** (`Paddle.Checkout.open(...)`).
  Not hosted redirect, not inline. Matches the drawer UX and keeps buyers on
  graviton.tools.
- **Accountless / price-based checkout** for standalone products. Pass
  `items: [{ priceId, quantity }]` directly. Do NOT copy Scope's
  backend-created-transaction + user-reconciliation machinery — that exists to
  tie a payment to a logged-in Clerk user, which standalone products don't have.
- **Success handling:** the `checkout.completed` **event callback** (clear cart,
  close drawer). No `successUrl` redirect (avoids the dead-route bug Scope hit).
- **Environment:** explicit `Paddle.Environment.set('production')` **and** verify
  `Paddle.Environment.get()` returns `production` on the deployed site.
  ⚠️ This OVERRIDES Joey's approach — his code never calls `Environment.set()`
  and relies on the `live_` token prefix. That works in Paddle.js v2, but our
  briefing's #1 gotcha (and our local-build-then-upload workflow) makes the
  explicit set-and-verify the safe path for us. Do it our way, not his.
- **Client token:** the `live_...` **publishable** token ships in the browser
  bundle — that's fine, it's designed to be public. Secret API key + webhook
  signing secret stay backend-only (Worker env vars / secrets), never in
  front-end code.
- **Fulfillment path:** our desktop apps (GradeShare, Manifold, Flip, Scaffold)
  MUST deliver a license key, so we need the **webhook backend** — not the
  receipt-only path. Scope stays subscription (separate flow, already built).

---

## 2. Decisions still OPEN (make these before building)

- **Pre-capture name/email form in the drawer — yes or no?**
  - Joey does it: required name+email fields in the drawer, validated before
    opening Paddle.
  - Our briefing recommends against it: let Paddle's overlay collect the email;
    only pre-capture if we specifically want the lead for abandoned-cart.
  - Trade-off: pre-capture gets you the lead even if checkout is abandoned, and
    prefills the overlay — at the cost of extra friction and duplicating
    Paddle's own fields.
  - **Recommendation:** skip pre-capture for v1 (lower friction, less to build,
    matches briefing). Add it later only if abandoned-cart recovery becomes a
    priority. Decide before building the drawer footer.

- **Cross-sell ("You might also like") — include at launch?**
  - Joey has bespoke per-catalog rules (has DyePrint → suggest Flora, etc.).
  - Nice for AOV, but every rule is catalog-specific and it's extra scope.
  - **Recommendation:** ship the cart without it first; add a simple,
    data-driven version later (e.g. "customers also bought" or a manual
    `relatedProducts` field per product in the data source). Don't hardcode
    rules the way Joey did.

- **Which products are cart-enabled at launch?** Only ones that are actually
  shippable. Coming-soon apps keep their "Coming Soon" state, no buy button.

- **License model per app** — confirm expiry/rental vs. perpetual. Our apps are
  perpetual + 4-machine limit (no expiry), unlike Joey's 31-day Luminary rental.
  So our license payload sets no-expiry by default. Confirm per app.

---

## 3. Single source of truth (do this FIRST, it prevents Joey's mistake)

Joey duplicates price IDs (in `_data/products.js` AND hardcoded again in
`cart.js`) and duplicates his keygen (shared `_lib` modules but Luminary inlined
in the webhook). **Do not inherit this.**

Our canonical product data lives in the **content workbook**
(`redesign/graviton-content.xlsx`). Add a **`Paddle price ID`** column there now
(one per product). When building, that data becomes a single generated file the
cart reads — e.g. `web/data/products.json` (or a small JS module):

```
{
  "gradeshare": { "name": "GradeShare", "price": "$49", "priceId": "pri_live_...",
                  "icon": "assets/gradeshare_128x128.png", "type": "perpetual" },
  "flip":       { "name": "Flip",       "price": "$99", "priceId": "pri_live_...", ... },
  ...
}
```

Rules:
- Price IDs appear in **exactly one** place. Buy buttons and the cart both read
  from this file. The webhook maps `priceId → product/fulfillment` from the same
  source (or a server-side mirror generated from it).
- **Live** `pri_...` IDs only in production config. Sandbox IDs are different —
  never assume a sandbox ID works live (briefing gotcha #6).
- Icons, names, prices, download R2 keys, and license-prefix all hang off this
  one record per product.

---

## 4. Front-end cart — what to build

Stack: hand-written static HTML/CSS/JS in `web/` (no Eleventy — Joey's `.njk`
templates are his stack, not ours; we hand-author or generate buy buttons).
Reusable *pattern* from Joey, our own code.

**Cart state**
- `localStorage` key (e.g. `gv-cart`), a JSON array of
  `{ priceId, name, price, icon }`.
- In-memory array mirrors it; `loadCart()` / `saveCart()` sync the two.
- Persists across pages and reloads.
- **Dedupe by `priceId`** — re-adding an item already in the cart just opens the
  drawer (no dupes). Quantity is always 1 (software licenses — no qty control
  needed unless we ever sell multi-seat packs).

**Add-to-cart buttons (data-attribute driven)**
- Buttons carry `data-add-to-cart data-price-id data-product-name
  data-product-price data-product-icon`.
- A **single delegated listener on `document`** catches clicks — so buy buttons
  work anywhere (product pages, and any future in-drawer cross-sell).
- Progressive enhancement: render buttons disabled, enable once JS loads (so a
  no-JS visitor never sees a dead button).

**Drawer UI**
- Right-hand drawer (~360px; full-width under 640px) + overlay.
- Open/close toggles a class, sets `aria-hidden`, locks body scroll.
- Closes on: overlay click, × button, Escape key.
- Floating cart button (bottom-right), hidden until cart is non-empty, with a
  count badge.
- Line items: icon, name, price, per-row remove (×).
- Empty state message.
- Totals: client-side sum + a static "Plus applicable taxes" note (Paddle
  computes real tax).
- Footer: "Checkout with Paddle" + "Clear cart". (Name/email fields only if we
  decide on pre-capture — see §2.)
- **Brand styling:** near-black surfaces, our red accent (not Joey's blue),
  Space Grotesk / IBM Plex Mono, matching the card + button treatments already
  in the redesign. Reference Joey's structure, not his look.

**Checkout handoff**
```js
Paddle.Initialize({ token: PADDLE_CLIENT_TOKEN, eventCallback });
Paddle.Environment.set('production');           // explicit — our way
// verify Paddle.Environment.get() === 'production' after deploy
Paddle.Checkout.open({
  items: cart.map(i => ({ priceId: i.priceId, quantity: 1 })),
  // customer: { email, name }  // only if pre-capture is enabled
});
```
`eventCallback` → on `checkout.completed`: clear cart, close drawer, reset any
fields.

---

## 5. Fulfillment backend — the real engineering

This is required because desktop apps deliver license keys. Cloudflare
Worker/Function + KV + R2 + Resend, mirroring the *ordering* of Joey's webhook
(that ordering is the valuable, transferable lesson).

**Webhook: `POST /api/paddle-webhook`**
1. **Verify signature.** Read `Paddle-Signature` header, parse `ts` + `h1`.
   Reject if `|now − ts| > 300s`. Recompute HMAC-SHA256 over the string
   `` `${ts}:${rawBody}` `` using the webhook secret (Web Crypto
   `crypto.subtle`), constant-time hex compare. **Use the raw request text**,
   not re-serialized JSON — re-serializing breaks the HMAC.
2. **Filter events.** Act only on `transaction.completed`. One-time products
   emit only this (no `subscription.*`). Everything else → return `{ok:true}`
   immediately.
3. **Idempotency.** Key on `txnId` in KV (e.g. `ORDER_RECORDS.get(txnId)`) — if
   present, no-op. A **single KV `put` is the commit anchor**; build all
   fulfillment in memory *before* it.
4. **Customer lookup.** Transaction webhooks don't embed the customer — call the
   Paddle API `/customers/{id}` (sandbox vs prod base URL by env) with the
   secret API key to get email + name.
5. **Fulfill, then email in `waitUntil`.** Generate license(s) / download
   token(s), then fire the email + any list-add + follow-up inside
   `waitUntil(...)` with `.catch` logging — **non-blocking**, so the endpoint
   never 500s after the KV commit (a 500 makes Paddle retry, which would
   re-trigger fulfillment). This is a hardening detail our briefing currently
   lacks — see §7.

**License generation (per desktop app)**
- Ed25519-signed binary payload, base64url-encoded, with a per-product 4-char
  prefix (e.g. `GRSH-`, `MNFD-`, `FLIP-`, `SCAF-`).
- Payload template (from Joey's, adapt): `[version][flags][issued days
  BE32][expiry days BE32][nonce]` + optional length-prefixed email + orderId.
  Flags bitfield for hasExpiry / hasEmail / hasOrderId (skip the linux flag
  unless relevant).
- **Our apps are perpetual + 4-machine limit → set no-expiry** (unlike Joey's
  31-day rental). Machine-limit enforcement is app-side (matches how our apps
  already do Ed25519 offline verification).
- Private keys: hex-encoded PKCS8 in **Worker secrets** (one per app, e.g.
  `GRADESHARE_PRIVATE_KEY`), imported at runtime via
  `crypto.subtle.importKey('pkcs8', …, {name:'Ed25519'}, false, ['sign'])`.
  **Never in the repo.** (`.gitignore` already blocks `**/*.key` /
  `**/private.key` — keep it that way.)
- **Keep the keygen in ONE module.** Don't inline a per-product copy in the
  webhook the way Joey did with Luminary.

**Download delivery (gated installers, if we gate them)**
- `createDownloadToken()` → write to KV: `{ name, r2Key, email, orderId,
  expires: now+72h, downloadsUsed:0, maxDownloads:5 }` with a matching 72h TTL.
- Download proxy `GET /api/download/:token`: look up token, check expiry (410)
  and usage ≥ max (410), fetch object from R2, increment `downloadsUsed` +
  rewrite with remaining TTL, stream with proper `Content-Type` /
  `Content-Disposition` / `Content-Length`. **Never expose R2 directly.**
- Self-serve re-delivery `POST /api/request-download`: buyer submits
  `{ email, orderId }`; find the order, mint fresh download tokens, re-email.
  (Joey scans KV with `.list()` — fine at low volume; index later if needed.)

**Email (Resend)**
- One unified confirmation email covering all line items (key(s) + download
  link(s)).
- Optional: add buyer to a Resend audience, schedule a +3-day follow-up via
  Resend `scheduled_at`.
- `FROM_EMAIL` = something like `orders@graviton.tools`.

**Bindings/secrets to set (Worker):**
- Secrets: `PADDLE_API_KEY`, `PADDLE_WEBHOOK_SECRET`, one
  `*_PRIVATE_KEY` per app, `RESEND_API_KEY`.
- KV: order records, download tokens.
- R2: installers bucket (if gating downloads).
- Config: `PADDLE_SANDBOX` flag for API base URL, `FROM_EMAIL`.

---

## 6. Build sequence (when apps + redesign are ready)

1. **Add the `Paddle price ID` column to the workbook**; fill live `pri_` IDs.
2. **Generate the single product data file** (`web/data/products.json`) from the
   workbook. This is the one source of truth.
3. **Build the cart front-end** against that data (drawer, state, delegated
   listeners, overlay checkout with explicit `Environment.set`). Wire buy
   buttons on the redesigned product pages.
4. **Test checkout in isolation** with a real card, then refund — verify
   `Paddle.Environment.get()` returns `production` in the deployed console
   first (briefing checklist).
5. **Build the fulfillment worker**: webhook (verify → filter → idempotency →
   customer lookup → fulfill → email in `waitUntil`), keygen module, download
   proxy, re-delivery endpoint.
6. **Point the Paddle webhook** at the deployed endpoint; test the full loop
   (buy → webhook → license email → download) end to end with one real
   transaction, then refund.
7. **Launch checklist per product** (from briefing): live `pri_` ID wired,
   `Environment.set('production')` verified, publishable token only in
   front-end, checkout launches from approved graviton.tools domain, success via
   event callback, fulfillment path confirmed, one real card test + refund.

---

## 7. Fold these hardening notes back into the briefing

`docs/paddle-integration-briefing.md` is missing four real-world details the
audit surfaced from Joey's working webhook. Add them:

1. **Idempotency** — key on transaction ID in KV; single `put` as the commit
   anchor; build fulfillment in memory before committing.
2. **Customer API lookup** — transaction webhooks don't embed the customer;
   call `/customers/{id}` with the secret API key to get email/name.
3. **Non-blocking `waitUntil` email pattern** — fire emails/list-adds in
   `waitUntil(...).catch(...)` so a mail failure never 500s the endpoint and
   triggers Paddle retries → duplicate fulfillment.
4. **Environment set-and-verify as a hard checklist item** — Joey's code relies
   on token-prefix inference and would fail our checklist; keep our explicit
   `Environment.set('production')` + `Environment.get()` verification.

---

## 8. Guardrails / don't-repeat

- **Never commit** the `Retrograde Example/` folder, any private key, or the
  secret Paddle keys. (`.gitignore` handles the folder + `*.key`; secrets go in
  Worker secrets, never files in the repo.)
- **Price IDs single-sourced** (workbook → data file). No second hardcoded copy.
- **Keygen single-module.** No per-product inline duplication.
- **Sandbox vs live IDs are different** — live IDs in prod config only.
- **Joey's code is a reference for structure, not a source to lift.** His stack
  (Eleventy/.njk + his catalog + his Paddle IDs + his R2 keys) is his; we build
  our own in our stack with our data.
- Reference for the Scope-side implementation lives in
  `docs/paddle-integration-briefing.md`; remember standalone is deliberately
  simpler than Scope's reconciliation flow.

---

*Next actions when you return: (1) confirm the open decisions in §2, (2) add the
Paddle-price-ID column to the workbook, (3) fold §7 into the briefing. Then work
the sequence in §6 as apps ship and the redesign lands.*
