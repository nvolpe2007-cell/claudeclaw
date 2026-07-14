import { describe, expect, test } from "bun:test";
import { parseAddressCsv } from "../src/importer.ts";
import { parcelContext } from "../src/pipeline.ts";
import {
  CATEGORIES,
  SUB_ITEMS,
  type ScanRecord,
  type Severity,
  type VisionReport,
} from "../src/types.ts";
import { urgencyFor, workItemsFor, workSummary } from "../src/workplan.ts";

function scanWith(severities: Record<string, Severity>): ScanRecord {
  const findings = {} as VisionReport["findings"];
  for (const cat of CATEGORIES) {
    findings[cat] = Object.fromEntries(
      SUB_ITEMS[cat].map((item) => [
        item,
        { severity: severities[item] ?? 0, visible: true, evidence: "" },
      ]),
    );
  }
  return {
    address: "x", lat: 0, lng: 0, zip: null, scanDate: "2026-07-01T00:00:00Z",
    status: "scored", panoId: null, imageryCaptureDate: "2026-01", model: "m",
    report: { findings, image_quality: { street_view: "good", satellite: "good", house_identification: "high" }, overall_notes: "" },
    scores: null,
  };
}

describe("workplan", () => {
  test("every sub-item has a work rule", () => {
    for (const cat of CATEGORIES) {
      for (const item of SUB_ITEMS[cat]) {
        expect(urgencyFor(item, 3)).toBeDefined();
        const scan = scanWith({ [item]: 3 });
        const items = workItemsFor(scan);
        expect(items.some((w) => w.item === item)).toBe(true);
      }
    }
  });

  test("urgency escalation: exposed underlayment urgent at sev 2, shingles only at 3", () => {
    expect(urgencyFor("exposed_underlayment", 2)).toBe("urgent");
    expect(urgencyFor("missing_or_damaged_shingles", 2)).toBe("recommended");
    expect(urgencyFor("missing_or_damaged_shingles", 3)).toBe("urgent");
    expect(urgencyFor("algae_moss_streaking", 1)).toBe("maintenance");
  });

  test("urgent items sort first; summary marks them", () => {
    const scan = scanWith({ algae_moss_streaking: 2, exposed_underlayment: 2, cracking: 2 });
    const items = workItemsFor(scan, 2);
    expect(items[0].item).toBe("exposed_underlayment");
    expect(items[0].urgency).toBe("urgent");
    const summary = workSummary(scan);
    expect(summary).toContain("[URGENT]");
    expect(summary).toContain("roof section replacement");
  });

  test("severity 1 uses the minor wording and is excluded from the summary", () => {
    const scan = scanWith({ peeling_chalking_paint: 1 });
    expect(workItemsFor(scan, 1)[0].job).toBe("touch-up paint / power wash");
    expect(workSummary(scan)).toBe(""); // summary is sev >= 2 only
  });

  test("invisible findings produce no work", () => {
    const scan = scanWith({ exposed_underlayment: 3 });
    scan.report!.findings.roof.exposed_underlayment.visible = false;
    expect(workItemsFor(scan).some((w) => w.item === "exposed_underlayment")).toBe(false);
  });
});

describe("parcel import + context", () => {
  const csv = [
    "LON,LAT,NUMBER,STREET,CITY,REGION,POSTCODE,YEAR_BUILT,SQFT,LAST_SALE_DATE",
    "-118.44,34.15,4321,VENTURA BLVD,SHERMAN OAKS,CA,91423,1962,1850,2014-06-30",
    "-118.45,34.16,4325,VENTURA BLVD,SHERMAN OAKS,CA,91423,,,",
  ].join("\n");

  test("assessor columns become parcel data; blanks stay absent", () => {
    const { addresses } = parseAddressCsv(csv, "91423");
    expect(addresses[0].parcel).toEqual({ yearBuilt: 1962, sqft: 1850, lastSaleYear: 2014 });
    expect(addresses[1].parcel).toBeUndefined();
  });

  test("parcelContext renders a prior the model can use", () => {
    const { addresses } = parseAddressCsv(csv, "91423");
    const ctx = parcelContext(addresses[0], new Date("2026-07-01"))!;
    expect(ctx).toContain("built 1962 (64 years old)");
    expect(ctx).toContain("1850 sqft");
    expect(ctx).toContain("last sold 2014");
    expect(parcelContext(addresses[1])).toBeUndefined();
  });
});

describe("owner-occupancy signal", () => {
  const csv = [
    "LON,LAT,NUMBER,STREET,CITY,REGION,POSTCODE,OWNER_OCCUPIED,OWNER_MAILING_ADDRESS",
    // explicit homestead flag, owner-occupied
    "-118.44,34.15,4321,VENTURA BLVD,SHERMAN OAKS,CA,91423,Y,",
    // explicit flag, absentee, with a mailing address
    "-118.45,34.16,4325,VENTURA BLVD,SHERMAN OAKS,CA,91423,N,PO BOX 90 BEVERLY HILLS CA 90210",
    // no flag column value; mailing address matches situs -> owner-occupied
    "-118.46,34.17,4331,VENTURA BLVD,SHERMAN OAKS,CA,91423,,4331 VENTURA BLVD SHERMAN OAKS CA 91423",
    // no flag; mailing address differs -> absentee
    "-118.47,34.18,4341,VENTURA BLVD,SHERMAN OAKS,CA,91423,,999 MAIN ST OTHER CITY CA 90001",
    // neither column populated
    "-118.48,34.19,4351,VENTURA BLVD,SHERMAN OAKS,CA,91423,,",
  ].join("\n");

  test("explicit homestead flag wins over mailing address comparison", () => {
    const { addresses } = parseAddressCsv(csv, "91423");
    expect(addresses[0].parcel).toEqual({ ownerOccupied: true });
    expect(addresses[1].parcel).toEqual({
      ownerOccupied: false,
      ownerMailingAddress: "PO BOX 90 BEVERLY HILLS CA 90210",
    });
  });

  test("falls back to comparing owner mailing address against the situs address", () => {
    const { addresses } = parseAddressCsv(csv, "91423");
    expect(addresses[2].parcel).toEqual({ ownerOccupied: true });
    expect(addresses[3].parcel).toEqual({
      ownerOccupied: false,
      ownerMailingAddress: "999 MAIN ST OTHER CITY CA 90001",
    });
  });

  test("no signal at all leaves parcel undefined", () => {
    const { addresses } = parseAddressCsv(csv, "91423");
    expect(addresses[4].parcel).toBeUndefined();
  });

  test("parcelContext surfaces owner-occupied vs. absentee-owner", () => {
    const { addresses } = parseAddressCsv(csv, "91423");
    expect(parcelContext(addresses[0])).toContain("owner-occupied");
    const absentee = parcelContext(addresses[1])!;
    expect(absentee).toContain("non-owner-occupied");
    expect(absentee).toContain("PO BOX 90 BEVERLY HILLS CA 90210");
    expect(parcelContext(addresses[4])).toBeUndefined();
  });
});
