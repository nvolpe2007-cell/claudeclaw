/**
 * Import addresses from an OpenAddresses-style CSV (or any county parcel
 * export with compatible columns) — real full-coverage discovery for a zip,
 * replacing the reverse-geocode grid. Rows carry coordinates, so imported
 * addresses skip the Geocoding API entirely during scans.
 *
 * Recognized headers (case-insensitive): LON/LONGITUDE, LAT/LATITUDE,
 * NUMBER, STREET, UNIT, CITY, REGION/STATE, POSTCODE/ZIP — plus optional
 * assessor columns YEAR_BUILT, SQFT, LAST_SALE, which become parcel context
 * for the vision model (roof age priors, single-pane priors, flip signals).
 */
import type { AddressInfo, ParcelData } from "./types.ts";

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

const HEADER_ALIASES: Record<string, string[]> = {
  lon: ["lon", "longitude", "lng", "x"],
  lat: ["lat", "latitude", "y"],
  number: ["number", "house_number", "housenumber", "addr_number"],
  street: ["street", "street_name", "addr_street"],
  unit: ["unit"],
  city: ["city", "municipality", "place"],
  region: ["region", "state", "province"],
  postcode: ["postcode", "zip", "zipcode", "postal_code"],
  year_built: ["year_built", "yearbuilt", "yr_built", "yr_blt", "effective_year"],
  sqft: ["sqft", "building_sqft", "bldg_sqft", "building_area", "living_area"],
  last_sale: ["last_sale", "last_sale_date", "sale_date", "last_sale_year", "sale_year"],
};

function headerIndex(headers: string[]): Record<string, number> {
  const lower = headers.map((h) => h.trim().toLowerCase());
  const idx: Record<string, number> = {};
  for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
    const i = lower.findIndex((h) => aliases.includes(h));
    if (i >= 0) idx[key] = i;
  }
  return idx;
}

export interface ImportResult {
  addresses: AddressInfo[];
  totalRows: number;
  skipped: number;
}

export function parseAddressCsv(csv: string, zipFilter: string | null): ImportResult {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return { addresses: [], totalRows: 0, skipped: 0 };

  const idx = headerIndex(parseCsvLine(lines[0]));
  for (const required of ["lon", "lat", "number", "street"]) {
    if (!(required in idx)) {
      throw new Error(
        `CSV missing a recognizable "${required}" column (headers: ${lines[0]})`,
      );
    }
  }

  const seen = new Set<string>();
  const addresses: AddressInfo[] = [];
  let skipped = 0;

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const get = (key: string) => (key in idx ? (cols[idx[key]] ?? "").trim() : "");

    const lon = Number(get("lon"));
    const lat = Number(get("lat"));
    const number = get("number");
    const street = get("street");
    const postcode = get("postcode") || null;

    if (!number || !street || !Number.isFinite(lat) || !Number.isFinite(lon) || lat === 0) {
      skipped++;
      continue;
    }
    if (zipFilter && postcode !== zipFilter) {
      skipped++;
      continue;
    }

    const parts = [
      `${number} ${street}${get("unit") ? ` ${get("unit")}` : ""}`,
      get("city"),
      [get("region"), postcode].filter(Boolean).join(" "),
    ].filter(Boolean);
    const address = parts.join(", ");

    const key = address.toLowerCase();
    if (seen.has(key)) {
      skipped++;
      continue;
    }
    seen.add(key);

    const parcel: ParcelData = {};
    const yearBuilt = Number(get("year_built"));
    if (yearBuilt >= 1600 && yearBuilt <= 2100) parcel.yearBuilt = yearBuilt;
    const sqft = Number(get("sqft"));
    if (sqft > 0) parcel.sqft = Math.round(sqft);
    const saleYearMatch = /(\d{4})/.exec(get("last_sale"));
    if (saleYearMatch) parcel.lastSaleYear = Number(saleYearMatch[1]);

    addresses.push({
      address, lat, lng: lon, zip: postcode,
      ...(Object.keys(parcel).length ? { parcel } : {}),
    });
  }

  return { addresses, totalRows: lines.length - 1, skipped };
}
