/**
 * Scan pipeline. Per address: geocode (skipped when the input already
 * carries coordinates, e.g. from a parcel-dataset import) -> Street View
 * metadata -> images (street + satellite) -> optional Solar API roof facts
 * -> single Claude Vision call -> deterministic scoring -> store.
 *
 * Runs through a bounded worker pool (Phase 2); Google calls share a
 * minimum-interval rate limiter. Resume falls out of the cache rule: never
 * re-analyze an address whose latest scan used the same Street View capture
 * date — imagery hasn't changed, so the answer hasn't.
 */
import type { Config } from "./config.ts";
import type { GoogleClient, SolarInsights } from "./google.ts";
import { runPool } from "./queue.ts";
import { computeScores } from "./scoring.ts";
import type { Store } from "./store.ts";
import type { AddressInfo, ScanRecord } from "./types.ts";
import type { VisionClient } from "./vision.ts";

export interface PipelineDeps {
  config: Config;
  google: GoogleClient;
  vision: VisionClient;
  store: Store;
}

/** A raw address string (needs geocoding) or an already-resolved record. */
export type ScanTarget = string | AddressInfo;

export type ScanOutcome =
  | { kind: "scored"; scan: ScanRecord }
  | { kind: "skipped_cached"; address: string }
  | { kind: "no_reliable_imagery"; scan: ScanRecord }
  | { kind: "error"; scan: ScanRecord };

export function parcelContext(info: AddressInfo, now: Date = new Date()): string | undefined {
  const p = info.parcel;
  if (!p || (!p.yearBuilt && !p.sqft && !p.lastSaleYear)) return undefined;
  const parts: string[] = [];
  if (p.yearBuilt) parts.push(`built ${p.yearBuilt} (${now.getFullYear() - p.yearBuilt} years old)`);
  if (p.sqft) parts.push(`${p.sqft} sqft`);
  if (p.lastSaleYear) parts.push(`last sold ${p.lastSaleYear}`);
  return `County parcel data for this property: ${parts.join(", ")}. Use as prior context (roof/window age expectations), but trust the imagery over the prior.`;
}

export function solarContext(solar: SolarInsights | null): string | undefined {
  if (!solar || solar.roofSegmentCount === 0) return undefined;
  const segs = solar.segments
    .slice(0, 8)
    .map((s) => `pitch ${s.pitchDegrees}°, facing ${s.azimuthDegrees}°, ${s.areaM2} m²`)
    .join("; ");
  return (
    `Roof facts from Google Solar API (imagery ${solar.imageryDate ?? "date unknown"}): ` +
    `${solar.roofSegmentCount} roof segments` +
    (solar.roofAreaM2 ? `, total ~${solar.roofAreaM2} m²` : "") +
    `. Segments: ${segs}. ` +
    `Use these to distinguish original roof planes from add-ons and to interpret the satellite image.`
  );
}

export async function scanAddress(
  deps: PipelineDeps,
  target: ScanTarget,
): Promise<ScanOutcome> {
  const { config, google, vision, store } = deps;
  const scanDate = new Date().toISOString();

  const info =
    typeof target === "string" ? await google.geocode(target) : target;
  if (!info) {
    const scan: ScanRecord = {
      address: String(target), lat: 0, lng: 0, zip: null, scanDate,
      status: "error", panoId: null, imageryCaptureDate: null,
      model: null, report: null, scores: null, error: "geocoding failed",
    };
    await store.saveScan(scan);
    return { kind: "error", scan };
  }

  const meta = await google.streetViewMetadata(info.lat, info.lng);

  const previous = await store.latestScanFor(info.address);
  if (
    previous?.status === "scored" &&
    previous.imageryCaptureDate !== null &&
    previous.imageryCaptureDate === meta.captureDate
  ) {
    return { kind: "skipped_cached", address: info.address };
  }

  const base: Omit<ScanRecord, "status" | "report" | "scores"> = {
    address: info.address, lat: info.lat, lng: info.lng, zip: info.zip,
    scanDate, panoId: meta.panoId, imageryCaptureDate: meta.captureDate,
    model: config.anthropicModel,
  };

  let images;
  try {
    images = await google.fetchImages(info, meta);
  } catch (e) {
    const scan: ScanRecord = { ...base, status: "error", report: null, scores: null, error: String(e) };
    await store.saveScan(scan);
    return { kind: "error", scan };
  }

  // Coverage gap: no usable imagery at all -> explicit status, never a
  // forced score on bad data.
  if (images.length === 0) {
    const scan: ScanRecord = { ...base, status: "no_reliable_imagery", report: null, scores: null };
    await store.saveScan(scan);
    return { kind: "no_reliable_imagery", scan };
  }

  const contextParts: string[] = [];
  const parcel = parcelContext(info);
  if (parcel) contextParts.push(parcel);
  if (config.useSolar) {
    try {
      const solar = solarContext(await google.solarInsights(info.lat, info.lng));
      if (solar) contextParts.push(solar);
    } catch {
      // solar is additive context only — never fail a scan over it
    }
  }
  const context = contextParts.length ? contextParts.join("\n\n") : undefined;

  try {
    const report = await vision.analyze(info.address, images, context);
    const scores = computeScores(report, meta.captureDate, config.maxImageAgeMonths);
    const scan: ScanRecord = { ...base, status: "scored", report, scores };
    await store.saveScan(scan);
    return { kind: "scored", scan };
  } catch (e) {
    const scan: ScanRecord = { ...base, status: "error", report: null, scores: null, error: String(e) };
    await store.saveScan(scan);
    return { kind: "error", scan };
  }
}

export async function scanAddresses(
  deps: PipelineDeps,
  targets: ScanTarget[],
  onProgress?: (done: number, total: number, outcome: ScanOutcome) => void,
): Promise<ScanOutcome[]> {
  const { concurrency, scanDelayMs } = deps.config;
  let done = 0;

  if (concurrency <= 1) {
    const outcomes: ScanOutcome[] = [];
    for (let i = 0; i < targets.length; i++) {
      const outcome = await scanAddress(deps, targets[i]);
      outcomes.push(outcome);
      onProgress?.(++done, targets.length, outcome);
      if (i < targets.length - 1) await Bun.sleep(scanDelayMs);
    }
    return outcomes;
  }

  return runPool(targets, concurrency, async (target) => {
    const outcome = await scanAddress(deps, target);
    onProgress?.(++done, targets.length, outcome);
    return outcome;
  });
}
