export interface Config {
  googleApiKey: string;
  anthropicModel: string;
  databaseUrl: string | null;
  /** JSON file store used when DATABASE_URL is unset */
  dataDir: string;
  /** ms delay between addresses in a scan (Phase 1: sequential, rate-limited) */
  scanDelayMs: number;
  /** Imagery older than this many months lowers confidence and gets flagged */
  maxImageAgeMonths: number;
  /** MOCK=1 replaces Google + Anthropic clients with deterministic fixtures */
  mock: boolean;
  serverPort: number;
}

export function loadConfig(): Config {
  const mock = process.env.MOCK === "1";
  const googleApiKey = process.env.GOOGLE_MAPS_API_KEY ?? "";
  if (!mock && !googleApiKey) {
    throw new Error(
      "GOOGLE_MAPS_API_KEY is required (or set MOCK=1 for offline mode)",
    );
  }
  return {
    googleApiKey,
    anthropicModel: process.env.ANTHROPIC_MODEL ?? "claude-opus-4-8",
    databaseUrl: process.env.DATABASE_URL ?? null,
    dataDir: process.env.DATA_DIR ?? `${import.meta.dir}/../data`,
    scanDelayMs: Number(process.env.SCAN_DELAY_MS ?? 1100),
    maxImageAgeMonths: Number(process.env.MAX_IMAGE_AGE_MONTHS ?? 24),
    mock,
    serverPort: Number(process.env.PORT ?? 8787),
  };
}
