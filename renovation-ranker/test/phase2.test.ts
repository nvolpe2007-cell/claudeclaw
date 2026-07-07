import { describe, expect, test } from "bun:test";
import { scoreDeltas } from "../src/export.ts";
import { estimateScan, type Pricing } from "../src/estimate.ts";
import { parseAddressCsv } from "../src/importer.ts";
import { RateLimiter, runPool } from "../src/queue.ts";
import type { ScanRecord, Scores } from "../src/types.ts";
import { ranks, spearman } from "../src/validate.ts";

describe("runPool", () => {
  test("preserves order and bounds concurrency", async () => {
    let inFlight = 0;
    let peak = 0;
    const results = await runPool([1, 2, 3, 4, 5, 6, 7, 8], 3, async (n) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await Bun.sleep(5);
      inFlight--;
      return n * 2;
    });
    expect(results).toEqual([2, 4, 6, 8, 10, 12, 14, 16]);
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1);
  });
});

describe("RateLimiter", () => {
  test("spaces grants by the minimum interval", async () => {
    const limiter = new RateLimiter(20);
    const t0 = Date.now();
    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();
    expect(Date.now() - t0).toBeGreaterThanOrEqual(38); // ~2 intervals, timer slop
  });
});

describe("spearman", () => {
  test("perfect agreement -> 1", () => {
    expect(spearman([1, 2, 3, 4], [10, 20, 30, 40])).toBe(1);
  });
  test("perfect inversion -> -1", () => {
    expect(spearman([1, 2, 3, 4], [40, 30, 20, 10])).toBe(-1);
  });
  test("no variance -> null", () => {
    expect(spearman([1, 1, 1], [1, 2, 3])).toBeNull();
  });
  test("too few pairs -> null", () => {
    expect(spearman([1, 2], [2, 1])).toBeNull();
  });
  test("ranks average ties", () => {
    expect(ranks([10, 20, 20, 30])).toEqual([1, 2.5, 2.5, 4]);
  });
});

describe("parseAddressCsv", () => {
  const csv = [
    "LON,LAT,NUMBER,STREET,UNIT,CITY,DISTRICT,REGION,POSTCODE,ID,HASH",
    '-118.44,34.15,4321,"VENTURA BLVD",,SHERMAN OAKS,,CA,91423,1,abc',
    "-118.45,34.16,4325,VENTURA BLVD,,SHERMAN OAKS,,CA,91423,2,def",
    "-118.46,34.17,100,OTHER ST,,LOS ANGELES,,CA,90001,3,ghi",
    "-118.44,34.15,4321,VENTURA BLVD,,SHERMAN OAKS,,CA,91423,4,dup",
    ",,,BAD ROW,,,,,,5,jkl",
  ].join("\n");

  test("filters by zip, dedupes, skips bad rows", () => {
    const result = parseAddressCsv(csv, "91423");
    expect(result.addresses.length).toBe(2);
    expect(result.addresses[0].address).toBe("4321 VENTURA BLVD, SHERMAN OAKS, CA 91423");
    expect(result.addresses[0].lat).toBe(34.15);
    expect(result.addresses[0].zip).toBe("91423");
    expect(result.skipped).toBe(3); // other zip + duplicate + bad row
  });

  test("no zip filter keeps all valid unique rows", () => {
    const result = parseAddressCsv(csv, null);
    expect(result.addresses.length).toBe(3);
  });

  test("missing required column throws", () => {
    expect(() => parseAddressCsv("A,B\n1,2", null)).toThrow(/missing/);
  });
});

describe("scoreDeltas", () => {
  function scan(address: string, scanDate: string, general: number): ScanRecord {
    const scores = {
      categories: {} as Scores["categories"],
      byContractor: { roofing: general, siding: general, windows: general, landscaping: general, general },
      confidence: 1,
    };
    return {
      address, lat: 0, lng: 0, zip: null, scanDate, status: "scored",
      panoId: null, imageryCaptureDate: "2026-01", model: "m",
      report: null as any, scores,
    };
  }

  test("delta = latest minus previous; single scans excluded", () => {
    const deltas = scoreDeltas(
      [
        scan("A", "2026-01-01T00:00:00Z", 30),
        scan("A", "2026-06-01T00:00:00Z", 45.5),
        scan("B", "2026-06-01T00:00:00Z", 10),
      ],
      "general",
    );
    expect(deltas.get("A")).toBe(15.5);
    expect(deltas.has("B")).toBe(false);
  });
});

describe("estimateScan", () => {
  const pricing: Pricing = {
    geocode_per_call: 0.005,
    sv_metadata_per_call: 0,
    street_view_image_per_call: 0.007,
    static_map_per_call: 0.002,
    vision_input_tokens_per_address: 6000,
    vision_output_tokens_per_address: 1500,
    claude_input_per_mtok: 5,
    claude_output_per_mtok: 25,
    batch_discount: 0.5,
  };

  test("batch mode halves token cost; pre-geocoded drops geocoding line", () => {
    const full = estimateScan(pricing, {
      addresses: 100, streetViewImagesPerAddress: 3, useBatch: false, preGeocoded: false,
    });
    const batch = estimateScan(pricing, {
      addresses: 100, streetViewImagesPerAddress: 3, useBatch: true, preGeocoded: true,
    });
    const sum = (ls: typeof full) => ls.reduce((s, l) => s + l.total, 0);
    expect(full.some((l) => l.label === "Geocoding")).toBe(true);
    expect(batch.some((l) => l.label === "Geocoding")).toBe(false);
    const fullTokens = full.filter((l) => l.label.startsWith("Claude"));
    const batchTokens = batch.filter((l) => l.label.startsWith("Claude"));
    expect(sum(batchTokens)).toBeCloseTo(sum(fullTokens) / 2, 2);
  });
});

describe("json store under concurrency", () => {
  test("concurrent saveScan calls don't lose writes", async () => {
    const { createStore } = await import("../src/store.ts");
    const dir = `/tmp/rr-store-test-${Date.now()}`;
    const store = createStore(null, dir);
    const scan = (address: string): ScanRecord => ({
      address, lat: 0, lng: 0, zip: null, scanDate: new Date().toISOString(),
      status: "error", panoId: null, imageryCaptureDate: null,
      model: null, report: null, scores: null, error: "test",
    });
    await Promise.all(
      Array.from({ length: 10 }, (_, i) => store.saveScan(scan(`addr-${i}`))),
    );
    expect((await store.allScans()).length).toBe(10);
    await store.close();
  });
});
