/**
 * Deterministic scoring on top of the vision model's structured findings.
 * The LLM never produces the rank score — it reports per-sub-item severity
 * (0-3) with evidence, and this module turns that into auditable, tunable
 * numbers. Changing weights here re-ranks without re-prompting.
 */
import {
  CATEGORIES,
  type Category,
  type ContractorType,
  type ImageQuality,
  type Scores,
  SUB_ITEMS,
  type VisionReport,
} from "./types.ts";

const MAX_SEVERITY = 3;

/** Sub-item weights; anything not listed weighs 1.0. Structural/urgent
 * defects weigh more because they close deals for contractors. */
const SUB_ITEM_WEIGHTS: Record<string, number> = {
  exposed_underlayment: 2.0,
  sagging_ridgeline: 2.0,
  missing_or_damaged_shingles: 1.5,
  chimney_or_flashing_damage: 1.5,
  boarded_or_broken_panes: 1.5,
  frame_rot_or_damage: 1.3,
  warped_rotting_siding: 1.3,
  visible_wood_rot_trim: 1.2,
  fascia_rot: 1.2,
  dead_trees_shrubs_near_structure: 1.5,
  heaving: 1.2,
  damaged_screens: 0.5,
  fence_disrepair: 0.8,
};

/** Category weights per contractor type — each type's list must sum to 1. */
export const CONTRACTOR_WEIGHTS: Record<
  ContractorType,
  Partial<Record<Category, number>>
> = {
  roofing: { roof: 0.75, gutters_fascia: 0.25 },
  siding: { siding_paint: 0.85, gutters_fascia: 0.15 },
  windows: { windows: 1.0 },
  landscaping: { landscaping: 0.9, driveway_hardscape: 0.1 },
  general: {
    roof: 0.3,
    siding_paint: 0.25,
    windows: 0.2,
    gutters_fascia: 0.1,
    driveway_hardscape: 0.05,
    landscaping: 0.1,
  },
};

function subItemWeight(item: string): number {
  return SUB_ITEM_WEIGHTS[item] ?? 1.0;
}

/** 0-100: weighted severity relative to the worst possible for the category.
 * Non-visible sub-items contribute 0 severity; visibility gaps are handled
 * via the confidence factor, not the score. */
export function categoryScore(report: VisionReport, category: Category): number {
  const items = SUB_ITEMS[category];
  let total = 0;
  let max = 0;
  for (const item of items) {
    const w = subItemWeight(item);
    max += w * MAX_SEVERITY;
    const finding = report.findings[category]?.[item];
    if (finding && finding.visible) total += w * finding.severity;
  }
  return max === 0 ? 0 : round1((total / max) * 100);
}

export function contractorScore(
  categories: Record<Category, number>,
  type: ContractorType,
): number {
  let score = 0;
  for (const [cat, weight] of Object.entries(CONTRACTOR_WEIGHTS[type])) {
    score += categories[cat as Category] * (weight as number);
  }
  return round1(score);
}

/** Months between a "YYYY-MM" capture date and now; null if unparseable. */
export function imageAgeMonths(
  captureDate: string | null,
  now: Date = new Date(),
): number | null {
  if (!captureDate) return null;
  const m = /^(\d{4})-(\d{2})/.exec(captureDate);
  if (!m) return null;
  return (
    (now.getFullYear() - Number(m[1])) * 12 + (now.getMonth() + 1 - Number(m[2]))
  );
}

/**
 * 0-1 confidence combining imagery age and quality flags. Stale imagery is
 * the biggest accuracy risk in the system, so age dominates: full confidence
 * up to maxAgeMonths, decaying linearly to 0.3 at 8 years.
 */
export function confidence(
  quality: ImageQuality,
  captureDate: string | null,
  maxAgeMonths: number,
  now: Date = new Date(),
): number {
  let c = 1.0;

  const age = imageAgeMonths(captureDate, now);
  if (age === null) {
    c *= 0.7; // unknown capture date
  } else if (age > maxAgeMonths) {
    const ceiling = 96; // 8 years
    const t = Math.min(1, (age - maxAgeMonths) / (ceiling - maxAgeMonths));
    c *= 1 - t * 0.7; // 1.0 -> 0.3
  }

  const sv = { good: 1.0, partial: 0.8, obstructed: 0.5, missing: 0.3 };
  c *= sv[quality.street_view];

  const sat = { good: 1.0, partial: 0.9, missing: 0.85 };
  c *= sat[quality.satellite];

  const id = { high: 1.0, medium: 0.85, low: 0.6 };
  c *= id[quality.house_identification];

  return round2(Math.max(0, Math.min(1, c)));
}

export function computeScores(
  report: VisionReport,
  captureDate: string | null,
  maxAgeMonths: number,
  now: Date = new Date(),
): Scores {
  const categories = Object.fromEntries(
    CATEGORIES.map((c) => [c, categoryScore(report, c)]),
  ) as Record<Category, number>;
  const byContractor = Object.fromEntries(
    (Object.keys(CONTRACTOR_WEIGHTS) as ContractorType[]).map((t) => [
      t,
      contractorScore(categories, t),
    ]),
  ) as Record<ContractorType, number>;
  return {
    categories,
    byContractor,
    confidence: confidence(report.image_quality, captureDate, maxAgeMonths, now),
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
