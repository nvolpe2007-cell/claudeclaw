/**
 * CLI entry point.
 *
 *   Scanning
 *     scan-address "123 Main St, Anytown, CA"
 *     scan-list addresses.json [--concurrency N]     # strings or {address,lat,lng,zip} objects
 *     scan-zip 90210 [--limit N] [--concurrency N]
 *   Batch API (50% vision cost; not real-time)
 *     batch-submit addresses.json
 *     batch-status <batchId>
 *     batch-collect <batchId>
 *   Address data
 *     import-addresses parcels.csv [--zip 90210] [--out addresses-90210.json]
 *   Validation / analysis
 *     validate ground-truth.json                     # scans missing addresses first
 *     estimate --addresses 500 [--pricing pricing.json] [--batch] [--pre-geocoded]
 *     results [--type roofing] [--min 20] | export [--type T] [--min N] | serve
 *
 * MOCK=1 runs everything offline with deterministic fixtures.
 * SOLAR_API=1 adds Google Solar roof facts to the vision prompt.
 */
import { batchCollect, batchStatus, batchSubmit } from "./batch.ts";
import { loadConfig } from "./config.ts";
import { estimateScan, formatEstimate, type Pricing } from "./estimate.ts";
import { leadsFor, leadsToCsv, scoreDeltas } from "./export.ts";
import { createGoogleClient, withRateLimit } from "./google.ts";
import { parseAddressCsv } from "./importer.ts";
import { createMockGoogleClient, createMockVisionClient } from "./mock.ts";
import { scanAddresses, type PipelineDeps, type ScanOutcome, type ScanTarget } from "./pipeline.ts";
import { startServer } from "./server.ts";
import { createStore } from "./store.ts";
import { CONTRACTOR_TYPES, type AddressInfo, type ContractorType } from "./types.ts";
import { formatReport, validateAgainst, type GroundTruth } from "./validate.ts";
import { createVisionClient } from "./vision.ts";

function getFlag(args: string[], name: string): string | null {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : null;
}
function hasFlag(args: string[], name: string): boolean {
  return args.includes(`--${name}`);
}
function positional(args: string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      i++; // skip flag value
      continue;
    }
    return args[i];
  }
  return undefined;
}

function parseType(v: string | null): ContractorType {
  if (v && !(CONTRACTOR_TYPES as readonly string[]).includes(v)) {
    throw new Error(`unknown contractor type "${v}" (valid: ${CONTRACTOR_TYPES.join(", ")})`);
  }
  return (v as ContractorType) ?? "general";
}

function buildDeps(args: string[] = []): PipelineDeps {
  const config = loadConfig();
  const flagConcurrency = getFlag(args, "concurrency");
  if (flagConcurrency) config.concurrency = Number(flagConcurrency);
  const store = createStore(config.databaseUrl, config.dataDir);
  const google = config.mock
    ? createMockGoogleClient()
    : withRateLimit(createGoogleClient(config.googleApiKey), config.googleMinIntervalMs);
  const vision = config.mock ? createMockVisionClient() : createVisionClient(config.anthropicModel);
  return { config, google, vision, store };
}

/** addresses.json entries: plain strings, or pre-geocoded objects from
 * import-addresses (which skip the Geocoding API). */
async function loadTargets(file: string): Promise<ScanTarget[]> {
  const raw = await Bun.file(file).json();
  if (!Array.isArray(raw)) throw new Error(`${file} must be a JSON array`);
  return raw.map((entry: unknown) => {
    if (typeof entry === "string") return entry;
    const o = entry as AddressInfo;
    if (o && typeof o.address === "string" && typeof o.lat === "number" && typeof o.lng === "number") {
      return {
        address: o.address, lat: o.lat, lng: o.lng, zip: o.zip ?? null,
        ...(o.parcel ? { parcel: o.parcel } : {}),
      };
    }
    throw new Error(`${file}: entries must be strings or {address, lat, lng, zip} objects`);
  });
}

function logOutcome(done: number, total: number, o: ScanOutcome) {
  const label =
    o.kind === "scored"
      ? `scored (general=${o.scan.scores!.byContractor.general}, conf=${o.scan.scores!.confidence})`
      : o.kind === "skipped_cached"
        ? "skipped — imagery unchanged since last scan"
        : o.kind === "no_reliable_imagery"
          ? "no reliable imagery"
          : `error: ${o.scan.error}`;
  const address = o.kind === "skipped_cached" ? o.address : o.scan.address;
  console.log(`[${done}/${total}] ${address} — ${label}`);
}

async function main() {
  const [command, ...args] = process.argv.slice(2);

  switch (command) {
    case "scan-address": {
      const address = args.filter((a) => !a.startsWith("--")).join(" ");
      if (!address) throw new Error("usage: scan-address <address>");
      const deps = buildDeps(args);
      await scanAddresses(deps, [address], logOutcome);
      await deps.store.close();
      break;
    }

    case "scan-list": {
      const file = positional(args);
      if (!file) throw new Error("usage: scan-list <addresses.json> [--concurrency N]");
      const targets = await loadTargets(file);
      const deps = buildDeps(args);
      console.log(
        `Scanning ${targets.length} addresses (concurrency ${deps.config.concurrency})...`,
      );
      await scanAddresses(deps, targets, logOutcome);
      await deps.store.close();
      break;
    }

    case "scan-zip": {
      const zip = positional(args);
      if (!zip) throw new Error("usage: scan-zip <zip> [--limit N] [--concurrency N]");
      const limit = Number(getFlag(args, "limit") ?? 25);
      const deps = buildDeps(args);
      console.log(`Discovering addresses in ${zip} (limit ${limit})...`);
      const found = await deps.google.discoverAddresses(zip, limit);
      console.log(`Found ${found.length} addresses; scanning...`);
      await scanAddresses(deps, found, logOutcome);
      await deps.store.close();
      break;
    }

    case "batch-submit": {
      const file = positional(args);
      if (!file) throw new Error("usage: batch-submit <addresses.json>");
      const targets = await loadTargets(file);
      const deps = buildDeps(args);
      const id = await batchSubmit(deps, targets, console.log);
      if (id) console.log(`\nNext: bun run src/cli.ts batch-status ${id}`);
      await deps.store.close();
      break;
    }

    case "batch-status": {
      const id = positional(args);
      if (!id) throw new Error("usage: batch-status <batchId>");
      console.log(await batchStatus(loadConfig(), id));
      break;
    }

    case "batch-collect": {
      const id = positional(args);
      if (!id) throw new Error("usage: batch-collect <batchId>");
      const deps = buildDeps(args);
      await batchCollect(deps, id, console.log);
      await deps.store.close();
      break;
    }

    case "import-addresses": {
      const file = positional(args);
      if (!file) throw new Error("usage: import-addresses <parcels.csv> [--zip Z] [--out file.json]");
      const zip = getFlag(args, "zip");
      const out = getFlag(args, "out") ?? `addresses-${zip ?? "all"}.json`;
      const csv = await Bun.file(file).text();
      const result = parseAddressCsv(csv, zip);
      await Bun.write(out, JSON.stringify(result.addresses, null, 2));
      console.log(
        `Imported ${result.addresses.length} addresses (${result.skipped} skipped of ${result.totalRows} rows) -> ${out}`,
      );
      console.log(`These carry coordinates, so scans will skip the Geocoding API.`);
      console.log(`Next: bun run src/cli.ts scan-list ${out}`);
      break;
    }

    case "validate": {
      const file = positional(args);
      if (!file) throw new Error("usage: validate <ground-truth.json>");
      const truths = (await Bun.file(file).json()) as GroundTruth[];
      if (!Array.isArray(truths) || truths.some((t) => !t.address || typeof t.expected !== "object")) {
        throw new Error(`${file} must be an array of {address, expected: {category: 0-3}}`);
      }
      const deps = buildDeps(args);

      // Scan anything that doesn't have a scored scan yet.
      const missing: string[] = [];
      for (const t of truths) {
        const scan = await deps.store.latestScanFor(t.address);
        if (scan?.status !== "scored") missing.push(t.address);
      }
      if (missing.length) {
        console.log(`Scanning ${missing.length} unscanned addresses first...`);
        await scanAddresses(deps, missing, logOutcome);
        console.log("");
      }

      const byAddress = new Map<string, Awaited<ReturnType<typeof deps.store.latestScanFor>>>();
      for (const t of truths) byAddress.set(t.address, await deps.store.latestScanFor(t.address));
      const report = validateAgainst(
        truths,
        new Map([...byAddress].filter(([, v]) => v !== null).map(([k, v]) => [k, v!])),
      );
      console.log(formatReport(report));
      await deps.store.close();
      break;
    }

    case "estimate": {
      const addresses = Number(getFlag(args, "addresses") ?? 0);
      if (!addresses) throw new Error("usage: estimate --addresses N [--pricing file] [--batch] [--pre-geocoded]");
      const pricingFile = getFlag(args, "pricing") ?? "pricing.json";
      const f = Bun.file(pricingFile);
      if (!(await f.exists())) {
        throw new Error(
          `${pricingFile} not found — copy pricing.example.json and fill in CURRENT prices first`,
        );
      }
      const pricing = (await f.json()) as Pricing;
      const lines = estimateScan(pricing, {
        addresses,
        streetViewImagesPerAddress: 3,
        useBatch: hasFlag(args, "batch"),
        preGeocoded: hasFlag(args, "pre-geocoded"),
      });
      console.log(formatEstimate(lines, addresses));
      break;
    }

    case "results": {
      const type = parseType(getFlag(args, "type"));
      const min = Number(getFlag(args, "min") ?? 0);
      const deps = buildDeps();
      const deltas = scoreDeltas(await deps.store.allScans(), type);
      const rows = leadsFor(await deps.store.latestScans(), type, min, deltas);
      if (rows.length === 0) {
        console.log("No scored addresses yet.");
      } else {
        console.log(`Ranked leads — contractor type: ${type}`);
        for (const r of rows) {
          const delta =
            r.delta === null ? "" : `  Δ ${r.delta > 0 ? "+" : ""}${r.delta.toFixed(1)}`;
          console.log(
            `${String(r.rank).padStart(3)}. ${r.score.toFixed(1).padStart(5)}${delta}  conf ${r.confidence.toFixed(2)}  ${r.address}` +
              (r.topFindings ? `\n       findings: ${r.topFindings}` : "") +
              (r.suggestedWork ? `\n       work: ${r.suggestedWork}` : ""),
          );
        }
      }
      await deps.store.close();
      break;
    }

    case "export": {
      const type = parseType(getFlag(args, "type"));
      const min = Number(getFlag(args, "min") ?? 0);
      const deps = buildDeps();
      const deltas = scoreDeltas(await deps.store.allScans(), type);
      const rows = leadsFor(await deps.store.latestScans(), type, min, deltas);
      process.stdout.write(leadsToCsv(rows));
      await deps.store.close();
      break;
    }

    case "serve": {
      const deps = buildDeps();
      const server = startServer(deps, deps.config.serverPort);
      console.log(`Dashboard: http://localhost:${server.port} (map: /map)`);
      break;
    }

    default:
      console.log(
        [
          "Commands:",
          "  scan-address <addr> | scan-list <file.json> | scan-zip <zip> [--limit N]   (all: [--concurrency N])",
          "  batch-submit <file.json> | batch-status <id> | batch-collect <id>",
          "  import-addresses <parcels.csv> [--zip Z] [--out file.json]",
          "  validate <ground-truth.json>",
          "  estimate --addresses N [--pricing file] [--batch] [--pre-geocoded]",
          "  results [--type T] [--min N] | export [--type T] [--min N] | serve",
        ].join("\n"),
      );
      if (command) process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(String(e instanceof Error ? e.message : e));
  process.exit(1);
});
