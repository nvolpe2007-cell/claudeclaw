import { join } from "path";
import { mkdir } from "fs/promises";

export const DATA_DIR = join(process.cwd(), ".claude", "claudeclaw", "dropshipping");
const STORE_FILE = join(DATA_DIR, "store.json");
const PRODUCTS_FILE = join(DATA_DIR, "products.json");
const ORDERS_FILE = join(DATA_DIR, "orders.json");
const ADS_FILE = join(DATA_DIR, "ads.json");
const ANALYTICS_FILE = join(DATA_DIR, "analytics.json");
const REFUNDS_FILE = join(DATA_DIR, "refunds.json");
const TIKTOK_FILE = join(DATA_DIR, "tiktok-posts.json");

export interface Product {
  id: string;
  name: string;
  description: string;
  supplierUrl: string;
  supplierPrice: number;
  salePrice: number;
  margin: number;
  category: string;
  tags: string[];
  status: "active" | "paused" | "draft";
  stock: number;
  addedAt: string;
  lastUpdated: string;
}

export interface Order {
  id: string;
  productId: string;
  productName: string;
  customerEmail: string;
  quantity: number;
  unitPrice: number;
  total: number;
  profit: number;
  status: "pending" | "processing" | "shipped" | "delivered" | "cancelled";
  createdAt: string;
  updatedAt: string;
}

export interface AdCampaign {
  id: string;
  productId: string;
  platform: "facebook" | "instagram" | "google" | "tiktok" | "email" | "twitter";
  headline: string;
  body: string;
  callToAction: string;
  targetAudience: string;
  estimatedBudget: number;
  status: "draft" | "active" | "paused" | "completed";
  impressions: number;
  clicks: number;
  conversions: number;
  createdAt: string;
}

export interface StoreConfig {
  name: string;
  niche: string;
  currency: string;
  targetMargin: number;
  initialized: boolean;
  lastProductResearch: string | null;
  lastAdRun: string | null;
  lastSalesReport: string | null;
}

export interface Analytics {
  totalRevenue: number;
  totalProfit: number;
  totalOrders: number;
  conversionRate: number;
  topProducts: string[];
  dailyRevenue: Record<string, number>;
  lastUpdated: string;
}

async function ensureDir(): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
}

export async function loadStore(): Promise<StoreConfig> {
  await ensureDir();
  try {
    return await Bun.file(STORE_FILE).json();
  } catch {
    const defaults: StoreConfig = {
      name: "My Dropshipping Store",
      niche: "general",
      currency: "USD",
      targetMargin: 40,
      initialized: false,
      lastProductResearch: null,
      lastAdRun: null,
      lastSalesReport: null,
    };
    return defaults;
  }
}

export async function saveStore(config: StoreConfig): Promise<void> {
  await ensureDir();
  await Bun.write(STORE_FILE, JSON.stringify(config, null, 2) + "\n");
}

export async function loadProducts(): Promise<Product[]> {
  await ensureDir();
  try {
    return await Bun.file(PRODUCTS_FILE).json();
  } catch {
    return [];
  }
}

export async function saveProducts(products: Product[]): Promise<void> {
  await ensureDir();
  await Bun.write(PRODUCTS_FILE, JSON.stringify(products, null, 2) + "\n");
}

export async function addProduct(product: Omit<Product, "id" | "addedAt" | "lastUpdated">): Promise<Product> {
  const products = await loadProducts();
  const now = new Date().toISOString();
  const newProduct: Product = {
    ...product,
    id: crypto.randomUUID(),
    addedAt: now,
    lastUpdated: now,
  };
  products.push(newProduct);
  await saveProducts(products);
  return newProduct;
}

export async function updateProduct(id: string, updates: Partial<Product>): Promise<Product | null> {
  const products = await loadProducts();
  const idx = products.findIndex((p) => p.id === id);
  if (idx === -1) return null;
  products[idx] = { ...products[idx], ...updates, lastUpdated: new Date().toISOString() };
  await saveProducts(products);
  return products[idx];
}

export async function loadOrders(): Promise<Order[]> {
  await ensureDir();
  try {
    return await Bun.file(ORDERS_FILE).json();
  } catch {
    return [];
  }
}

export async function saveOrders(orders: Order[]): Promise<void> {
  await ensureDir();
  await Bun.write(ORDERS_FILE, JSON.stringify(orders, null, 2) + "\n");
}

export async function addOrder(order: Omit<Order, "id" | "createdAt" | "updatedAt">): Promise<Order> {
  const orders = await loadOrders();
  const now = new Date().toISOString();
  const newOrder: Order = {
    ...order,
    id: `ORD-${Date.now()}`,
    createdAt: now,
    updatedAt: now,
  };
  orders.push(newOrder);
  await saveOrders(orders);
  return newOrder;
}

export async function loadAds(): Promise<AdCampaign[]> {
  await ensureDir();
  try {
    return await Bun.file(ADS_FILE).json();
  } catch {
    return [];
  }
}

export async function saveAds(ads: AdCampaign[]): Promise<void> {
  await ensureDir();
  await Bun.write(ADS_FILE, JSON.stringify(ads, null, 2) + "\n");
}

export async function addAd(ad: Omit<AdCampaign, "id" | "createdAt" | "impressions" | "clicks" | "conversions">): Promise<AdCampaign> {
  const ads = await loadAds();
  const newAd: AdCampaign = {
    ...ad,
    id: crypto.randomUUID(),
    impressions: 0,
    clicks: 0,
    conversions: 0,
    createdAt: new Date().toISOString(),
  };
  ads.push(newAd);
  await saveAds(ads);
  return newAd;
}

export async function loadAnalytics(): Promise<Analytics> {
  await ensureDir();
  try {
    return await Bun.file(ANALYTICS_FILE).json();
  } catch {
    return {
      totalRevenue: 0,
      totalProfit: 0,
      totalOrders: 0,
      conversionRate: 0,
      topProducts: [],
      dailyRevenue: {},
      lastUpdated: new Date().toISOString(),
    };
  }
}

export async function recalcAnalytics(): Promise<Analytics> {
  const orders = await loadOrders();
  const completed = orders.filter((o) => o.status === "delivered" || o.status === "shipped");
  const dailyRevenue: Record<string, number> = {};

  for (const order of completed) {
    const day = order.createdAt.slice(0, 10);
    dailyRevenue[day] = (dailyRevenue[day] ?? 0) + order.total;
  }

  const productRevenue: Record<string, number> = {};
  for (const order of completed) {
    productRevenue[order.productId] = (productRevenue[order.productId] ?? 0) + order.total;
  }
  const topProducts = Object.entries(productRevenue)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id]) => id);

  const analytics: Analytics = {
    totalRevenue: completed.reduce((s, o) => s + o.total, 0),
    totalProfit: completed.reduce((s, o) => s + o.profit, 0),
    totalOrders: completed.length,
    conversionRate: orders.length > 0 ? (completed.length / orders.length) * 100 : 0,
    topProducts,
    dailyRevenue,
    lastUpdated: new Date().toISOString(),
  };

  await Bun.write(ANALYTICS_FILE, JSON.stringify(analytics, null, 2) + "\n");
  return analytics;
}

export function formatCurrency(amount: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
}

// ─── Refunds ───────────────────────────────────────────────────────────────

export interface RefundRequest {
  id: string;
  orderId: string;
  productId: string;
  productName: string;
  customerEmail: string;
  amount: number;
  reason: string;
  status: "pending" | "approved" | "processed" | "denied";
  processorRefundId: string | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export async function loadRefunds(): Promise<RefundRequest[]> {
  await ensureDir();
  try {
    return await Bun.file(REFUNDS_FILE).json();
  } catch {
    return [];
  }
}

export async function saveRefunds(refunds: RefundRequest[]): Promise<void> {
  await ensureDir();
  await Bun.write(REFUNDS_FILE, JSON.stringify(refunds, null, 2) + "\n");
}

export async function addRefund(refund: Omit<RefundRequest, "id" | "createdAt" | "updatedAt" | "processorRefundId">): Promise<RefundRequest> {
  const refunds = await loadRefunds();
  const now = new Date().toISOString();
  const newRefund: RefundRequest = {
    ...refund,
    id: `REF-${Date.now()}`,
    processorRefundId: null,
    createdAt: now,
    updatedAt: now,
  };
  refunds.push(newRefund);
  await saveRefunds(refunds);
  return newRefund;
}

export async function updateRefund(id: string, updates: Partial<RefundRequest>): Promise<RefundRequest | null> {
  const refunds = await loadRefunds();
  const idx = refunds.findIndex((r) => r.id === id);
  if (idx === -1) return null;
  refunds[idx] = { ...refunds[idx], ...updates, updatedAt: new Date().toISOString() };
  await saveRefunds(refunds);
  return refunds[idx];
}

// ─── TikTok Posts ──────────────────────────────────────────────────────────

export interface TikTokPost {
  id: string;
  productId: string;
  productName: string;
  script: string;
  caption: string;
  hashtags: string[];
  hookText: string;
  videoUrl: string | null;
  publishId: string | null;
  status: "draft" | "scheduled" | "posted" | "failed";
  views: number;
  likes: number;
  comments: number;
  shares: number;
  scheduledFor: string | null;
  postedAt: string | null;
  createdAt: string;
}

export async function loadTikTokPosts(): Promise<TikTokPost[]> {
  await ensureDir();
  try {
    return await Bun.file(TIKTOK_FILE).json();
  } catch {
    return [];
  }
}

export async function saveTikTokPosts(posts: TikTokPost[]): Promise<void> {
  await ensureDir();
  await Bun.write(TIKTOK_FILE, JSON.stringify(posts, null, 2) + "\n");
}

export async function addTikTokPost(post: Omit<TikTokPost, "id" | "createdAt" | "views" | "likes" | "comments" | "shares">): Promise<TikTokPost> {
  const posts = await loadTikTokPosts();
  const newPost: TikTokPost = {
    ...post,
    id: crypto.randomUUID(),
    views: 0,
    likes: 0,
    comments: 0,
    shares: 0,
    createdAt: new Date().toISOString(),
  };
  posts.push(newPost);
  await saveTikTokPosts(posts);
  return newPost;
}

export async function updateTikTokPost(id: string, updates: Partial<TikTokPost>): Promise<TikTokPost | null> {
  const posts = await loadTikTokPosts();
  const idx = posts.findIndex((p) => p.id === id);
  if (idx === -1) return null;
  posts[idx] = { ...posts[idx], ...updates };
  await saveTikTokPosts(posts);
  return posts[idx];
}
