/**
 * MOCK=1 mode: deterministic fake Google + Claude clients so the full
 * pipeline, scoring, dashboard, and CSV export run end-to-end with no API
 * keys or network. Findings are seeded from the address hash, so runs are
 * reproducible.
 */
import type { GoogleClient } from "./google.ts";
import {
  CATEGORIES,
  SUB_ITEMS,
  type PropertyImage,
  type Severity,
  type VisionReport,
} from "./types.ts";
import type { VisionClient } from "./vision.ts";

// 1x1 gray PNG — stands in for street/satellite imagery.
const TINY_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mO8fPHsfwAIzQNjEqTZ7QAAAABJRU5ErkJggg==";

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Deterministic PRNG per address. */
function rng(seed: number): () => number {
  let state = seed || 1;
  return () => {
    state = Math.imul(state ^ (state >>> 15), state | 1);
    state ^= state + Math.imul(state ^ (state >>> 7), state | 61);
    return ((state ^ (state >>> 14)) >>> 0) / 4294967296;
  };
}

export function createMockGoogleClient(): GoogleClient {
  return {
    async geocode(address) {
      const h = hash(address);
      return {
        address: address.trim(),
        lat: 34 + (h % 1000) / 10000,
        lng: -118 - (h % 900) / 10000,
        zip: "90210",
      };
    },
    async streetViewMetadata(lat, lng) {
      const h = hash(`${lat},${lng}`);
      const year = 2020 + (h % 6);
      const month = String(1 + (h % 12)).padStart(2, "0");
      return {
        status: "OK",
        panoId: `mock-pano-${h}`,
        captureDate: `${year}-${month}`,
        lat: lat + 0.0001,
        lng,
      };
    },
    async fetchImages() {
      const img = { mediaType: "image/png" as const, base64: TINY_PNG };
      return [
        { kind: "street_view", heading: 335, ...img },
        { kind: "street_view", heading: 0, ...img },
        { kind: "street_view", heading: 25, ...img },
        { kind: "satellite", ...img },
      ] satisfies PropertyImage[];
    },
    async discoverAddresses(zip, limit) {
      return Array.from({ length: Math.min(limit, 20) }, (_, i) => ({
        address: `${100 + i * 4} Mock St, Beverly Hills, CA ${zip}`,
        lat: 34.09 + i / 1000,
        lng: -118.4 - i / 1000,
        zip,
      }));
    },
  };
}

export function createMockVisionClient(): VisionClient {
  return {
    async analyze(address) {
      const rand = rng(hash(address));
      const findings = {} as VisionReport["findings"];
      for (const cat of CATEGORIES) {
        const catFindings: Record<string, { severity: Severity; visible: boolean; evidence: string }> = {};
        for (const item of SUB_ITEMS[cat]) {
          const r = rand();
          const severity = (r > 0.92 ? 3 : r > 0.78 ? 2 : r > 0.55 ? 1 : 0) as Severity;
          const visible = rand() > 0.12;
          catFindings[item] = {
            severity: visible ? severity : 0,
            visible,
            evidence: visible && severity > 0 ? `mock: ${item.replaceAll("_", " ")} observed` : "",
          };
        }
        findings[cat] = catFindings;
      }
      return {
        findings,
        image_quality: {
          street_view: rand() > 0.15 ? "good" : "partial",
          satellite: "good",
          house_identification: rand() > 0.2 ? "high" : "medium",
        },
        overall_notes: `Mock assessment for ${address}.`,
      };
    },
  };
}
