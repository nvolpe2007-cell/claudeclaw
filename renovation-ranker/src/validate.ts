/**
 * Validation harness: compare the model's category scores against your own
 * ground-truth ratings for addresses you know (the plan's validate-before-
 * scaling gate). Reports Spearman rank correlation per category — does the
 * model *rank* houses the way you would? — plus the biggest per-address
 * disagreements with the model's evidence, so prompt/weight tuning is
 * measurable instead of eyeball-driven.
 */
import { CATEGORIES, type Category, type ScanRecord } from "./types.ts";

/** Ground-truth entry: your 0-3 rating per category (omit categories you
 * didn't assess; 0 = fine, 3 = severe). */
export interface GroundTruth {
  address: string;
  expected: Partial<Record<Category, number>>;
}

export interface CategoryValidation {
  category: Category;
  n: number;
  spearman: number | null; // null when fewer than 3 comparable pairs or no variance
}

export interface Disagreement {
  address: string;
  category: Category;
  expected0to100: number;
  model0to100: number;
  gap: number;
  evidence: string;
}

export interface ValidationReport {
  categories: CategoryValidation[];
  overall: CategoryValidation | null;
  disagreements: Disagreement[];
  missingScans: string[];
}

/** Ranks with ties averaged (standard for Spearman). */
export function ranks(values: number[]): number[] {
  const indexed = values.map((v, i) => ({ v, i }));
  indexed.sort((a, b) => a.v - b.v);
  const out = new Array<number>(values.length);
  let pos = 0;
  while (pos < indexed.length) {
    let end = pos;
    while (end + 1 < indexed.length && indexed[end + 1].v === indexed[pos].v) end++;
    const rank = (pos + end) / 2 + 1;
    for (let k = pos; k <= end; k++) out[indexed[k].i] = rank;
    pos = end + 1;
  }
  return out;
}

/** Spearman rank correlation; null if <3 pairs or either side has no variance. */
export function spearman(a: number[], b: number[]): number | null {
  if (a.length !== b.length || a.length < 3) return null;
  const ra = ranks(a);
  const rb = ranks(b);
  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const ma = mean(ra);
  const mb = mean(rb);
  let cov = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < ra.length; i++) {
    cov += (ra[i] - ma) * (rb[i] - mb);
    va += (ra[i] - ma) ** 2;
    vb += (rb[i] - mb) ** 2;
  }
  if (va === 0 || vb === 0) return null;
  return Math.round((cov / Math.sqrt(va * vb)) * 100) / 100;
}

export function validateAgainst(
  truths: GroundTruth[],
  scansByAddress: Map<string, ScanRecord>,
): ValidationReport {
  const missingScans: string[] = [];
  const paired: { truth: GroundTruth; scan: ScanRecord }[] = [];
  for (const t of truths) {
    const scan = scansByAddress.get(t.address);
    if (scan?.status === "scored" && scan.scores) paired.push({ truth: t, scan });
    else missingScans.push(t.address);
  }

  const disagreements: Disagreement[] = [];
  const categories: CategoryValidation[] = [];

  for (const cat of CATEGORIES) {
    const expected: number[] = [];
    const model: number[] = [];
    for (const { truth, scan } of paired) {
      const e = truth.expected[cat];
      if (e === undefined) continue;
      const e100 = (e / 3) * 100;
      const m100 = scan.scores!.categories[cat];
      expected.push(e100);
      model.push(m100);
      const gap = Math.abs(e100 - m100);
      if (gap >= 25) {
        const evidence = Object.values(scan.report!.findings[cat] ?? {})
          .filter((f) => f.visible && f.severity > 0)
          .map((f) => f.evidence)
          .slice(0, 3)
          .join("; ");
        disagreements.push({
          address: truth.address,
          category: cat,
          expected0to100: Math.round(e100),
          model0to100: m100,
          gap: Math.round(gap),
          evidence: evidence || "(model saw no issues)",
        });
      }
    }
    categories.push({ category: cat, n: expected.length, spearman: spearman(expected, model) });
  }

  // Overall: mean of your provided category ratings vs the model's general score.
  const expectedOverall: number[] = [];
  const modelOverall: number[] = [];
  for (const { truth, scan } of paired) {
    const vals = Object.values(truth.expected).filter((v): v is number => v !== undefined);
    if (vals.length === 0) continue;
    expectedOverall.push((vals.reduce((s, v) => s + v, 0) / vals.length / 3) * 100);
    modelOverall.push(scan.scores!.byContractor.general);
  }

  disagreements.sort((a, b) => b.gap - a.gap);
  return {
    categories,
    overall:
      expectedOverall.length > 0
        ? { category: "roof", n: expectedOverall.length, spearman: spearman(expectedOverall, modelOverall) }
        : null,
    disagreements: disagreements.slice(0, 15),
    missingScans,
  };
}

export function formatReport(report: ValidationReport): string {
  const lines: string[] = [];
  lines.push("Validation report — Spearman rank correlation (1.0 = model ranks exactly like you)");
  for (const c of report.categories) {
    lines.push(
      `  ${c.category.padEnd(20)} n=${String(c.n).padStart(2)}  ` +
        (c.spearman === null ? "insufficient data" : `rho=${c.spearman.toFixed(2)}`),
    );
  }
  if (report.overall) {
    lines.push(
      `  ${"OVERALL (general)".padEnd(20)} n=${String(report.overall.n).padStart(2)}  ` +
        (report.overall.spearman === null
          ? "insufficient data"
          : `rho=${report.overall.spearman.toFixed(2)}`),
    );
  }
  if (report.disagreements.length) {
    lines.push("");
    lines.push("Biggest disagreements (gap >= 25 points; tune prompt/weights here):");
    for (const d of report.disagreements) {
      lines.push(
        `  ${d.address} [${d.category}] you: ${d.expected0to100}, model: ${d.model0to100} (gap ${d.gap})`,
      );
      lines.push(`    model evidence: ${d.evidence}`);
    }
  }
  if (report.missingScans.length) {
    lines.push("");
    lines.push(`No scored scan for: ${report.missingScans.join("; ")}`);
  }
  return lines.join("\n");
}
