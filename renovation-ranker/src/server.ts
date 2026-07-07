/**
 * Dashboard: ranked table (with re-scan score deltas) at /, map view with
 * score-colored pins at /map, JSON at /api/results, CSV at /export.csv.
 * The map page loads Leaflet + OSM tiles from public CDNs — it runs in the
 * operator's browser, not in the scan pipeline.
 */
import { leadsFor, leadsToCsv, scoreDeltas, type LeadRow } from "./export.ts";
import type { Store } from "./store.ts";
import { CONTRACTOR_TYPES, type ContractorType } from "./types.ts";

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

function parseType(v: string | null): ContractorType {
  return (CONTRACTOR_TYPES as readonly string[]).includes(v ?? "")
    ? (v as ContractorType)
    : "general";
}

async function loadRows(store: Store, type: ContractorType, minScore: number) {
  const all = await store.allScans();
  const latest = await store.latestScans();
  return {
    rows: leadsFor(latest, type, minScore, scoreDeltas(all, type)),
    unscored: latest.filter((s) => s.status !== "scored").length,
  };
}

const BASE_STYLE = `
  :root { color-scheme: light dark; }
  body { font-family: system-ui, sans-serif; margin: 2rem auto; max-width: 1200px; padding: 0 1rem; }
  h1 { font-size: 1.3rem; }
  form { margin: 1rem 0; display: flex; gap: .75rem; align-items: center; flex-wrap: wrap; }
  table { border-collapse: collapse; width: 100%; font-size: .9rem; }
  th, td { border-bottom: 1px solid color-mix(in srgb, currentColor 20%, transparent); padding: .45rem .6rem; text-align: left; vertical-align: top; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  td.low { opacity: .55; }
  td.notes { max-width: 26rem; }
  .muted { opacity: .65; font-size: .85rem; }
  .worse { color: #c0392b; } .better { color: #1e8449; }
  a.button { padding: .3rem .7rem; border: 1px solid currentColor; border-radius: 6px; text-decoration: none; color: inherit; }
`;

function controls(type: ContractorType, minScore: number, page: "table" | "map"): string {
  const options = CONTRACTOR_TYPES.map(
    (t) => `<option value="${t}" ${t === type ? "selected" : ""}>${t}</option>`,
  ).join("");
  const other =
    page === "table"
      ? `<a class="button" href="/map?type=${type}&min=${minScore}">Map view</a>`
      : `<a class="button" href="/?type=${type}&min=${minScore}">Table view</a>`;
  return `<form method="get" action="${page === "table" ? "/" : "/map"}">
  <label>Contractor type <select name="type" onchange="this.form.submit()">${options}</select></label>
  <label>Min score <input type="number" name="min" value="${minScore}" min="0" max="100" step="5" style="width:4.5rem"></label>
  <button type="submit">Apply</button>
  ${other}
  <a class="button" href="/export.csv?type=${type}&min=${minScore}">Export CSV</a>
</form>`;
}

function deltaCell(delta: number | null): string {
  if (delta === null) return `<td class="num muted">—</td>`;
  const cls = delta > 0 ? "worse" : delta < 0 ? "better" : "";
  const sign = delta > 0 ? "+" : "";
  return `<td class="num ${cls}">${sign}${delta.toFixed(1)}</td>`;
}

function renderTablePage(
  rows: LeadRow[],
  unscored: number,
  type: ContractorType,
  minScore: number,
): string {
  const tableRows = rows
    .map(
      (r) => `<tr>
        <td class="num">${r.rank}</td>
        <td>${esc(r.address)}</td>
        <td class="num">${r.score.toFixed(1)}</td>
        ${deltaCell(r.delta)}
        <td class="num ${r.confidence < 0.6 ? "low" : ""}">${r.confidence.toFixed(2)}</td>
        <td>${esc(r.imageryDate ?? "?")}</td>
        <td>${esc(r.topFindings)}</td>
        <td class="notes">${esc(r.notes)}</td>
      </tr>`,
    )
    .join("\n");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Renovation Ranker</title>
<style>${BASE_STYLE}</style></head><body>
<h1>Renovation Ranker — lead list</h1>
${controls(type, minScore, "table")}
<table>
  <thead><tr><th>#</th><th>Address</th><th>Score</th><th>Δ</th><th>Conf.</th><th>Imagery</th><th>Findings (sev ≥ 2)</th><th>Notes</th></tr></thead>
  <tbody>${tableRows || `<tr><td colspan="8" class="muted">No scored addresses yet — run a scan first.</td></tr>`}</tbody>
</table>
<p class="muted">Δ = change vs the previous scan of the same address (re-scan trend). ${unscored ? `${unscored} address(es) without a score are excluded.` : ""}</p>
</body></html>`;
}

function renderMapPage(rows: LeadRow[], type: ContractorType, minScore: number): string {
  const data = JSON.stringify(
    rows.map((r) => ({
      a: r.address, lat: r.lat, lng: r.lng, s: r.score, c: r.confidence, f: r.topFindings,
    })),
  );
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Renovation Ranker — map</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<style>${BASE_STYLE} #map { height: 75vh; border-radius: 8px; }</style></head><body>
<h1>Renovation Ranker — map</h1>
${controls(type, minScore, "map")}
<div id="map"></div>
<p class="muted">Pin color: green (low score) → red (high renovation opportunity). Click a pin for details.</p>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
  const rows = ${data};
  const map = L.map("map");
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(map);
  function color(score) {
    const t = Math.max(0, Math.min(1, score / 60)); // 60+ = full red
    const hue = 120 * (1 - t);
    return "hsl(" + hue + ", 75%, 45%)";
  }
  const bounds = [];
  for (const r of rows) {
    if (!r.lat && !r.lng) continue;
    bounds.push([r.lat, r.lng]);
    L.circleMarker([r.lat, r.lng], {
      radius: 8, color: color(r.s), fillColor: color(r.s), fillOpacity: 0.85, weight: 1,
    })
      .bindPopup(
        "<b>" + r.a + "</b><br>Score: " + r.s.toFixed(1) + " (conf " + r.c.toFixed(2) + ")" +
          (r.f ? "<br>" + r.f : ""),
      )
      .addTo(map);
  }
  if (bounds.length) map.fitBounds(bounds, { padding: [30, 30] });
  else map.setView([39.5, -98.35], 4);
</script>
</body></html>`;
}

export function startServer(store: Store, port: number) {
  return Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);
      const type = parseType(url.searchParams.get("type"));
      const minScore = Number(url.searchParams.get("min") ?? 0) || 0;

      if (url.pathname === "/") {
        const { rows, unscored } = await loadRows(store, type, minScore);
        return new Response(renderTablePage(rows, unscored, type, minScore), {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }
      if (url.pathname === "/map") {
        const { rows } = await loadRows(store, type, minScore);
        return new Response(renderMapPage(rows, type, minScore), {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }
      if (url.pathname === "/api/results") {
        const { rows } = await loadRows(store, type, minScore);
        return Response.json({ contractorType: type, rows });
      }
      if (url.pathname === "/export.csv") {
        const { rows } = await loadRows(store, type, minScore);
        return new Response(leadsToCsv(rows), {
          headers: {
            "content-type": "text/csv; charset=utf-8",
            "content-disposition": `attachment; filename="leads-${type}.csv"`,
          },
        });
      }
      return new Response("not found", { status: 404 });
    },
  });
}
