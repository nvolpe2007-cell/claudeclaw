/**
 * CLI entry point.
 *
 *   bun run src/cli.ts scan-address "123 Main St, Anytown, CA"
 *   bun run src/cli.ts scan-list addresses.json        # validation workflow
 *   bun run src/cli.ts scan-zip 90210 --limit 50
 *   bun run src/cli.ts results [--type roofing] [--min 20]
 *   bun run src/cli.ts export --type roofing > leads.csv
 *   bun run src/cli.ts serve
 *
 * Set MOCK=1 to run everything offline with deterministic fixtures.
 */
import { loadConfig } from "./config.ts";
import { leadsFor, leadsToCsv } from "./export.ts";
import { createGoogleClient } from "./google.ts";
import { createMockGoogleClient, createMockVisionClient } from "./mock.ts";
import { scanAddresses, type PipelineDeps, type ScanOutcome } from "./pipeline.ts";
import { startServer } from "./server.ts";
import { createStore } from "./store.ts";
import { CONTRACTOR_TYPES, type ContractorType } from "./types.ts";
import { createVisionClient } from "./vision.ts";

function getFlag(args: string[], name: string): string | null {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : null;
}

function parseType(v: string | null): ContractorType {
  if (v && !(CONTRACTOR_TYPES as readonly string[]).includes(v)) {
    throw new Error(`unknown contractor type "${v}" (valid: ${CONTRACTOR_TYPES.join(", ")})`);
  }
  return (v as ContractorType) ?? "general";
}

function buildDeps(): PipelineDeps {
  const config = loadConfig();
  const store = createStore(config.databaseUrl, config.dataDir);
  const google = config.mock ? createMockGoogleClient() : createGoogleClient(config.googleApiKey);
  const vision = config.mock ? createMockVisionClient() : createVisionClient(config.anthropicModel);
  return { config, google, vision, store };
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
      const deps = buildDeps();
      await scanAddresses(deps, [address], logOutcome);
      await deps.store.close();
      break;
    }

    case "scan-list": {
      const file = args.find((a) => !a.startsWith("--"));
      if (!file) throw new Error("usage: scan-list <addresses.json>");
      const addresses: string[] = await Bun.file(file).json();
      if (!Array.isArray(addresses) || addresses.some((a) => typeof a !== "string")) {
        throw new Error(`${file} must be a JSON array of address strings`);
      }
      const deps = buildDeps();
      console.log(`Scanning ${addresses.length} addresses (delay ${deps.config.scanDelayMs}ms)...`);
      await scanAddresses(deps, addresses, logOutcome);
      await deps.store.close();
      break;
    }

    case "scan-zip": {
      const zip = args.find((a) => !a.startsWith("--"));
      if (!zip) throw new Error("usage: scan-zip <zip> [--limit N]");
      const limit = Number(getFlag(args, "limit") ?? 25);
      const deps = buildDeps();
      console.log(`Discovering addresses in ${zip} (limit ${limit})...`);
      const found = await deps.google.discoverAddresses(zip, limit);
      console.log(`Found ${found.length} addresses; scanning...`);
      await scanAddresses(deps, found.map((f) => f.address), logOutcome);
      await deps.store.close();
      break;
    }

    case "results": {
      const type = parseType(getFlag(args, "type"));
      const min = Number(getFlag(args, "min") ?? 0);
      const deps = buildDeps();
      const rows = leadsFor(await deps.store.latestScans(), type, min);
      if (rows.length === 0) {
        console.log("No scored addresses yet.");
      } else {
        console.log(`Ranked leads — contractor type: ${type}`);
        for (const r of rows) {
          console.log(
            `${String(r.rank).padStart(3)}. ${r.score.toFixed(1).padStart(5)}  conf ${r.confidence.toFixed(2)}  ${r.address}` +
              (r.topFindings ? `\n       ${r.topFindings}` : ""),
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
      const rows = leadsFor(await deps.store.latestScans(), type, min);
      process.stdout.write(leadsToCsv(rows));
      await deps.store.close();
      break;
    }

    case "serve": {
      const deps = buildDeps();
      const server = startServer(deps.store, deps.config.serverPort);
      console.log(`Dashboard: http://localhost:${server.port}`);
      break;
    }

    default:
      console.log(
        "Commands: scan-address <addr> | scan-list <file.json> | scan-zip <zip> [--limit N] | results [--type T] [--min N] | export [--type T] [--min N] | serve",
      );
      if (command) process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(String(e instanceof Error ? e.message : e));
  process.exit(1);
});
