/**
 * Dashboard: ranked lead table with score bars and summary stat tiles at /,
 * map view with score-bucketed pins at /map, JSON at /api/results (CORS for
 * the browser extension), CSV at /export.csv, POST /api/scan.
 *
 * Visual system: single-hue sequential blue encodes score magnitude (ramps
 * validated for light and dark surfaces with the palette validator);
 * severity chips use reserved status colors with text labels; all text wears
 * ink tokens, never series color. Leaflet is vendored (/assets/*) so the map
 * works behind restrictive proxies; pins render even when tiles can't load.
 */
import { leadsFor, leadsToCsv, scoreDeltas, type LeadRow } from "./export.ts";
import { scanAddress, type PipelineDeps } from "./pipeline.ts";
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

/* ---------------- design tokens & chrome ---------------- */

// Score ramp (single hue, light->dark = low->high) validated with the
// palette validator against the light surface (ordinal checks). Used for map
// pins, which always sit on light OSM tiles; the table's score bars use one
// solid hue per mode (--bar) since bar length carries the value.
const SCORE_RAMP_LIGHT = ["#86b6ef", "#5598e7", "#2a78d6", "#1c5cab", "#0d366b"];
const SCORE_BUCKETS = [15, 30, 45, 60]; // upper bounds; 5th bucket is 60+

const BASE_STYLE = `
  :root {
    color-scheme: light dark;
    --plane: #f9f9f7; --surface: #fcfcfb;
    --ink: #0b0b0b; --ink-2: #52514e; --muted: #898781;
    --grid: #e1e0d9; --border: rgba(11,11,11,0.10);
    --bar: #2a78d6;
    --sev3: #d03b3b; --sev3-bg: rgba(208,59,59,0.10);
    --sev2: #b45309; --sev2-bg: rgba(236,131,90,0.16);
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --plane: #0d0d0d; --surface: #1a1a19;
      --ink: #ffffff; --ink-2: #c3c2b7; --muted: #898781;
      --grid: #2c2c2a; --border: rgba(255,255,255,0.10);
      --bar: #3987e5;
      --sev3: #e66767; --sev3-bg: rgba(230,103,103,0.14);
      --sev2: #ec835a; --sev2-bg: rgba(236,131,90,0.14);
    }
  }
  * { box-sizing: border-box; }
  body {
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    background: var(--plane); color: var(--ink);
    margin: 0; padding: 24px; min-height: 100vh;
  }
  .wrap { max-width: 1240px; margin: 0 auto; }

  header { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; margin-bottom: 18px; }
  .brand { display: flex; align-items: center; gap: 10px; }
  .brand svg { width: 30px; height: 30px; }
  .brand h1 { font-size: 1.05rem; margin: 0; letter-spacing: -0.01em; }
  .brand .tag { font-size: .75rem; color: var(--muted); display: block; margin-top: 1px; }
  nav { display: flex; gap: 2px; margin-left: auto; background: var(--surface);
        border: 1px solid var(--border); border-radius: 8px; padding: 3px; }
  nav a { padding: 5px 14px; border-radius: 6px; text-decoration: none; color: var(--ink-2); font-size: .85rem; }
  nav a.active { background: var(--bar); color: #fff; }
  nav a:not(.active):hover { color: var(--ink); }

  .controls { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-bottom: 18px; }
  .controls label { font-size: .8rem; color: var(--ink-2); display: flex; align-items: center; gap: 6px; }
  select, input[type=number], button, .button {
    font: inherit; font-size: .85rem; color: var(--ink);
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 7px; padding: 6px 10px;
  }
  input[type=number] { width: 4.6rem; }
  button, .button { cursor: pointer; text-decoration: none; }
  button:hover, .button:hover { border-color: var(--muted); }

  .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; margin-bottom: 18px; }
  .tile { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 14px 16px; }
  .tile .label { font-size: .72rem; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); margin-bottom: 6px; }
  .tile .value { font-size: 1.7rem; font-weight: 650; line-height: 1.1; }
  .tile .sub { font-size: .75rem; color: var(--ink-2); margin-top: 4px; }

  .card { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; overflow: hidden; }
  .card .card-head { padding: 12px 16px; border-bottom: 1px solid var(--grid); display: flex; align-items: baseline; gap: 10px; }
  .card .card-head h2 { font-size: .9rem; margin: 0; }
  .card .card-head .sub { font-size: .78rem; color: var(--muted); }

  .tbl-scroll { overflow-x: auto; }
  table { border-collapse: collapse; width: 100%; font-size: .85rem; }
  th { text-align: left; font-size: .72rem; text-transform: uppercase; letter-spacing: .05em;
       color: var(--muted); font-weight: 600; padding: 10px 12px; border-bottom: 1px solid var(--grid); }
  td { padding: 10px 12px; border-bottom: 1px solid var(--grid); vertical-align: top; }
  tbody tr:last-child td { border-bottom: 0; }
  tbody tr:hover { background: color-mix(in srgb, var(--bar) 5%, transparent); }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  .rank { color: var(--muted); font-variant-numeric: tabular-nums; }
  .addr { font-weight: 550; }
  .addr .zip { color: var(--muted); font-weight: 400; font-size: .78rem; }

  .score-cell { min-width: 150px; }
  .score-val { font-variant-numeric: tabular-nums; font-weight: 600; margin-bottom: 4px; }
  .score-track { height: 6px; border-radius: 4px; background: var(--grid); overflow: hidden; }
  .score-fill { height: 100%; border-radius: 4px; background: var(--bar); }

  .delta { font-variant-numeric: tabular-nums; color: var(--ink-2); white-space: nowrap; }
  .delta.na { color: var(--muted); }
  .conf { font-variant-numeric: tabular-nums; }
  .conf .low-tag { display: inline-block; font-size: .68rem; color: var(--ink-2);
    border: 1px solid var(--border); border-radius: 4px; padding: 0 5px; margin-left: 6px; vertical-align: 1px; }
  .imagery { color: var(--ink-2); white-space: nowrap; }

  .chips { display: flex; flex-wrap: wrap; gap: 5px; max-width: 30rem; }
  .chip { font-size: .72rem; border-radius: 5px; padding: 2px 8px; white-space: nowrap; }
  .chip.s3 { color: var(--sev3); background: var(--sev3-bg); }
  .chip.s2 { color: var(--sev2); background: var(--sev2-bg); }
  .notes { color: var(--ink-2); font-size: .8rem; max-width: 24rem; }

  .empty { padding: 40px; text-align: center; color: var(--muted); }
  .foot { font-size: .75rem; color: var(--muted); margin-top: 12px; }

  #map { height: 72vh; }
  .map-legend { display: flex; gap: 14px; align-items: center; padding: 10px 16px; font-size: .75rem; color: var(--ink-2); flex-wrap: wrap; }
  .map-legend .lg { display: flex; align-items: center; gap: 5px; }
  .map-legend .sw { width: 12px; height: 12px; border-radius: 50%; border: 2px solid #fff; box-shadow: 0 0 0 1px var(--border); }
`;

const HOUSE_SVG = `<svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
  <rect width="32" height="32" rx="7" fill="#d97706"/>
  <path d="M16 7 L26 16 H23 V24 H18.5 V18.5 H13.5 V24 H9 V16 H6 Z" fill="#fff"/>
</svg>`;

function chrome(
  page: "table" | "map",
  type: ContractorType,
  minScore: number,
  body: string,
): string {
  const options = CONTRACTOR_TYPES.map(
    (t) => `<option value="${t}" ${t === type ? "selected" : ""}>${t}</option>`,
  ).join("");
  const q = `type=${type}&min=${minScore}`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Renovation Ranker</title>
${page === "map" ? `<link rel="stylesheet" href="/assets/leaflet.css">` : ""}
<style>${BASE_STYLE}</style></head><body>
<div class="wrap">
<header>
  <div class="brand">${HOUSE_SVG}<div><h1>Renovation Ranker</h1><span class="tag">exterior condition leads from public imagery</span></div></div>
  <nav>
    <a href="/?${q}" class="${page === "table" ? "active" : ""}">Leads</a>
    <a href="/map?${q}" class="${page === "map" ? "active" : ""}">Map</a>
  </nav>
</header>
<form class="controls" method="get" action="${page === "table" ? "/" : "/map"}">
  <label>Contractor <select name="type" onchange="this.form.submit()">${options}</select></label>
  <label>Min score <input type="number" name="min" value="${minScore}" min="0" max="100" step="5"></label>
  <button type="submit">Apply</button>
  <a class="button" href="/export.csv?${q}">Download CSV</a>
</form>
${body}
</div>
</body></html>`;
}

/* ---------------- table page ---------------- */

function statTiles(rows: LeadRow[], unscored: number): string {
  const scores = rows.map((r) => r.score).sort((a, b) => a - b);
  const median = scores.length
    ? scores.length % 2
      ? scores[(scores.length - 1) / 2]
      : (scores[scores.length / 2 - 1] + scores[scores.length / 2]) / 2
    : 0;
  const hot = rows.filter((r) => r.score >= 40).length;
  const avgConf = rows.length
    ? rows.reduce((s, r) => s + r.confidence, 0) / rows.length
    : 0;
  const tile = (label: string, value: string, sub: string) =>
    `<div class="tile"><div class="label">${label}</div><div class="value">${value}</div><div class="sub">${sub}</div></div>`;
  return `<div class="tiles">
    ${tile("Scored properties", String(rows.length), unscored ? `${unscored} without a score` : "all addresses scored")}
    ${tile("Median score", median.toFixed(1), "for this contractor type")}
    ${tile("Hot leads", String(hot), "score 40 or higher")}
    ${tile("Avg confidence", avgConf.toFixed(2), "imagery age &amp; quality")}
  </div>`;
}

function chipsFor(findings: string): string {
  if (!findings) return `<span class="chips"></span>`;
  const chips = findings.split("; ").map((f) => {
    const sev3 = f.includes("(sev 3)");
    const label = esc(f.replace(/ \(sev \d\)/, ""));
    return `<span class="chip ${sev3 ? "s3" : "s2"}">${label}${sev3 ? " · sev 3" : ""}</span>`;
  });
  return `<span class="chips">${chips.join("")}</span>`;
}

function renderTablePage(
  rows: LeadRow[],
  unscored: number,
  type: ContractorType,
  minScore: number,
): string {
  const tableRows = rows
    .map((r) => {
      const delta =
        r.delta === null
          ? `<span class="delta na">—</span>`
          : `<span class="delta">${r.delta > 0 ? "▲ +" : r.delta < 0 ? "▼ " : ""}${r.delta.toFixed(1)}</span>`;
      const low = r.confidence < 0.6 ? `<span class="low-tag">low</span>` : "";
      return `<tr>
        <td class="num rank">${r.rank}</td>
        <td class="addr">${esc(r.address)}${r.zip ? ` <span class="zip">${esc(r.zip)}</span>` : ""}</td>
        <td class="score-cell">
          <div class="score-val">${r.score.toFixed(1)}</div>
          <div class="score-track" title="score ${r.score.toFixed(1)} / 100"><div class="score-fill" style="width:${Math.min(100, r.score)}%"></div></div>
        </td>
        <td class="num">${delta}</td>
        <td class="num conf">${r.confidence.toFixed(2)}${low}</td>
        <td class="imagery">${esc(r.imageryDate ?? "?")}</td>
        <td>${chipsFor(r.topFindings)}</td>
        <td class="notes">${esc(r.notes)}</td>
      </tr>`;
    })
    .join("\n");

  const body = `
${statTiles(rows, unscored)}
<div class="card">
  <div class="card-head"><h2>Ranked leads — ${type}</h2><span class="sub">score 0–100, weighted for this contractor type · Δ vs previous scan</span></div>
  <div class="tbl-scroll">
  <table>
    <thead><tr><th class="num">#</th><th>Address</th><th>Score</th><th class="num">Δ</th><th class="num">Conf.</th><th>Imagery</th><th>Findings (severity ≥ 2)</th><th>Notes</th></tr></thead>
    <tbody>${tableRows || `<tr><td colspan="8"><div class="empty">No scored addresses yet — run a scan first:<br><code>bun run src/cli.ts scan-list addresses.example.json</code></div></td></tr>`}</tbody>
  </table>
  </div>
</div>
<p class="foot">Leads are "worth a look" signals from public imagery, not inspections. Low-confidence rows have stale or partial imagery.</p>`;
  return chrome("table", type, minScore, body);
}

/* ---------------- map page ---------------- */

function renderMapPage(rows: LeadRow[], type: ContractorType, minScore: number): string {
  const data = JSON.stringify(
    rows.map((r) => ({
      a: r.address, lat: r.lat, lng: r.lng, s: r.score, c: r.confidence, f: r.topFindings,
    })),
  );
  const body = `
<div class="card">
  <div class="card-head"><h2>Lead map — ${type}</h2><span class="sub">darker pin = higher score · click for details</span></div>
  <div id="map"></div>
  <div class="map-legend" id="legend"><span>Score</span></div>
</div>
<p class="foot">Base map tiles need internet access; pins render regardless.</p>
<script src="/assets/leaflet.js"></script>
<script>
  const rows = ${data};
  // Pins render on OSM tiles, which are light regardless of the UI theme —
  // always use the light-surface ramp (each pin carries a white ring).
  const ramp = ${JSON.stringify(SCORE_RAMP_LIGHT)};
  const BUCKETS = ${JSON.stringify(SCORE_BUCKETS)};
  const bucket = (s) => BUCKETS.findIndex((b) => s < b) === -1 ? BUCKETS.length : BUCKETS.findIndex((b) => s < b);

  const labels = ["0–15", "15–30", "30–45", "45–60", "60+"];
  const legend = document.getElementById("legend");
  labels.forEach((l, i) => {
    const el = document.createElement("span");
    el.className = "lg";
    el.innerHTML = '<span class="sw" style="background:' + ramp[i] + '"></span>' + l;
    legend.appendChild(el);
  });

  const map = L.map("map");
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(map);
  const bounds = [];
  for (const r of rows) {
    if (!r.lat && !r.lng) continue;
    bounds.push([r.lat, r.lng]);
    const b = bucket(r.s);
    L.circleMarker([r.lat, r.lng], {
      radius: 7 + b, fillColor: ramp[b], fillOpacity: 1,
      color: "#ffffff", weight: 2, // 2px surface ring so pins separate from tiles
    })
      .bindPopup(
        "<b>" + r.a + "</b><br>Score: " + r.s.toFixed(1) + " (conf " + r.c.toFixed(2) + ")" +
          (r.f ? "<br>" + r.f : ""),
      )
      .addTo(map);
  }
  if (bounds.length) map.fitBounds(bounds, { padding: [30, 30] });
  else map.setView([39.5, -98.35], 4);
</script>`;
  return chrome("map", type, minScore, body);
}

/* ---------------- server ---------------- */

export function startServer(deps: PipelineDeps, port: number) {
  const { store } = deps;
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

      // /api/* is also consumed by the browser extension — allow cross-origin.
      const cors = {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-headers": "content-type",
      };
      if (url.pathname.startsWith("/api/") && req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: cors });
      }
      if (url.pathname === "/api/results") {
        const { rows } = await loadRows(store, type, minScore);
        return Response.json({ contractorType: type, rows }, { headers: cors });
      }
      if (url.pathname === "/api/scan" && req.method === "POST") {
        const body = (await req.json().catch(() => null)) as { address?: string } | null;
        const address = body?.address?.trim();
        if (!address || address.length > 200) {
          return Response.json({ error: "body must be {address: string}" }, { status: 400, headers: cors });
        }
        const outcome = await scanAddress(deps, address);
        if (outcome.kind === "skipped_cached") {
          const scan = await store.latestScanFor(outcome.address);
          return Response.json({ kind: "already_scored", scan }, { headers: cors });
        }
        return Response.json({ kind: outcome.kind, scan: outcome.scan }, { headers: cors });
      }

      if (url.pathname === "/assets/leaflet.js" || url.pathname === "/assets/leaflet.css") {
        const name = url.pathname.endsWith(".js") ? "leaflet.js" : "leaflet.css";
        const file = Bun.file(`${import.meta.dir}/../node_modules/leaflet/dist/${name}`);
        return new Response(file, {
          headers: {
            "content-type": name.endsWith(".js") ? "text/javascript" : "text/css",
            "cache-control": "public, max-age=86400",
          },
        });
      }
      if (url.pathname === "/favicon.ico") return new Response(null, { status: 204 });
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
