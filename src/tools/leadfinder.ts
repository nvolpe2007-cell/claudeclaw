// Lead finder: find businesses without websites via the Google Places API (New).
//
// Usage:
//   bun run src/tools/leadfinder.ts "plumbers in Austin TX" [options]
//
// Requires the GOOGLE_PLACES_API_KEY environment variable (a Google Cloud API
// key with "Places API (New)" enabled).

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

const SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";

const FIELD_MASK = [
  "nextPageToken",
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.nationalPhoneNumber",
  "places.websiteUri",
  "places.rating",
  "places.userRatingCount",
  "places.googleMapsUri",
  "places.types",
  "places.businessStatus",
].join(",");

// Text Search returns at most 20 results per page and 60 per query.
const PAGE_SIZE = 20;
const API_MAX_RESULTS = 60;

// Domains that indicate a social profile or link-in-bio page rather than a
// real website. Includes auto-generated site builders (business.site,
// square.site) and directory listings (yelp, thumbtack) in the same spirit.
const SOCIAL_DOMAINS = [
  "facebook.com", "fb.com", "fb.me", "m.me", "instagram.com",
  "linktr.ee", "linkin.bio", "beacons.ai", "bio.link", "taplink.cc",
  "x.com", "twitter.com", "t.co", "tiktok.com", "youtube.com", "youtu.be",
  "wa.me", "whatsapp.com", "linkedin.com", "yelp.com", "nextdoor.com",
  "pinterest.com", "threads.net", "business.site", "godaddysites.com",
  "square.site", "booksy.com", "thumbtack.com", "angi.com",
];

interface Place {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  nationalPhoneNumber?: string;
  websiteUri?: string;
  rating?: number;
  userRatingCount?: number;
  googleMapsUri?: string;
  types?: string[];
  businessStatus?: string;
}

type WebsiteStatus = "no website" | "social only" | "has website";

interface CliOptions {
  query: string;
  out?: string;
  max: number;
  includeWithWebsite: boolean;
  minReviews: number;
}

const USAGE = `Usage: bun run src/tools/leadfinder.ts "<search query>" [options]

Finds businesses without websites using the Google Places API and writes
them to a CSV file for lead generation.

Options:
  --out <file>             Output CSV path (default: leads-<query>-<date>.csv)
  --max <n>                Max places to fetch, up to 60 (default: 60)
  --min-reviews <n>        Skip listings with fewer reviews (default: 0)
  --include-with-website   Also include businesses that have a real website
  --help                   Show this help

Environment:
  GOOGLE_PLACES_API_KEY    Google Cloud API key with Places API (New) enabled

Example:
  bun run src/tools/leadfinder.ts "plumbers in Austin TX" --max 40`;

export function parseArgs(argv: string[]): CliOptions {
  const positional: string[] = [];
  const options: CliOptions = { query: "", max: API_MAX_RESULTS, includeWithWebsite: false, minReviews: 0 };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      console.log(USAGE);
      process.exit(0);
    } else if (arg === "--include-with-website") {
      options.includeWithWebsite = true;
    } else if (arg === "--out") {
      options.out = argv[++i];
      if (!options.out) fail("--out requires a file path");
    } else if (arg === "--max" || arg === "--min-reviews") {
      const value = Number(argv[++i]);
      if (!Number.isFinite(value) || value < 0) fail(`${arg} requires a non-negative number`);
      if (arg === "--max") options.max = Math.min(value, API_MAX_RESULTS);
      else options.minReviews = value;
    } else if (arg.startsWith("--")) {
      fail(`Unknown option: ${arg}\n\n${USAGE}`);
    } else {
      positional.push(arg);
    }
  }

  options.query = positional.join(" ").trim();
  if (!options.query) fail(USAGE);
  return options;
}

export function classifyWebsite(websiteUri: string | undefined): WebsiteStatus {
  if (!websiteUri || !websiteUri.trim()) return "no website";
  let hostname: string;
  try {
    hostname = new URL(websiteUri).hostname.toLowerCase();
  } catch {
    hostname = websiteUri.toLowerCase();
  }
  hostname = hostname.replace(/^www\./, "");
  const social = SOCIAL_DOMAINS.some((d) => hostname === d || hostname.endsWith(`.${d}`));
  return social ? "social only" : "has website";
}

export function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function toCsv(rows: string[][]): string {
  return rows.map((row) => row.map(csvEscape).join(",")).join("\n") + "\n";
}

export function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

async function searchPlaces(query: string, apiKey: string, max: number): Promise<Place[]> {
  const places: Place[] = [];
  let pageToken: string | undefined;
  let page = 0;

  while (places.length < max) {
    if (pageToken) {
      // A fresh pageToken needs a moment before it becomes valid.
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    page++;

    const response = await fetch(SEARCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": FIELD_MASK,
      },
      body: JSON.stringify(pageToken ? { textQuery: query, pageToken } : { textQuery: query }),
    });

    if (!response.ok) {
      const body = await response.text();
      let message = body;
      try {
        message = JSON.parse(body)?.error?.message ?? body;
      } catch {
        // keep raw body
      }
      throw new Error(`Places API request failed (HTTP ${response.status}): ${message}`);
    }

    const data = (await response.json()) as { places?: Place[]; nextPageToken?: string };
    places.push(...(data.places ?? []));
    console.log(`${DIM}Fetched page ${page} (${places.length} places so far)${RESET}`);

    pageToken = data.nextPageToken;
    if (!pageToken || (data.places ?? []).length < PAGE_SIZE) break;
  }

  return places.slice(0, max);
}

function fail(message: string): never {
  console.error(`${RED}${message}${RESET}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    fail(
      "GOOGLE_PLACES_API_KEY is not set. Create a Google Cloud API key with " +
        '"Places API (New)" enabled and export it:\n\n' +
        "  export GOOGLE_PLACES_API_KEY=your-key-here",
    );
  }

  console.log(`Searching for: ${options.query}`);
  const places = await searchPlaces(options.query, apiKey, options.max);

  const counts: Record<WebsiteStatus, number> = { "no website": 0, "social only": 0, "has website": 0 };
  const rows: string[][] = [
    ["name", "address", "phone", "rating", "review_count", "maps_url", "website_status", "website_url"],
  ];

  for (const place of places) {
    if (place.businessStatus === "CLOSED_PERMANENTLY") continue;
    if ((place.userRatingCount ?? 0) < options.minReviews) continue;

    const status = classifyWebsite(place.websiteUri);
    counts[status]++;
    if (status === "has website" && !options.includeWithWebsite) continue;

    rows.push([
      place.displayName?.text ?? "",
      place.formattedAddress ?? "",
      place.nationalPhoneNumber ?? "",
      place.rating?.toString() ?? "",
      place.userRatingCount?.toString() ?? "",
      place.googleMapsUri ?? "",
      status,
      status === "no website" ? "" : place.websiteUri ?? "",
    ]);
  }

  const date = new Date().toISOString().slice(0, 10);
  const outPath = options.out ?? `leads-${slugify(options.query)}-${date}.csv`;
  await Bun.write(outPath, toCsv(rows));

  const leadCount = rows.length - 1;
  console.log(`${GREEN}Wrote ${leadCount} lead${leadCount === 1 ? "" : "s"} to ${outPath}${RESET}`);
  console.log(`  no website:   ${counts["no website"]}`);
  console.log(`  social only:  ${counts["social only"]}`);
  console.log(`  has website:  ${counts["has website"]} (${options.includeWithWebsite ? "included" : "excluded"})`);
  console.log(`Fetched ${places.length} places total.`);
}

if (import.meta.main) {
  main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
}
