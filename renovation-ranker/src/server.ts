/**
 * Minimal ranked-table dashboard (Phase 1). Server-rendered HTML table of
 * the latest scan per address, selectable by contractor type, with CSV
 * export of the current view.
 */
import { leadsFor, leadsToCsv } from "./export.ts";
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

async function renderPage(store: Store, type: ContractorType, minScore: number): Promise<string> {
  const scans = await store.latestScans();
  const rows = leadsFor(scans, type, minScore);
  const unscored = scans.filter((s) => s.status !== "scored");

  const options = CONTRACTOR_TYPES.map(
    (t) => `<option value="${t}" ${t === type ? "selected" : ""}>${t}</option>`,
  ).join("");

  const tableRows = rows
    .map(
      (r) => `<tr>
        <td class="num">${r.rank}</td>
        <td>${esc(r.address)}</td>
        <td class="num">${r.score.toFixed(1)}</td>
        <td class="num ${r.confidence < 0.6 ? "low" : ""}">${r.confidence.toFixed(2)}</td>
        <td>${esc(r.imageryDate ?? "?")}</td>
        <td>${esc(r.topFindings)}</td>
        <td class="notes">${esc(r.notes)}</td>
      </tr>`,
    )
    .join("\n");

  const skipped = unscored.length
    ? `<p class="muted">${unscored.length} address(es) without a score (no reliable imagery or errors) — excluded from ranking.</p>`
    : "";

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Renovation Ranker</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: system-ui, sans-serif; margin: 2rem auto; max-width: 1200px; padding: 0 1rem; }
  h1 { font-size: 1.3rem; }
  form { margin: 1rem 0; display: flex; gap: .75rem; align-items: center; flex-wrap: wrap; }
  table { border-collapse: collapse; width: 100%; font-size: .9rem; }
  th, td { border-bottom: 1px solid color-mix(in srgb, currentColor 20%, transparent); padding: .45rem .6rem; text-align: left; vertical-align: top; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  td.low { opacity: .55; }
  td.notes { max-width: 28rem; }
  .muted { opacity: .65; font-size: .85rem; }
  a.button { padding: .3rem .7rem; border: 1px solid currentColor; border-radius: 6px; text-decoration: none; color: inherit; }
</style></head><body>
<h1>Renovation Ranker — lead list</h1>
<form method="get" action="/">
  <label>Contractor type <select name="type" onchange="this.form.submit()">${options}</select></label>
  <label>Min score <input type="number" name="min" value="${minScore}" min="0" max="100" step="5" style="width:4.5rem"></label>
  <button type="submit">Apply</button>
  <a class="button" href="/export.csv?type=${type}&min=${minScore}">Export CSV</a>
</form>
<table>
  <thead><tr><th>#</th><th>Address</th><th>Score</th><th>Conf.</th><th>Imagery</th><th>Findings (sev ≥ 2)</th><th>Notes</th></tr></thead>
  <tbody>${tableRows || `<tr><td colspan="7" class="muted">No scored addresses yet — run a scan first.</td></tr>`}</tbody>
</table>
${skipped}
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
        return new Response(await renderPage(store, type, minScore), {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }
      if (url.pathname === "/api/results") {
        const rows = leadsFor(await store.latestScans(), type, minScore);
        return Response.json({ contractorType: type, rows });
      }
      if (url.pathname === "/export.csv") {
        const rows = leadsFor(await store.latestScans(), type, minScore);
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
