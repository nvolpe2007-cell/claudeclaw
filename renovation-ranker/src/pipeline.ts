/**
 * Phase 1 pipeline: rate-limited sequential scan of a list of addresses.
 * Per address: geocode -> Street View metadata -> images (street + satellite)
 * -> single Claude Vision call -> deterministic scoring -> store.
 *
 * Cache rule: never re-analyze an address whose latest scan used the same
 * Street View capture date — imagery hasn't changed, so the answer hasn't.
 */
import type { Config } from "./config.ts";
import type { GoogleClient } from "./google.ts";
import { computeScores } from "./scoring.ts";
import type { Store } from "./store.ts";
import type { ScanRecord } from "./types.ts";
import type { VisionClient } from "./vision.ts";

export interface PipelineDeps {
  config: Config;
  google: GoogleClient;
  vision: VisionClient;
  store: Store;
}

export type ScanOutcome =
  | { kind: "scored"; scan: ScanRecord }
  | { kind: "skipped_cached"; address: string }
  | { kind: "no_reliable_imagery"; scan: ScanRecord }
  | { kind: "error"; scan: ScanRecord };

export async function scanAddress(
  deps: PipelineDeps,
  rawAddress: string,
): Promise<ScanOutcome> {
  const { config, google, vision, store } = deps;
  const scanDate = new Date().toISOString();

  const info = await google.geocode(rawAddress);
  if (!info) {
    const scan: ScanRecord = {
      address: rawAddress, lat: 0, lng: 0, zip: null, scanDate,
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

  try {
    const report = await vision.analyze(info.address, images);
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
  addresses: string[],
  onProgress?: (done: number, total: number, outcome: ScanOutcome) => void,
): Promise<ScanOutcome[]> {
  const outcomes: ScanOutcome[] = [];
  for (let i = 0; i < addresses.length; i++) {
    const outcome = await scanAddress(deps, addresses[i]);
    outcomes.push(outcome);
    onProgress?.(i + 1, addresses.length, outcome);
    if (i < addresses.length - 1) await Bun.sleep(deps.config.scanDelayMs);
  }
  return outcomes;
}
