/**
 * "What needs done": a deterministic, auditable mapping from each visual
 * finding to the work it implies — trade, job description, urgency. Like the
 * scoring layer, this is code, not LLM output, so recommendations are
 * consistent across houses and tunable without re-prompting. Jobs are leads
 * for contractors to verify on site, not quotes.
 */
import type { Category, ScanRecord, Severity } from "./types.ts";

export type Urgency = "urgent" | "recommended" | "maintenance";

interface WorkRule {
  trade: string;
  /** Job wording per severity band; sev1 falls back to `minor` else `job`. */
  job: string;
  minor?: string;
  /** Some findings escalate to urgent below sev 3 (active leak risk etc.) */
  urgentAt?: Severity;
}

const RULES: Record<string, WorkRule> = {
  // roof
  missing_or_damaged_shingles: {
    trade: "roofing",
    job: "shingle repair or partial re-roof",
    minor: "spot shingle repair",
    urgentAt: 3,
  },
  algae_moss_streaking: {
    trade: "roofing",
    job: "roof soft wash / moss treatment",
    minor: "roof soft wash",
  },
  visible_patching: {
    trade: "roofing",
    job: "roof evaluation — prior patch repairs suggest recurring leaks",
  },
  sagging_ridgeline: {
    trade: "roofing",
    job: "structural roof inspection — possible decking or framing failure",
    urgentAt: 2,
  },
  exposed_underlayment: {
    trade: "roofing",
    job: "roof section replacement — exposed underlayment, active leak risk",
    urgentAt: 2,
  },
  roof_section_age_mismatch: {
    trade: "roofing",
    job: "aging roof section replacement (older plane on addition/main)",
  },
  chimney_or_flashing_damage: {
    trade: "roofing",
    job: "chimney/flashing repair — common leak entry point",
    urgentAt: 3,
  },
  // windows
  single_pane_appearance: { trade: "windows", job: "window replacement (single-pane upgrade)" },
  frame_rot_or_damage: { trade: "windows", job: "window frame repair/replacement", urgentAt: 3 },
  fogging_seal_failure: { trade: "windows", job: "IGU (fogged glass) replacement" },
  mismatched_styles: { trade: "windows", job: "whole-house window package (piecemeal history)" },
  boarded_or_broken_panes: { trade: "windows", job: "broken window replacement", urgentAt: 2 },
  damaged_screens: { trade: "windows", job: "screen replacement", minor: "screen repair" },
  // siding / paint
  peeling_chalking_paint: {
    trade: "painting",
    job: "exterior repaint",
    minor: "touch-up paint / power wash",
  },
  cracked_stucco: { trade: "siding/stucco", job: "stucco patch and refinish", urgentAt: 3 },
  warped_rotting_siding: { trade: "siding", job: "siding board replacement or re-side", urgentAt: 3 },
  water_staining: { trade: "siding", job: "moisture source investigation + surface repair" },
  faded_color: { trade: "painting", job: "exterior repaint (UV fade)" },
  visible_wood_rot_trim: { trade: "carpentry", job: "trim replacement (wood rot)", urgentAt: 3 },
  garage_door_damage: { trade: "garage door", job: "garage door repair or replacement" },
  // gutters / fascia
  sagging_gutters: { trade: "gutters", job: "gutter rehang or replacement" },
  rust_staining: { trade: "gutters", job: "gutter replacement (rust-through)" },
  disconnected_downspouts: {
    trade: "gutters",
    job: "downspout reattachment + drainage check",
    minor: "downspout reattachment",
  },
  fascia_rot: { trade: "carpentry", job: "fascia board replacement", urgentAt: 3 },
  // driveway / hardscape
  cracking: { trade: "concrete/paving", job: "driveway crack repair or resurface" },
  heaving: { trade: "concrete/paving", job: "slab section replacement (trip hazard)", urgentAt: 3 },
  oil_staining: { trade: "concrete/paving", job: "driveway cleaning/sealing", minor: "degrease + seal" },
  sun_bleaching: { trade: "concrete/paving", job: "driveway sealcoat" },
  // landscaping
  overgrowth: { trade: "landscaping", job: "full yard cleanup + ongoing maintenance" },
  dead_lawn: { trade: "landscaping", job: "lawn renovation (sod/seed + irrigation check)" },
  dead_trees_shrubs_near_structure: {
    trade: "tree service",
    job: "dead tree/shrub removal near structure (hazard + fire risk)",
    urgentAt: 2,
  },
  fence_disrepair: { trade: "fencing", job: "fence repair or replacement" },
};

export interface WorkItem {
  category: Category;
  item: string;
  severity: Severity;
  trade: string;
  job: string;
  urgency: Urgency;
}

export function urgencyFor(item: string, severity: Severity): Urgency {
  const rule = RULES[item];
  if (rule?.urgentAt !== undefined && severity >= rule.urgentAt) return "urgent";
  return severity >= 2 ? "recommended" : "maintenance";
}

/** All implied work for a scan, most urgent/severe first. Pass `categories`
 * to restrict to a contractor type's relevant categories. */
export function workItemsFor(
  scan: ScanRecord,
  minSeverity: Severity = 1,
  categories?: readonly Category[],
): WorkItem[] {
  if (!scan.report) return [];
  const items: WorkItem[] = [];
  for (const [category, findings] of Object.entries(scan.report.findings)) {
    if (categories && !categories.includes(category as Category)) continue;
    for (const [item, f] of Object.entries(findings)) {
      if (!f.visible || f.severity < minSeverity) continue;
      const rule = RULES[item];
      if (!rule) continue;
      const job = f.severity === 1 && rule.minor ? rule.minor : rule.job;
      items.push({
        category: category as Category,
        item,
        severity: f.severity,
        trade: rule.trade,
        job,
        urgency: urgencyFor(item, f.severity),
      });
    }
  }
  const rank: Record<Urgency, number> = { urgent: 0, recommended: 1, maintenance: 2 };
  return items.sort((a, b) => rank[a.urgency] - rank[b.urgency] || b.severity - a.severity);
}

/** Compact "what needs done" summary for CSV/dashboard rows. */
export function workSummary(
  scan: ScanRecord,
  categories?: readonly Category[],
  max = 4,
): string {
  return workItemsFor(scan, 2, categories)
    .slice(0, max)
    .map((w) => `${w.job}${w.urgency === "urgent" ? " [URGENT]" : ""}`)
    .join(" · ");
}
