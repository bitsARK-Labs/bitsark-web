# Maintenance

Operational guide for `bitsark-web`. If you want to understand *why* things are shaped this way, see [architecture.md](./architecture.md). For pipeline internals, see [data-pipelines.md](./data-pipelines.md).

This document is organized for someone in a hurry: top section is everyday tasks, middle is the periodic checklist, bottom is the runbook section indexed by failure mode.

---

## Everyday tasks

### Run locally

```bash
npm install
npm run dev              # http://localhost:4321 with hot reload
```

No `.env` is required. The site reads:

- `public/data/*.json` (committed) - stablecoin data
- `https://api.bitsark.com/v1/exchanges` (public, no auth) - exchange data, with `src/data/exchanges.js` as fallback if offline

### Build and preview a production bundle locally

```bash
npm run build            # outputs to dist/
npm run preview          # serves dist/ at http://localhost:4321
```

`npm run build` runs `prebuild` first, which generates Open Graph images via Satori (`scripts/generate-og.mjs`). The build will fetch from `api.bitsark.com` for `getStaticPaths`; if the API is unreachable, it falls back to `src/data/exchanges.js`.

### Force a stablecoin data refresh locally

```bash
npm run fetch-data
```

Runs `scripts/fetch-stablecoin-data.js` against DefiLlama and BCB, writing the output to `public/data/stablecoin-market.json` and `public/data/stablecoin-brazil.json`. **Does not commit.** Useful for testing changes to the script or the BCB candidate URL list before pushing.

After running, inspect the JSONs:

- `stablecoin-market.json`: `latestMarketCapUsd` should be in the ballpark of current market cap (e.g. ~$230bn as of mid-2026). Sanity bounds: $50bn–$2tn.
- `stablecoin-brazil.json`: `isFallback` should be `false`. If `true`, the BCB scrape failed - see [BCB fallback alert](#bcb-fallback-alert).

### Force a Cloudflare Pages rebuild

Two options:

1. **Empty commit**: trivial change to any file (or `git commit --allow-empty -m "chore: trigger rebuild"`) and push to `main`.
2. **Workflow dispatch**: GitHub → Actions → "Trigger Cloudflare Pages Rebuild" → Run workflow.

Either pushes a commit, which Cloudflare Pages' Git integration picks up.

### Regenerate Open Graph images

```bash
npm run og
```

Runs `scripts/generate-og.mjs`. Outputs land in `public/og/`. These are also regenerated automatically by `prebuild` before every `npm run build`.

### Run Lighthouse against the local build

```bash
npm run build
npm run lh:check         # uses lighthouserc.json
```

Targets: Performance ≥ 95 (mobile), SEO 100, Accessibility ≥ 95. If you regress any of these, the change should not ship - investigate before deploying.

### Update dependencies

```bash
npm outdated             # list candidates
npm update --save        # bump within semver
# OR for major bumps:
npm install astro@latest @astrojs/sitemap@latest
```

After updating: run `npm run build`, `npm run preview`, click through every route in the browser, run `npm run lh:check`. **Astro major versions** sometimes change `getStaticPaths` contracts or content collections - read the migration guide first.

---

## Common workflows

### Add a new exchange

The exchange data canonical source is the [`exchanges-api`](https://github.com/bitsARK-Labs/exchanges-api) repo, **not this one**.

**Steps:**

1. In `exchanges-api`, edit `data/exchanges.json` adding the new entry. Required fields (see existing entries for shape): `id`, `name`, `slug`, `website`, `logo_url`, `monitored_by_dolarmap`, `updated_at`, `operational_details_br`, `fiscal_details_br`, `fees`.
2. Open a PR. Once merged, the Worker deploys via `deploy-worker.yml`. The new exchange appears at `api.bitsark.com/v1/exchanges` within ~1 minute, which means it shows up in `/exchanges` on the live site immediately (client-side fetch).
3. For the dedicated page `/exchanges/[new-slug]` to exist, a rebuild is needed:
   - Wait for the next Wednesday `scrape-fees.yml` run (auto-triggers a rebuild here), **or**
   - Manually run: GitHub → Actions → "Trigger Cloudflare Pages Rebuild" → Run workflow.

**Strongly recommended**: also add the entry to `src/data/exchanges.js` in this repo so the fallback seed stays current. If you skip this, the exchange will disappear from `/exchanges` the next time `api.bitsark.com` is unreachable. Keep `updated_at` in sync.

> **Eliminate the 404 window**: between merging in `exchanges-api` and the next scheduled rebuild (up to 7 days), `/exchanges/[new-slug]` returns 404. To avoid that, manually trigger a rebuild here right after the `exchanges-api` merge: GitHub → Actions → "Trigger Cloudflare Pages Rebuild" → Run workflow. See the full [window of inconsistency](./data-pipelines.md#data-freshness-sla) note.

### Add an exchange manually as an emergency override

If `api.bitsark.com` is down and you need to surface an exchange immediately:

1. Edit `src/data/exchanges.js` directly, adding the new entry following the existing object shape.
2. Commit and push to `main`. Cloudflare Pages rebuilds.
3. The page will use the local fallback because the API is unreachable.
4. Once `api.bitsark.com` recovers, sync the entry back to `exchanges-api` and remove any divergence.

### Add a new page / new route

1. Create the `.astro` file under `src/pages/` following the structure of an existing similar page.
2. If the page is bilingual, create the mirror under `src/pages/pt/` and add translations to `src/i18n/en.json` and `src/i18n/pt.json`.
3. Import `Base.astro` as the layout - that's where `<title>`, OG tags, canonical URL, and schema.org are wired.
4. Set `hreflang` alternates if both EN and PT-BR exist.
5. Add a per-page stylesheet under `src/styles/pages/` if needed; import it from the page.
6. Add the route to the sitemap (handled automatically by `@astrojs/sitemap`).
7. Verify Lighthouse SEO = 100 before shipping.

### Update an existing exchange's fees or licensing manually

Same as adding: do it in `exchanges-api`, not here. The fallback seed in `src/data/exchanges.js` should be updated occasionally to track reality, but it's not the primary source.

### Refresh the exchanges fallback seed

The seed at [`src/data/exchanges.js`](../src/data/exchanges.js) is hand-maintained and exists only to keep the site usable if `api.bitsark.com` is offline. Refresh it when it lags reality by more than ~2 months:

1. Fetch the live API:
   ```bash
   curl -s https://api.bitsark.com/v1/exchanges > /tmp/exchanges.json
   ```
2. Open `/tmp/exchanges.json` and `src/data/exchanges.js` side by side.
3. For each exchange in the API, update the matching object in the seed file: at minimum `fees.maker`, `fees.taker`, `fees.fee_url`, `operational_details_br.bcb_authorized`, `operational_details_br.cnpj`, and `updated_at` (set to today's ISO timestamp).
4. Add any exchange present in the API but missing from the seed.
5. Run `npm run build` locally - confirm it builds and the seed exports valid JS (the file is ES modules, not raw JSON).
6. Commit as `chore(data): refresh exchanges fallback seed`.

**Once the [planned migration to PR-driven exchange data](./architecture.md#1-move-exchanges-index-to-build-time-rendering) ships, this manual refresh disappears** - the seed becomes the auto-updated source of truth.

### Rotate the deploy token

The `BITSARK_WEB_DEPLOY_TOKEN` lives in the `exchanges-api` repo as an Actions secret. It's a fine-grained PAT scoped to this repo with `Actions: read/write`. If it expires or leaks:

1. GitHub → profile avatar → **Settings** → **Developer settings** → **Personal access tokens** → **Fine-grained tokens**.
2. **Generate new token**:
   - **Name**: `bitsark-web-deploy`
   - **Description**: `Allows exchanges-api repo (scrape-fees.yml) to trigger repository_dispatch on bitsark-web, causing an automatic rebuild + Cloudflare Pages deploy whenever exchange data is updated.`
   - **Resource owner**: `bitsARK-Labs`
   - **Repository access**: Only select repositories → `bitsark-web`
   - **Permissions** → Repository:
     - `Actions: Read and write`
     - `Contents: Read-only`
     - `Metadata: Read-only` (automatic)
3. Generate, copy.
4. Paste into [github.com/bitsARK-Labs/exchanges-api → Settings → Secrets and variables → Actions](https://github.com/bitsARK-Labs/exchanges-api/settings/secrets/actions) as `BITSARK_WEB_DEPLOY_TOKEN`.
5. Test: in `exchanges-api`, manually run `scrape-fees.yml` and confirm the `repository_dispatch` step succeeds and that this repo gets a new commit.

---

## Periodic checklist

### Weekly (Monday after the Mon 13:00 UTC cron)

- [ ] `fetch-stablecoin-data.yml` last run is green (Actions tab).
- [ ] `public/data/stablecoin-brazil.json` has `isFallback: false` and recent `updatedAt`.
- [ ] `public/data/stablecoin-market.json` has plausible `latestMarketCapUsd` (sanity range $50bn–$2tn).

### Weekly (Wednesday after the ~17:00 UTC `exchanges-api` scrape)

- [ ] `bitsark-web/main` got a new commit (either `chore(data): ...` or `chore: trigger rebuild ...`).
- [ ] Cloudflare Pages deploy succeeded (Cloudflare dashboard).
- [ ] `/exchanges` loads, table is populated.

### Monthly

- [ ] `npm outdated` - review and update dependencies.
- [ ] `npm run lh:check` - confirm Lighthouse targets still met.
- [ ] Spot-check `/exchanges/[slug]` for 3 random exchanges - ensure pages render and data is reasonable.
- [ ] Google Search Console - check for new indexing errors, manual actions, or `Coverage` regressions.
- [ ] Verify no open `bcb-fallback-stale` issue is being ignored.

### Quarterly

- [ ] Review the BCB Tabelas Especiais portal manually: `https://www.bcb.gov.br/estatisticas/tabelasespeciais`. If a new XLSX was published with a URL not in `BCB_XLSX_CANDIDATES`, add it proactively.
- [ ] Review `src/data/exchanges.js` fallback seed - bring it within 1-2 months of the live API data so it's not embarrassing if the API ever goes down.
- [ ] Check that the Resend domain `bitsark.com` is still verified (Resend dashboard).
- [ ] Confirm Google Play store listing still links correctly to `/dolarmap`, `/dolarmap/privacy`, `/dolarmap/terms`.

---

## Runbooks

Indexed by symptom. Each runbook has the same shape: **Detect → Diagnose → Fix → Verify**.

### BCB fallback alert

**Detect:** GitHub issue auto-opened with label `bcb-fallback-stale`. Title: `[data] BCB XLSX em fallback há N dias - atualizar parser`.

**Diagnose:** Three possible causes (in order of likelihood):

1. BCB renamed the XLSX file or moved it to a new URL.
2. BCB changed the row label (e.g. dropped "com passivo correspondente" from the wording).
3. BCB restructured the XLSX layout (different sheet, different header row format).

**Fix:**

1. Open [https://www.bcb.gov.br/estatisticas/tabelasespeciais](https://www.bcb.gov.br/estatisticas/tabelasespeciais) in a browser. The portal is JavaScript-rendered, so right-click any download link and copy the actual file URL.
2. Look for the Balance-of-Payments table that contains the line for stablecoins. Confirm the line label and the data layout.
3. In [`scripts/fetch-stablecoin-data.js`](../scripts/fetch-stablecoin-data.js):
   - **If URL changed**: prepend the new URL to `BCB_XLSX_CANDIDATES`. Keep old URLs as backup.
   - **If label changed**: add the new wording to `STABLECOIN_LABELS`. Keep old wordings.
   - **If layout changed**: this is the rare case. Inspect the failing branch in the script's sheet-parsing logic and adapt. The header-row detection looks for cells matching `/^[a-z]{3}\/\d{2,4}$/i` (month codes like `jan/19`).
4. Test locally:
   ```bash
   npm run fetch-data
   # Inspect public/data/stablecoin-brazil.json
   # Confirm isFallback: false and latestMonth is the expected recent month
   ```
5. Commit and push. The next workflow run will succeed; the issue can be closed manually or will auto-close after the next clean run.

**Verify:**
- GitHub → Actions → Manually trigger `fetch-stablecoin-data.yml` (workflow_dispatch).
- The run logs should NOT show the "Alert on stale BCB fallback" step opening an issue.
- `public/data/stablecoin-brazil.json` shows `isFallback: false` after the run.

### BCB layout change

Same as [BCB fallback alert](#bcb-fallback-alert) - the alert is the symptom, the layout change is one of the causes.

### DefiLlama down

**Detect:** `fetch-stablecoin-data.yml` workflow run fails red on the "Run data fetch script" step. The site stays online with the last successful `stablecoin-market.json`.

**Diagnose:** Either DefiLlama is genuinely down/rate-limited, or they changed the response shape, or they retired the endpoint.

1. `curl https://stablecoins.llama.fi/stablecoincharts/all | head -c 500` - what comes back?
2. If 200 OK but different shape: check DefiLlama's [API docs](https://defillama.com/docs/api) or their Discord for breaking changes.
3. If 5xx or timeout: wait an hour and retry; it's transient.

**Fix:**

- **Transient outage**: wait, then manually trigger the workflow again. No code change needed.
- **Shape change**: edit `scripts/fetch-stablecoin-data.js` - the relevant code is the call to `https://stablecoins.llama.fi/stablecoincharts/all` and the parsing of `totalCirculatingUSD.peggedUSD`. Adapt to the new shape.
- **Endpoint retired (catastrophic)**: backup plan is to migrate to CoinGecko's `/global` endpoint summing a curated list of stablecoins. Note: this regresses to ~75% of true market coverage (the [DefiLlama rationale](./data-pipelines.md#why-defillama-and-not-coingecko) explains why we left it). Acceptable as a stop-gap.

**Verify:**

```bash
npm run fetch-data
# Inspect public/data/stablecoin-market.json
# latestMarketCapUsd should be in $50bn–$2tn range
# monthly array should have ~70+ entries covering 2019-present
```

### Empty commit didn't trigger a Cloudflare Pages rebuild

**Detect:** `deploy.yml` workflow ran green (commit appears on `main`), but Cloudflare Pages dashboard shows no new deploy.

**Diagnose:**

1. Cloudflare Pages dashboard → Project → **Settings** → **Builds & deployments** → confirm Git integration is still connected and on `main`.
2. Check Cloudflare Pages **Deployments** tab - was the deploy attempted and failed (build error), or never attempted (integration broken)?

**Fix:**

- **Integration broken**: reconnect via Cloudflare dashboard → Pages → Settings → Connect Git.
- **Build error**: open the failed deploy in Cloudflare, read the build log. Most common: a script throws during build. Reproduce locally with `npm run build`.

**Verify:** any subsequent commit on `main` produces a deploy entry in Cloudflare within ~1 minute.

### `repository_dispatch` from `exchanges-api` no longer arrives

**Detect:** It's been more than one Wednesday since a `chore: trigger rebuild` commit appeared.

**Diagnose:**

1. `exchanges-api` repo → Actions → `scrape-fees.yml` → recent runs. Did the workflow run? Did the dispatch step succeed?
2. Most common cause: `BITSARK_WEB_DEPLOY_TOKEN` expired. Fine-grained PATs have an expiration date (max 1 year).

**Fix:** [Rotate the deploy token](#rotate-the-deploy-token).

**Verify:** Manually trigger `scrape-fees.yml` in `exchanges-api`. Confirm a new commit appears on this repo's `main` within ~30s.

### `api.bitsark.com` returning errors

**Detect:** `/exchanges` table is empty or shows fallback data. `/exchanges/[slug]` 404s for slugs that should exist (after the next deploy).

**Diagnose:**

```bash
curl -i https://api.bitsark.com/v1/exchanges
```

1. If 5xx: the Worker is failing. Check the `exchanges-api` repo's Cloudflare Worker logs (Cloudflare dashboard → Workers & Pages → Worker → Logs).
2. If 404 / wrong response: the Worker may have been deployed with a regression. Check `exchanges-api` recent `deploy-worker.yml` runs.

**Fix:** Roll back the Worker via Cloudflare dashboard (Deployments tab, click "Rollback" on the previous good version), then investigate the regression in `exchanges-api`.

**Verify:**

```bash
curl -s https://api.bitsark.com/v1/exchanges | jq '.[0].slug'
# should print a known exchange slug
```

### Cloudflare Pages deploy is failing

**Detect:** Cloudflare Pages → Deployments shows red on recent deploys.

**Diagnose:** Open the failing deploy, read the build log. Most common failure modes:

1. **`getStaticPaths` failed**: the API was down during build. The build's fallback path uses `getAllSlugs()` from `src/data/exchanges.js` - but if even that throws, investigate.
2. **OG generation failed**: `scripts/generate-og.mjs` requires `@resvg/resvg-js` and Satori; check if either was misversioned.
3. **TypeScript error**: a recent commit introduced a type error that `astro check` flags.

**Fix:** Reproduce locally with `npm run build`. Fix, commit, push.

**Verify:** New deploy entry in Cloudflare Pages goes green.

### Site is up but feedback form doesn't deliver email

**Detect:** Submitting the feedback form returns success in the UI but no email arrives.

**Diagnose:**

1. Cloudflare Pages → Project → **Functions** → Real-time logs (or tail via `wrangler pages deployment tail`). Watch a submission live.
2. Check that `RESEND_API_KEY` and `EMAIL_TO` are set in **Functions environment variables** (encrypted for the key).
3. Resend dashboard → **Logs** - was the email accepted? Bounced? Domain unverified?

**Fix:**

- Missing env var → set in Cloudflare Pages dashboard, redeploy (env var changes don't auto-deploy).
- Resend rejecting → most often the `bitsark.com` domain lost DKIM/SPF in Cloudflare DNS. Re-verify in Resend, then re-add the missing DNS records in Cloudflare.

**Verify:** Submit the form again, watch the email arrive within seconds.

---

## Monitoring (suggested)

These aren't strictly required but catch problems before users do.

| Signal | How to monitor | What it tells you |
|---|---|---|
| GitHub Actions failures | GitHub → Settings → Notifications → enable Action failure emails | A pipeline broke |
| Cloudflare Pages deploys | Cloudflare dashboard → Project → Settings → Notifications → enable Slack/email for failed deploys | A build broke |
| Google Search Console | Weekly check + email alerts | Indexing regressions, manual actions |
| PageSpeed Insights | Weekly run on `/`, `/exchanges`, `/stablecoins-brasil` | Lighthouse / CrUX regressions |
| Resend deliverability | Resend dashboard weekly | Domain reputation, bounce spikes |
| BCB fallback alert | Auto-issue with label `bcb-fallback-stale` (already wired) | BCB pipeline stale > 90d |

---

*For why the system is shaped this way, see [architecture.md](./architecture.md). For the pipeline internals themselves, see [data-pipelines.md](./data-pipelines.md).*
