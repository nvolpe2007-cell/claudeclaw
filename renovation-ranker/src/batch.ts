/**
 * Claude Batch API mode: image acquisition happens now (Google fetches),
 * but the vision analyses are submitted as one message batch at 50% of
 * standard token prices. Fine for lead-gen scans — nothing is real-time.
 *
 *   batch-submit  -> fetch imagery, submit batch, write state file
 *   batch-status  -> processing status + request counts
 *   batch-collect -> stream results, score, store (results are unordered;
 *                    everything is matched by custom_id)
 *
 * In MOCK=1 mode, submit processes everything synchronously with the mock
 * vision client so the flow is testable offline.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { Config } from "./config.ts";
import type { GoogleClient } from "./google.ts";
import { scanAddresses, solarContext, type PipelineDeps, type ScanTarget } from "./pipeline.ts";
import { computeScores } from "./scoring.ts";
import type { Store } from "./store.ts";
import type { AddressInfo, ScanRecord, StreetViewMeta } from "./types.ts";
import { buildVisionParams, parseVisionResponse } from "./vision.ts";

interface BatchItem {
  customId: string;
  info: AddressInfo;
  panoId: string | null;
  captureDate: string | null;
}

interface BatchState {
  batchId: string;
  model: string;
  createdAt: string;
  items: BatchItem[];
}

function stateFile(dataDir: string, batchId: string): string {
  return `${dataDir}/batches/${batchId}.json`;
}

export interface BatchDeps {
  config: Config;
  google: GoogleClient;
  store: Store;
}

export async function batchSubmit(
  deps: BatchDeps,
  targets: ScanTarget[],
  log: (line: string) => void,
): Promise<string | null> {
  const { config, google, store } = deps;

  if (config.mock) {
    // Offline: run the normal pipeline synchronously so the flow is testable.
    const { createMockVisionClient } = await import("./mock.ts");
    const pipelineDeps: PipelineDeps = { config, google, store, vision: createMockVisionClient() };
    log("MOCK=1: processing batch synchronously with mock vision client");
    await scanAddresses(pipelineDeps, targets, (done, total, o) =>
      log(`[${done}/${total}] ${o.kind === "skipped_cached" ? o.address : o.scan.address} — ${o.kind}`),
    );
    return null;
  }

  const client = new Anthropic({ maxRetries: 4 });
  const requests: Anthropic.Messages.Batches.BatchCreateParams.Request[] = [];
  const items: BatchItem[] = [];

  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];
    const info = typeof target === "string" ? await google.geocode(target) : target;
    if (!info) {
      log(`skip (geocoding failed): ${target}`);
      continue;
    }
    const meta: StreetViewMeta = await google.streetViewMetadata(info.lat, info.lng);

    const previous = await store.latestScanFor(info.address);
    if (
      previous?.status === "scored" &&
      previous.imageryCaptureDate !== null &&
      previous.imageryCaptureDate === meta.captureDate
    ) {
      log(`skip (imagery unchanged): ${info.address}`);
      continue;
    }

    const images = await google.fetchImages(info, meta);
    if (images.length === 0) {
      await store.saveScan({
        address: info.address, lat: info.lat, lng: info.lng, zip: info.zip,
        scanDate: new Date().toISOString(), status: "no_reliable_imagery",
        panoId: meta.panoId, imageryCaptureDate: meta.captureDate,
        model: null, report: null, scores: null,
      });
      log(`no reliable imagery: ${info.address}`);
      continue;
    }

    let context: string | undefined;
    if (config.useSolar) {
      try {
        context = solarContext(await google.solarInsights(info.lat, info.lng));
      } catch {}
    }

    const customId = `addr-${i}`;
    items.push({ customId, info, panoId: meta.panoId, captureDate: meta.captureDate });
    requests.push({
      custom_id: customId,
      params: buildVisionParams(config.anthropicModel, info.address, images, context),
    });
    log(`queued: ${info.address} (${images.length} images)`);
  }

  if (requests.length === 0) {
    log("nothing to submit");
    return null;
  }

  const batch = await client.messages.batches.create({ requests });
  const state: BatchState = {
    batchId: batch.id,
    model: config.anthropicModel,
    createdAt: new Date().toISOString(),
    items,
  };
  await Bun.write(stateFile(config.dataDir, batch.id), JSON.stringify(state, null, 2));
  log(`submitted batch ${batch.id} with ${requests.length} requests (status: ${batch.processing_status})`);
  return batch.id;
}

export async function batchStatus(config: Config, batchId: string): Promise<string> {
  const client = new Anthropic();
  const batch = await client.messages.batches.retrieve(batchId);
  const c = batch.request_counts;
  return `${batch.processing_status} — processing: ${c.processing}, succeeded: ${c.succeeded}, errored: ${c.errored}, canceled: ${c.canceled}, expired: ${c.expired}`;
}

export async function batchCollect(
  deps: BatchDeps,
  batchId: string,
  log: (line: string) => void,
): Promise<void> {
  const { config, store } = deps;
  const file = Bun.file(stateFile(config.dataDir, batchId));
  if (!(await file.exists())) {
    throw new Error(`no local state for batch ${batchId} — was it submitted from this machine?`);
  }
  const state = (await file.json()) as BatchState;
  const byId = new Map(state.items.map((i) => [i.customId, i]));

  const client = new Anthropic();
  const batch = await client.messages.batches.retrieve(batchId);
  if (batch.processing_status !== "ended") {
    log(`batch not finished yet: ${await batchStatus(config, batchId)}`);
    return;
  }

  let scored = 0;
  let failed = 0;
  for await (const result of await client.messages.batches.results(batchId)) {
    const item = byId.get(result.custom_id);
    if (!item) continue;
    const base: Omit<ScanRecord, "status" | "report" | "scores"> = {
      address: item.info.address, lat: item.info.lat, lng: item.info.lng,
      zip: item.info.zip, scanDate: new Date().toISOString(),
      panoId: item.panoId, imageryCaptureDate: item.captureDate, model: state.model,
    };
    if (result.result.type === "succeeded") {
      try {
        const report = parseVisionResponse(result.result.message);
        const scores = computeScores(report, item.captureDate, config.maxImageAgeMonths);
        await store.saveScan({ ...base, status: "scored", report, scores });
        scored++;
      } catch (e) {
        await store.saveScan({ ...base, status: "error", report: null, scores: null, error: String(e) });
        failed++;
      }
    } else {
      await store.saveScan({
        ...base, status: "error", report: null, scores: null,
        error: `batch result: ${result.result.type}`,
      });
      failed++;
    }
  }
  log(`collected batch ${batchId}: ${scored} scored, ${failed} failed`);
}
