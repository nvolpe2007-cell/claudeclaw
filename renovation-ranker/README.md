# Renovation Ranker (Phase 1 MVP)

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
| `scan-list <file.json>` | Scan a JSON array of addresses (validation workflow) |
| `scan-zip <zip> [--limit N]` | Discover addresses in a zip (reverse-geocode grid sampling) and scan them |
| `results [--type T] [--min N]` | Print the ranked lead list |
| `export [--type T] [--min N]` | CSV lead list to stdout, segmented by contractor type |
| `serve` | Web dashboard: ranked table, contractor-type filter, CSV download |

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

## Phase 2+ (not in this MVP)

Queue (hundreds of addresses per zip needs async + retries), Google Solar API
roof layers, Batch API for 50% vision cost reduction, map view, multi-zip
scans, historical re-scan tracking, auth for contractor logins.
