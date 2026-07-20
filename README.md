# Graviton-Tools

Static site for **graviton.tools** — post-production workflow tools.
Hosted on Cloudflare Pages, deployed via Wrangler. An Amigo Media brand.

---

## Folder structure

```
Graviton-Tools/
├─ web/         ← THE LIVE SITE. Only this folder is deployed to production.
│   ├─ index.html, about.html, privacy.html, terms.html, refund.html
│   ├─ assets/      icons + screenshots used on the pages
│   └─ calc/        BUILT output of the Duration Calculator (see note below)
├─ redesign/    ← New HTML for the site rebuild. Staging sandbox.
├─ worker/      ← Live Cloudflare Worker (form capture). Deployed separately.
├─ calc/        ← SOURCE for the Duration Calculator. Build output → web/calc/.
└─ source/      ← PSDs, .xlsx, raw artwork. NEVER deployed.
```

**Golden rule:** only `web/` (production) and `redesign/` (staging) are ever
deployed as the site. Everything else is source — keep it out of the deploy folder.

---

## Deploy commands

Run from the project root (`Graviton-Tools/`).

```bash
# STAGING — preview the redesign at staging.graviton-tools.pages.dev
wrangler pages deploy redesign --project-name graviton-tools --branch staging

# PRODUCTION — publish the live site at graviton.tools
wrangler pages deploy web --project-name graviton-tools
```

How it works: the **folder** decides *which files* ship; the **`--branch`** flag
decides *which environment*. No flag = production. `--branch staging` = an isolated
preview with a stable URL that never changes as you redeploy. Production is never
touched by a staging deploy.

---

## The rebuild plan (two phases)

1. **Now:** build the new pages in `redesign/`. Deploy it **only** to `--branch staging`.
   Keep shipping the current live site from `web/` as normal.
2. **When the redesign is done:** migrate every page (and `calc/` output) into `web/`,
   then deploy `web/` to production once. From then on `web/` is the single source of
   truth and `redesign/` can be retired.

---

## Redesign status & conventions

**Shared stylesheet.** `redesign/styles.css` is the single source of truth for
design tokens, nav, and footer. New content pages (about / privacy / terms /
refund) link it. `index.html` and `gradeshare.html` still carry their styles
**inline** for now — left as-is to avoid breaking the working staging pages.
*Later (careful, separate pass):* migrate index + gradeshare onto `styles.css`
and delete their inline duplicates so everything shares one stylesheet.

**Hero copy (locked):**
- Headline: `The work around the work` with **handled** on its own line in the
  gradient (`.grad`). No em dash, no period.
- Subhead: *We make the tools for the tedious side of running a post business —
  structure, metadata, paperwork, promotion.*

**Done so far:** clean folder structure; staging workflow; all 8 real app icons
(no tile frame — icons sit on their own); homepage launcher cards; GradeShare
product page; locked hero copy.

**Open items before the full build:**
- Scaffold product copy — not written yet (workbook row is blank/yellow).
- Flip price — site shows **$39**, notes say **$49**. Decide.
- Restyle + link about / privacy / terms / refund (prompt ready; do in redesign/).
- Scope icon: kept as logomark on tile, by choice. Optional: make a true square
  icon later for favicon / dock use.

---

## Notes & gotchas

- **Staging forms hit production.** The form-capture Worker is not environment-aware,
  so a waitlist/contact submission on the staging site writes to the real Monday board
  and sends real Resend emails. Don't submit forms during a staging design pass.
- **Duration Calculator.** It launches from the site, so its *built* output must live
  inside the deployed folder at the path the link expects (e.g. `web/calc/`). The raw
  source stays in `calc/` and is never deployed. When `web/` is rebuilt, bring the
  calc output along.
- **Stale Worker secrets = silent 500s.** If the form starts failing, re-run
  `wrangler secret put MONDAY_API_KEY` (and/or `RESEND_API_KEY`) for the Worker.
- **Routing.** Avoid a subfolder `index.html` whose name collides with a root-level
  page (caused a past routing conflict). Keep page names distinct.

---

## Quick reference

**Brand tokens**
- Accent red: `rgb(230,5,1)` / `#e60501`
- Background: `#080808` · surfaces: `#0d0d0d` / `#121212` / `#181818`
- Headline gradient (warm): `linear-gradient(100deg,#ffab3d,#ff3b22,#e60501,#ff2e6e)`
- Fonts: Space Grotesk (display), IBM Plex Mono (labels), IBM Plex Sans (body)

**Backend**
- Worker: `toolslaunchcapture.robbie-588.workers.dev` → Monday.com + Resend
- Monday board: `18412247742` · columns: email `email_mm34jqea`,
  first name `text_mm34smsk`, last name `text_mm34jg1k`, date `date4`
- Secrets (set via `wrangler secret put`): `MONDAY_API_KEY`, `RESEND_API_KEY`
- Payments: Paddle (Merchant of Record)

**Content source**
- `source/graviton-content.xlsx` — products, feature sections, screenshot shoot list,
  and the component vocabulary the pages are built from.
