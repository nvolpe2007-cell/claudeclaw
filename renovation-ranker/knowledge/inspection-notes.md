# Exterior inspection knowledge

This file is injected into the vision model's system prompt on every scan.
Edit it freely to teach the assessor what you know — regional norms, what
specific defects look like, common false positives you've seen it make.
No code changes needed; the next scan picks it up.

## Roof

- Uniform dark streaks running downslope are algae (Gloeocapsa magma) —
  cosmetic, severity 1. Moss appears as raised green/dark clumps, usually on
  north-facing or shaded slopes — it lifts shingles, severity 2 when
  widespread.
- End-of-life asphalt shingles show: bare/dark patches from granule loss,
  curling or cupping edges visible along the eave line, and a generally
  "mottled" texture. Distinguish from shadow: granule loss follows shingle
  edges; shadows follow objects (trees, chimneys, dormers).
- A color/texture mismatch between roof planes usually means one section was
  replaced or added later — score the OLDER plane's condition.
- Tarps, plywood patches, or mismatched shingle clusters = active problem the
  owner already knows about: strong lead, severity 3 on visible_patching.
- Flashing failures show as dark staining trails below chimneys, vents, or
  wall-roof junctions.

## Windows

- Single-pane indicators: very thin frames, no spacer bar visible between
  panes, storm windows mounted outside, houses built pre-1980 with original
  wood sashes.
- Fogging/seal failure is only visible in good light as a milky haze between
  panes — do not report it unless clearly visible; reflections are the #1
  false positive here.
- Mismatched window styles (one vinyl replacement among wood sashes) signals
  an owner who replaces piecemeal — good whole-house package lead.

## Siding & paint

- Peeling paint concentrates at horizontal surfaces, sills, and south/west
  exposures first. Chalking shows as faded, powdery, uneven color.
- Stucco: hairline cracking is normal aging (severity 1); stair-step or wide
  (>3mm-looking) cracks, or cracks with displacement/staining, indicate
  movement or water entry (severity 2-3).
- Dark staining below windows or at siding joints = water intrusion path.
- Shadow lines from trim, downspouts, and eaves are NOT stains — check
  whether the "stain" direction matches sun/shadow geometry elsewhere in the
  image before scoring.

## Gutters & fascia

- Sagging shows as visible dips or separation from the fascia line.
- Streaked staining on fascia below the gutter line = chronic overflow;
  usually means clogged/undersized gutters plus possible fascia rot behind.
- A downspout ending mid-air or missing its splash block still counts as
  disconnected — cheap fix, but signals deferred maintenance overall.

## Driveway & hardscape

- Score heaving (vertical displacement, trip hazards) above flat cracking.
- Fresh sealcoat (uniform deep black) means a maintained property — this and
  other maintenance signals should push severities DOWN across categories.

## Landscaping

- Dead trees or large dead shrubs touching or overhanging the structure are
  a hazard/fire-risk lead (severity 2-3), not routine yardwork.
- Brown lawn in late summer in dry regions is often seasonal dormancy, not
  neglect — check whether beds/edges are otherwise kept.

## Parcel context (when provided)

- Asphalt shingle roofs last ~20-30 years. If year built (or last obvious
  re-roof) implies the roof is near or past that and the imagery shows any
  wear, weight roof findings up.
- Original windows on pre-1980 construction are almost certainly single-pane.
- A recent sale year often means recent renovation OR an investor flip —
  trust the imagery over the prior.

## General

- Maintenance signals (new roof, fresh paint, trimmed hedges, clean
  driveway) on some categories make severe findings in others LESS likely to
  be real — re-check the evidence before scoring high.
- When image quality is poor (glare, obstruction, low resolution), mark
  items not-visible instead of guessing.
