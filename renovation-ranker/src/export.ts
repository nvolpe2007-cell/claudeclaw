/**
 * Contractor-segmented lead lists. A roofer doesn't care about window
 * findings — each export is ranked by that contractor type's weighted score
 * and only carries evidence from the categories that type is weighted on.
 */
import { CONTRACTOR_WEIGHTS } from "./scoring.ts";
import type { Category, ContractorType, ScanRecord } from "./types.ts";
import { workSummary } from "./workplan.ts";

export interface LeadRow {
  rank: number;
  address: string;
  zip: string | null;
  lat: number;
  lng: number;
  score: number;
  /** Change vs previous scan of the same address (null = first scan) */
  delta: number | null;
  confidence: number;
  imageryDate: string | null;
  topFindings: string;
  /** Deterministic "what needs done" summary from workplan.ts */
  suggestedWork: string;
  /** From parcel data: null = unknown, true = owner lives there, false = absentee owner */
  ownerOccupied: boolean | null;
  /** Owner's mailing address, when non-owner-occupied — who to actually contact */
  ownerMailingAddress: string | null;
  notes: string;
}

function relevantCategories(type: ContractorType): Category[] {
  return Object.keys(CONTRACTOR_WEIGHTS[type]) as Category[];
}

/** address -> score delta vs the previous scored scan, for one contractor type. */
export function scoreDeltas(
  allScans: ScanRecord[],
  type: ContractorType,
): Map<string, number> {
  const byAddress = new Map<string, ScanRecord[]>();
  for (const s of allScans) {
    if (s.status !== "scored" || !s.scores) continue;
    const list = byAddress.get(s.address) ?? [];
    list.push(s);
    byAddress.set(s.address, list);
  }
  const deltas = new Map<string, number>();
  for (const [address, scans] of byAddress) {
    if (scans.length < 2) continue;
    scans.sort((a, b) => a.scanDate.localeCompare(b.scanDate));
    const prev = scans[scans.length - 2].scores!.byContractor[type];
    const latest = scans[scans.length - 1].scores!.byContractor[type];
    deltas.set(address, Math.round((latest - prev) * 10) / 10);
  }
  return deltas;
}

export function leadsFor(
  scans: ScanRecord[],
  type: ContractorType,
  minScore = 0,
  deltas?: Map<string, number>,
): LeadRow[] {
  const rows = scans
    .filter((s) => s.status === "scored" && s.scores && s.report)
    .map((s) => {
      const findings: string[] = [];
      for (const cat of relevantCategories(type)) {
        for (const [item, f] of Object.entries(s.report!.findings[cat] ?? {})) {
          if (f.visible && f.severity >= 2) {
            findings.push(`${item.replaceAll("_", " ")} (sev ${f.severity})`);
          }
        }
      }
      return {
        address: s.address,
        zip: s.zip,
        lat: s.lat,
        lng: s.lng,
        score: s.scores!.byContractor[type],
        delta: deltas?.get(s.address) ?? null,
        confidence: s.scores!.confidence,
        imageryDate: s.imageryCaptureDate,
        topFindings: findings.slice(0, 5).join("; "),
        suggestedWork: workSummary(s, relevantCategories(type)),
        ownerOccupied: s.parcel?.ownerOccupied ?? null,
        ownerMailingAddress: s.parcel?.ownerMailingAddress ?? null,
        notes: s.report!.overall_notes,
      };
    })
    .filter((r) => r.score >= minScore)
    .sort((a, b) => b.score - a.score || b.confidence - a.confidence);

  return rows.map((r, i) => ({ rank: i + 1, ...r }));
}

function csvEscape(v: string | number | null): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

export function leadsToCsv(rows: LeadRow[]): string {
  const header =
    "rank,address,zip,lat,lng,score,delta,confidence,imagery_date,top_findings,suggested_work,owner_occupied,owner_mailing_address,notes";
  const ownerOccupiedStr = (v: boolean | null) => (v === null ? "" : v ? "yes" : "no");
  const lines = rows.map((r) =>
    [
      r.rank, r.address, r.zip, r.lat, r.lng, r.score, r.delta, r.confidence, r.imageryDate,
      r.topFindings, r.suggestedWork, ownerOccupiedStr(r.ownerOccupied), r.ownerMailingAddress, r.notes,
    ]
      .map(csvEscape)
      .join(","),
  );
  return [header, ...lines].join("\n") + "\n";
}
