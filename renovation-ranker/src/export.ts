/**
 * Contractor-segmented lead lists. A roofer doesn't care about window
 * findings — each export is ranked by that contractor type's weighted score
 * and only carries evidence from the categories that type is weighted on.
 */
import { CONTRACTOR_WEIGHTS } from "./scoring.ts";
import type { Category, ContractorType, ScanRecord } from "./types.ts";

export interface LeadRow {
  rank: number;
  address: string;
  zip: string | null;
  score: number;
  confidence: number;
  imageryDate: string | null;
  topFindings: string;
  notes: string;
}

function relevantCategories(type: ContractorType): Category[] {
  return Object.keys(CONTRACTOR_WEIGHTS[type]) as Category[];
}

export function leadsFor(
  scans: ScanRecord[],
  type: ContractorType,
  minScore = 0,
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
        score: s.scores!.byContractor[type],
        confidence: s.scores!.confidence,
        imageryDate: s.imageryCaptureDate,
        topFindings: findings.slice(0, 5).join("; "),
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
  const header = "rank,address,zip,score,confidence,imagery_date,top_findings,notes";
  const lines = rows.map((r) =>
    [r.rank, r.address, r.zip, r.score, r.confidence, r.imageryDate, r.topFindings, r.notes]
      .map(csvEscape)
      .join(","),
  );
  return [header, ...lines].join("\n") + "\n";
}
