/**
 * Storage layer: Postgres when DATABASE_URL is set (schema.sql), otherwise a
 * JSON file store so the tool runs with zero infrastructure while validating
 * the prompt/scoring against a known address list.
 */
import { mkdirSync } from "node:fs";
import pg from "pg";
import { CATEGORIES, type ScanRecord } from "./types.ts";

export interface Store {
  saveScan(scan: ScanRecord): Promise<void>;
  /** Latest scan per address, newest first. */
  latestScans(): Promise<ScanRecord[]>;
  /** Latest scan for one address, if any. */
  latestScanFor(address: string): Promise<ScanRecord | null>;
  /** Every scan (all dates) — powers re-scan trend tracking. */
  allScans(): Promise<ScanRecord[]>;
  close(): Promise<void>;
}

export function createStore(databaseUrl: string | null, dataDir: string): Store {
  return databaseUrl ? createPgStore(databaseUrl) : createJsonStore(dataDir);
}

/* ---------------- JSON file store ---------------- */

function createJsonStore(dataDir: string): Store {
  mkdirSync(dataDir, { recursive: true });
  const file = `${dataDir}/scans.json`;

  // The scan pool calls saveScan concurrently; read-modify-write on one file
  // loses updates unless serialized. All file access goes through this chain.
  let chain: Promise<unknown> = Promise.resolve();
  function serialized<R>(fn: () => Promise<R>): Promise<R> {
    const next = chain.then(fn, fn);
    chain = next.catch(() => {});
    return next;
  }

  async function readAll(): Promise<ScanRecord[]> {
    const f = Bun.file(file);
    if (!(await f.exists())) return [];
    return (await f.json()) as ScanRecord[];
  }

  return {
    async saveScan(scan) {
      await serialized(async () => {
        const all = await readAll();
        all.push(scan);
        await Bun.write(file, JSON.stringify(all, null, 2));
      });
    },
    async latestScans() {
      const all = await serialized(readAll);
      const byAddress = new Map<string, ScanRecord>();
      for (const s of all) {
        const prev = byAddress.get(s.address);
        if (!prev || s.scanDate > prev.scanDate) byAddress.set(s.address, s);
      }
      return [...byAddress.values()].sort((a, b) => b.scanDate.localeCompare(a.scanDate));
    },
    async latestScanFor(address) {
      const all = await serialized(readAll);
      let latest: ScanRecord | null = null;
      for (const s of all) {
        if (s.address === address && (!latest || s.scanDate > latest.scanDate)) latest = s;
      }
      return latest;
    },
    async allScans() {
      return serialized(readAll);
    },
    async close() {},
  };
}

/* ---------------- Postgres store ---------------- */

function createPgStore(databaseUrl: string): Store {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  let initialized = false;

  async function init() {
    if (initialized) return;
    const schema = await Bun.file(`${import.meta.dir}/../schema.sql`).text();
    await pool.query(schema);
    initialized = true;
  }

  function rowToScan(row: any): ScanRecord {
    return {
      address: row.address,
      lat: row.lat,
      lng: row.lng,
      zip: row.zip,
      scanDate: new Date(row.scan_date).toISOString(),
      status: row.status,
      panoId: row.pano_id,
      imageryCaptureDate: row.imagery_capture_date,
      model: row.model,
      report: row.report,
      scores: row.scores,
      error: row.error ?? undefined,
    };
  }

  return {
    async saveScan(scan) {
      await init();
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const prop = await client.query(
          `INSERT INTO properties (address, lat, lng, zip) VALUES ($1, $2, $3, $4)
           ON CONFLICT (address) DO UPDATE SET lat = EXCLUDED.lat, lng = EXCLUDED.lng, zip = EXCLUDED.zip
           RETURNING id`,
          [scan.address, scan.lat, scan.lng, scan.zip],
        );
        const propertyId = prop.rows[0].id;
        const ins = await client.query(
          `INSERT INTO scans (property_id, scan_date, status, pano_id, imagery_capture_date, model, report, scores, error)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
          [
            propertyId,
            scan.scanDate,
            scan.status,
            scan.panoId,
            scan.imageryCaptureDate,
            scan.model,
            scan.report ? JSON.stringify(scan.report) : null,
            scan.scores ? JSON.stringify(scan.scores) : null,
            scan.error ?? null,
          ],
        );
        if (scan.report) {
          const scanId = ins.rows[0].id;
          for (const cat of CATEGORIES) {
            for (const [item, f] of Object.entries(scan.report.findings[cat] ?? {})) {
              await client.query(
                `INSERT INTO scan_findings (scan_id, category, item, severity, visible, evidence)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [scanId, cat, item, f.severity, f.visible, f.evidence],
              );
            }
          }
        }
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    },

    async latestScans() {
      await init();
      const res = await pool.query(
        `SELECT DISTINCT ON (p.id) p.address, p.lat, p.lng, p.zip,
                s.scan_date, s.status, s.pano_id, s.imagery_capture_date, s.model, s.report, s.scores, s.error
         FROM properties p JOIN scans s ON s.property_id = p.id
         ORDER BY p.id, s.scan_date DESC`,
      );
      return res.rows
        .map(rowToScan)
        .sort((a, b) => b.scanDate.localeCompare(a.scanDate));
    },

    async latestScanFor(address) {
      await init();
      const res = await pool.query(
        `SELECT p.address, p.lat, p.lng, p.zip,
                s.scan_date, s.status, s.pano_id, s.imagery_capture_date, s.model, s.report, s.scores, s.error
         FROM properties p JOIN scans s ON s.property_id = p.id
         WHERE p.address = $1 ORDER BY s.scan_date DESC LIMIT 1`,
        [address],
      );
      return res.rows[0] ? rowToScan(res.rows[0]) : null;
    },

    async allScans() {
      await init();
      const res = await pool.query(
        `SELECT p.address, p.lat, p.lng, p.zip,
                s.scan_date, s.status, s.pano_id, s.imagery_capture_date, s.model, s.report, s.scores, s.error
         FROM properties p JOIN scans s ON s.property_id = p.id
         ORDER BY s.scan_date ASC`,
      );
      return res.rows.map(rowToScan);
    },

    async close() {
      await pool.end();
    },
  };
}
