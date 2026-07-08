# Renovation Ranker (Phase 1 MVP + Phase 2 features)

Scans residential addresses, pulls Street View + satellite imagery, sends each
property through a single Claude Vision call with a structured condition
prompt, computes a **deterministic** renovation-opportunity score per
contractor type, and outputs a ranked lead list (CLI table, web dashboard,
CSV export).

The vision model never invents the rank — it reports evidence-based severity
(0–3) for a fixed grid of sub-items (roof, windows, siding/paint,
gutters/fascia, driveway, landscaping); the scoring layer in
[`src/scoring.ts`](src/scoring.ts) turns that into auditable numbers you can
re-weight without re-prompting.

## Quick start (offline, no keys)

```bash
bun install
MOCK=1 bun run src/cli.ts scan-list addresses.example.json
MOCK=1 bun run src/cli.ts results --type roofing
MOCK=1 bun run src/cli.ts serve       # http://localhost:8787
```

`MOCK=1` swaps Google + Claude for deterministic fixtures so the full
pipeline, scoring, dashboard, and CSV export run end-to-end with zero cost.

## Real scans

1. Copy `.env.example` to `.env` and fill in `GOOGLE_MAPS_API_KEY` (Geocoding,
   Street View Static, Maps Static APIs enabled) and `ANTHROPIC_API_KEY`.
2. **Validate first** (per the build plan): put ~20 addresses whose condition
   you already know into a JSON array and run:

   ```bash
   bun run src/cli.ts scan-list my-known-addresses.json
   bun run src/cli.ts results --type general
   ```

   Iterate on the prompt (`src/vision.ts`) and weights (`src/scoring.ts`)
   until the ranking matches reality — this catches problems while it's cheap.
3. Then scan a zip code:

   ```bash
   bun run src/cli.ts scan-zip 91423 --limit 50
   ```

## Commands

| Command | What it does |
|---|---|
| `scan-address "<addr>"` | Scan one address |
| `scan-list <file.json> [--concurrency N]` | Scan a JSON array of addresses — strings, or pre-geocoded `{address, lat, lng, zip}` objects from `import-addresses` |
| `scan-zip <zip> [--limit N] [--concurrency N]` | Discover addresses in a zip (reverse-geocode grid sampling) and scan them |
| `batch-submit <file.json>` | Fetch imagery now, submit all vision analyses as one Claude **Batch API** job (50% token cost; usually done within an hour) |
| `batch-status <id>` / `batch-collect <id>` | Poll the batch / ingest results into the store |
| `import-addresses <parcels.csv> [--zip Z] [--out f.json]` | Import an OpenAddresses/parcel CSV — full-coverage discovery; rows carry coordinates so scans skip the Geocoding API |
| `validate <ground-truth.json>` | Compare model ranking to your own 0–3 ratings (see `ground-truth.example.json`): Spearman rank correlation per category + biggest disagreements with model evidence |
| `estimate --addresses N [--pricing f] [--batch] [--pre-geocoded]` | Itemized cost projection from a pricing file **you** fill in with current prices (`pricing.example.json`) |
| `results [--type T] [--min N]` | Print the ranked lead list (with Δ vs previous scan) |
| `export [--type T] [--min N]` | CSV lead list to stdout, segmented by contractor type |
| `serve` | Web dashboard: ranked table (with re-scan Δ), map view at `/map` (score-colored pins), CSV download |

Contractor types: `roofing`, `siding`, `windows`, `landscaping`, `general` —
each weights the category scores differently, so a roofer's list ranks (and
carries evidence) only on roof + gutter findings.

## Storage

- No `DATABASE_URL` → results land in `data/scans.json` (zero infra, fine for
  validation runs).
- With `DATABASE_URL` → Postgres (`docker compose up -d postgres`), schema in
  [`schema.sql`](schema.sql). One `scans` row per address per scan date, so
  re-scans track degradation over time; `scan_findings` holds one row per
  sub-item for SQL-side lead filtering.

## How a scan works

1. **Geocode** the address (rooftop lat/lng + normalized address + zip).
2. **Street View metadata** — pano ID, camera position, and **capture date**.
   If the latest stored scan used the same capture date, the address is
   skipped (never pay to re-analyze unchanged imagery).
3. **Images** — camera heading is computed from the pano position toward the
   geocoded rooftop (so we look at the house, not the neighbor's fence);
   three street-level frames at ±25° plus a zoom-20 satellite tile. All
   fetched server-side at 640px — small enough to keep vision token cost
   down, big enough to read visible defects.
4. **One Claude call** with all images and a JSON-schema-constrained
   structured output: severity 0–3 + `visible` + evidence text per sub-item,
   plus image-quality flags (street view quality, satellite quality,
   house-identification confidence).
5. **Deterministic scoring** — weighted severity → 0–100 per category →
   weighted per contractor type. **Confidence** (0–1) is computed separately
   from imagery age (full credit ≤ 24 months, decaying to 0.3 at 8 years —
   stale imagery is the biggest accuracy risk) and the quality flags.
   Addresses with no usable imagery get status `no_reliable_imagery`, never a
   forced score.

## Accuracy expectations

Street-level/satellite vision analysis produces false positives (shadows read
as stains, etc.). Outputs are "worth a look" leads, **not** inspection
reports — frame them that way to contractors, and put that line in the
contract if lists are sold.

## Phase 2 features included

- **Concurrent scanning** — `--concurrency N` runs a bounded worker pool;
  all Google calls share a minimum-interval rate limiter
  (`GOOGLE_MIN_INTERVAL_MS`). Crash/rerun resume falls out of the
  capture-date cache.
- **Batch API mode** — `batch-submit` fetches imagery immediately but runs
  the vision analyses through the Claude Batch API at 50% token cost.
- **Solar API context** — `SOLAR_API=1` adds Google Solar `buildingInsights`
  roof facts (segment pitches/azimuths/areas, solar imagery date) as text
  context to the vision prompt. Solar data-layer *imagery* is future work.
- **Validation harness** — `validate` turns the tune-the-prompt loop into a
  measured one (rank correlation + per-address disagreement report).
- **Parcel import** — `import-addresses` replaces grid discovery with a real
  address dataset and skips geocoding (rows carry coordinates).
- **Re-scan trend tracking** — every scan is kept; the Δ column (table, CSV,
  API) shows score change vs the previous scan of the same address — the
  did-the-house-get-fixed signal.
- **Cost estimator** — `estimate` projects a scan's cost from a pricing file
  you populate with current prices (values ship as 0 so stale numbers can't
  mislead).
- **Map view** — `/map` renders score-colored pins (Leaflet/OSM, loaded in
  the browser only).

## Chrome extension

`extension/` is a Manifest V3 Chrome extension that talks to the local server:
the toolbar popup shows your top ranked leads (contractor-type + min-score
filters), and highlighting an address on any webpage → right-click → *"Scan
with Renovation Ranker"* scans it immediately and shows the score as a
notification.

Install: start the server (`bun run serve`), open `chrome://extensions`,
enable **Developer mode**, click **Load unpacked**, and select the
`renovation-ranker/extension/` folder. The extension expects the server on
`http://localhost:8787` (edit `BASE` in `popup.js`/`background.js` and
`host_permissions` in `manifest.json` to change it).

## Phase 3 (not built)

Multi-zip batch orchestration, contractor client logins/auth, Solar data-layer
imagery in the vision call.
