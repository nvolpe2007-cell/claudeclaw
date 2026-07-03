import { describe, expect, test } from "bun:test";
import {
  categoryScore,
  computeScores,
  confidence,
  contractorScore,
  imageAgeMonths,
} from "../src/scoring.ts";
import {
  CATEGORIES,
  SUB_ITEMS,
  type Category,
  type ImageQuality,
  type Severity,
  type VisionReport,
} from "../src/types.ts";

const GOOD_QUALITY: ImageQuality = {
  street_view: "good",
  satellite: "good",
  house_identification: "high",
};

function reportWith(
  severities: Partial<Record<Category, Record<string, Severity>>>,
  quality: ImageQuality = GOOD_QUALITY,
): VisionReport {
  const findings = {} as VisionReport["findings"];
  for (const cat of CATEGORIES) {
    findings[cat] = Object.fromEntries(
      SUB_ITEMS[cat].map((item) => {
        const severity = severities[cat]?.[item] ?? 0;
        return [item, { severity, visible: true, evidence: severity ? "test" : "" }];
      }),
    );
  }
  return { findings, image_quality: quality, overall_notes: "test" };
}

const NOW = new Date("2026-07-01T00:00:00Z");

describe("categoryScore", () => {
  test("all zeros -> 0", () => {
    expect(categoryScore(reportWith({}), "roof")).toBe(0);
  });

  test("all max severity -> 100", () => {
    const sev = Object.fromEntries(SUB_ITEMS.roof.map((i) => [i, 3 as Severity]));
    expect(categoryScore(reportWith({ roof: sev }), "roof")).toBe(100);
  });

  test("weighted items move the score more", () => {
    const light = categoryScore(
      reportWith({ roof: { algae_moss_streaking: 3 } }), // weight 1.0
      "roof",
    );
    const heavy = categoryScore(
      reportWith({ roof: { exposed_underlayment: 3 } }), // weight 2.0
      "roof",
    );
    expect(heavy).toBeGreaterThan(light);
  });

  test("non-visible items contribute nothing", () => {
    const report = reportWith({});
    report.findings.roof.exposed_underlayment = {
      severity: 3,
      visible: false,
      evidence: "",
    };
    expect(categoryScore(report, "roof")).toBe(0);
  });
});

describe("contractorScore", () => {
  test("windows contractor only sees the windows category", () => {
    const sev = Object.fromEntries(SUB_ITEMS.roof.map((i) => [i, 3 as Severity]));
    const report = reportWith({ roof: sev });
    const scores = computeScores(report, "2026-01", 24, NOW);
    expect(scores.byContractor.windows).toBe(0);
    expect(scores.byContractor.roofing).toBeGreaterThan(0);
  });

  test("contractor weights sum applies", () => {
    const categories = Object.fromEntries(CATEGORIES.map((c) => [c, 100])) as Record<
      Category,
      number
    >;
    // every profile's weights sum to 1, so uniform 100 -> 100
    expect(contractorScore(categories, "general")).toBe(100);
    expect(contractorScore(categories, "roofing")).toBe(100);
  });
});

describe("imageAgeMonths", () => {
  test("parses YYYY-MM", () => {
    expect(imageAgeMonths("2026-01", NOW)).toBe(6);
    expect(imageAgeMonths("2024-07", NOW)).toBe(24);
  });
  test("null / junk -> null", () => {
    expect(imageAgeMonths(null, NOW)).toBeNull();
    expect(imageAgeMonths("recent", NOW)).toBeNull();
  });
});

describe("confidence", () => {
  test("fresh imagery + good quality -> 1.0", () => {
    expect(confidence(GOOD_QUALITY, "2026-06", 24, NOW)).toBe(1);
  });

  test("stale imagery decays", () => {
    const fresh = confidence(GOOD_QUALITY, "2026-06", 24, NOW);
    const stale = confidence(GOOD_QUALITY, "2021-06", 24, NOW); // 5 years old
    const ancient = confidence(GOOD_QUALITY, "2018-06", 24, NOW); // 8 years old
    expect(stale).toBeLessThan(fresh);
    expect(ancient).toBeLessThan(stale);
    expect(ancient).toBeCloseTo(0.3, 1);
  });

  test("unknown capture date penalized", () => {
    expect(confidence(GOOD_QUALITY, null, 24, NOW)).toBeLessThan(1);
  });

  test("bad street view quality penalized", () => {
    const obstructed = confidence(
      { ...GOOD_QUALITY, street_view: "obstructed" },
      "2026-06",
      24,
      NOW,
    );
    expect(obstructed).toBe(0.5);
  });

  test("low house identification penalized", () => {
    const low = confidence(
      { ...GOOD_QUALITY, house_identification: "low" },
      "2026-06",
      24,
      NOW,
    );
    expect(low).toBe(0.6);
  });
});

describe("computeScores", () => {
  test("produces all categories and contractor types", () => {
    const scores = computeScores(reportWith({}), "2026-06", 24, NOW);
    expect(Object.keys(scores.categories).sort()).toEqual([...CATEGORIES].sort());
    expect(scores.byContractor.general).toBe(0);
    expect(scores.confidence).toBe(1);
  });
});
