import { join } from "path";
import { DATA_DIR } from "./store";

const DS_CONFIG_FILE = join(DATA_DIR, "ds-config.json");

export interface TikTokCredentials {
  clientKey: string;
  clientSecret: string;
  accessToken: string;
  refreshToken: string;
  openId: string;
  tokenExpiresAt: string | null;
}

export interface PaymentConfig {
  processor: "stripe" | "paypal" | "manual";
  stripeSecretKey: string;
  paypalClientId: string;
  paypalClientSecret: string;
  paypalSandbox: boolean;
}

export interface LandingPageConfig {
  outputDir: string;
  baseUrl: string;
  orderFormUrl: string;
  brandColor: string;
  logoUrl: string;
}

export interface OrganicConfig {
  tiktokPostsPerDay: number;
  instagramPostsPerDay: number;
  postingHours: number[];
  hashtagSets: Record<string, string[]>;
}

export interface DropshippingConfig {
  tiktok: TikTokCredentials;
  payment: PaymentConfig;
  landingPage: LandingPageConfig;
  organic: OrganicConfig;
}

const DEFAULTS: DropshippingConfig = {
  tiktok: {
    clientKey: "",
    clientSecret: "",
    accessToken: "",
    refreshToken: "",
    openId: "",
    tokenExpiresAt: null,
  },
  payment: {
    processor: "manual",
    stripeSecretKey: "",
    paypalClientId: "",
    paypalClientSecret: "",
    paypalSandbox: true,
  },
  landingPage: {
    outputDir: join(DATA_DIR, "pages"),
    baseUrl: "http://localhost:8080",
    orderFormUrl: "",
    brandColor: "#6366f1",
    logoUrl: "",
  },
  organic: {
    tiktokPostsPerDay: 5,
    instagramPostsPerDay: 3,
    postingHours: [8, 11, 14, 18, 21],
    hashtagSets: {
      general: ["#viral", "#trending", "#fyp", "#foryou", "#foryoupage"],
      shopping: ["#shop", "#deal", "#sale", "#musthave", "#tiktokmademebuyit"],
      lifestyle: ["#lifestyle", "#productreview", "#unboxing", "#honest"],
    },
  },
};

let cache: DropshippingConfig | null = null;

export async function loadDsConfig(): Promise<DropshippingConfig> {
  if (cache) return cache;
  try {
    const raw = await Bun.file(DS_CONFIG_FILE).json();
    cache = deepMerge(DEFAULTS, raw) as DropshippingConfig;
    return cache;
  } catch {
    cache = structuredClone(DEFAULTS);
    return cache;
  }
}

export async function saveDsConfig(config: DropshippingConfig): Promise<void> {
  cache = config;
  await Bun.write(DS_CONFIG_FILE, JSON.stringify(config, null, 2) + "\n");
}

export async function updateDsConfig(updates: Partial<DropshippingConfig>): Promise<DropshippingConfig> {
  const current = await loadDsConfig();
  const updated = deepMerge(current, updates) as DropshippingConfig;
  await saveDsConfig(updated);
  return updated;
}

function deepMerge(base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> {
  const result = { ...base };
  for (const key of Object.keys(override)) {
    const bv = base[key];
    const ov = override[key];
    if (ov && typeof ov === "object" && !Array.isArray(ov) && bv && typeof bv === "object" && !Array.isArray(bv)) {
      result[key] = deepMerge(bv as Record<string, unknown>, ov as Record<string, unknown>);
    } else if (ov !== undefined) {
      result[key] = ov;
    }
  }
  return result;
}
