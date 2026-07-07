export interface Config {
  googleApiKey: string;
  anthropicModel: string;
  databaseUrl: string | null;
  /** JSON file store used when DATABASE_URL is unset */
  dataDir: string;
  /** ms delay between addresses when scanning sequentially (concurrency 1) */
  scanDelayMs: number;
  /** parallel addresses in flight during a scan */
  concurrency: number;
  /** minimum ms between Google API calls across the whole pool */
  googleMinIntervalMs: number;
  /** SOLAR_API=1 adds Google Solar buildingInsights roof facts to the vision prompt */
  useSolar: boolean;
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
    concurrency: Number(process.env.CONCURRENCY ?? 1),
    googleMinIntervalMs: Number(process.env.GOOGLE_MIN_INTERVAL_MS ?? 120),
    useSolar: process.env.SOLAR_API === "1",
    maxImageAgeMonths: Number(process.env.MAX_IMAGE_AGE_MONTHS ?? 24),
    mock,
    serverPort: Number(process.env.PORT ?? 8787),
  };
}
