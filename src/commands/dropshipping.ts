import { join } from "path";
import { existsSync } from "fs";
import { mkdir, writeFile, unlink } from "fs/promises";
import {
  loadStore,
  saveStore,
  loadProducts,
  loadOrders,
  loadAds,
  loadAnalytics,
  loadRefunds,
  loadTikTokPosts,
  recalcAnalytics,
  formatCurrency,
  type StoreConfig,
} from "../dropshipping/store";
import { loadDsConfig, saveDsConfig } from "../dropshipping/dsConfig";
import { generateAllLandingPages, generateLandingPage, productSlug } from "../dropshipping/landingPage";
import { getUserInfo, processScheduledPosts } from "../dropshipping/tiktok";
import { processRefund, refundSummary } from "../dropshipping/refunds";
import { run } from "../runner";

const JOBS_DIR = join(process.cwd(), ".claude", "claudeclaw", "jobs");
const PROMPTS_DIR = join(import.meta.dir, "..", "..", "prompts", "dropshipping");

// All agent job definitions
const AGENT_JOBS: Array<{
  name: string;
  schedule: string;
  promptFile: string;
  recurring: boolean;
  notify: boolean;
}> = [
  { name: "dropship-product-researcher", schedule: "0 8,20 * * *",  promptFile: "PRODUCT_RESEARCHER.md",  recurring: true, notify: true  },
  { name: "dropship-store-manager",      schedule: "0 * * * *",      promptFile: "STORE_MANAGER.md",        recurring: true, notify: false },
  { name: "dropship-ad-creator",         schedule: "0 9 * * *",      promptFile: "AD_CREATOR.md",           recurring: true, notify: true  },
  { name: "dropship-sales-monitor",      schedule: "*/30 * * * *",   promptFile: "SALES_MONITOR.md",        recurring: true, notify: true  },
  { name: "dropship-tiktok-organic",     schedule: "0 7 * * *",      promptFile: "TIKTOK_ORGANIC.md",       recurring: true, notify: true  },
  { name: "dropship-landing-pages",      schedule: "0 6 * * *",      promptFile: "LANDING_PAGE_BUILDER.md", recurring: true, notify: false },
  { name: "dropship-refund-manager",     schedule: "0 * * * *",      promptFile: "REFUND_MANAGER.md",       recurring: true, notify: true  },
];

async function readPromptFile(filename: string): Promise<string> {
  const path = join(PROMPTS_DIR, filename);
  try {
    return await Bun.file(path).text();
  } catch {
    throw new Error(`Prompt file not found: ${path}`);
  }
}

async function installAgentJobs(): Promise<void> {
  await mkdir(JOBS_DIR, { recursive: true });
  for (const job of AGENT_JOBS) {
    const prompt = await readPromptFile(job.promptFile);
    const content = [
      `---`,
      `schedule: "${job.schedule}"`,
      `recurring: ${job.recurring}`,
      `notify: ${job.notify}`,
      `---`,
      "",
      prompt,
    ].join("\n");
    const jobPath = join(JOBS_DIR, `${job.name}.md`);
    await writeFile(jobPath, content, "utf8");
    console.log(`  ✓ Installed: ${job.name}`);
  }
}

async function removeAgentJobs(): Promise<void> {
  for (const job of AGENT_JOBS) {
    const jobPath = join(JOBS_DIR, `${job.name}.md`);
    if (existsSync(jobPath)) {
      await unlink(jobPath);
      console.log(`  ✓ Removed: ${job.name}`);
    }
  }
}

function printBanner(): void {
  console.log("");
  console.log("  ╔═══════════════════════════════════════╗");
  console.log("  ║    ClaudeClaw Dropshipping Store      ║");
  console.log("  ╚═══════════════════════════════════════╝");
  console.log("");
}

// ─── Commands ──────────────────────────────────────────────────────────────

async function cmdInit(args: string[]): Promise<void> {
  printBanner();
  const store = await loadStore();
  const niche = args[0] ?? store.niche;
  const name = args.slice(1).join(" ") || store.name;
  const updated: StoreConfig = { ...store, name: name !== "general" ? name : store.name, niche, initialized: true };
  await saveStore(updated);

  console.log(`  Store : ${updated.name}`);
  console.log(`  Niche : ${updated.niche}`);
  console.log(`  Margin: ${updated.targetMargin}%`);
  console.log("");
  console.log("  Installing 7 automated agent jobs...");
  await installAgentJobs();
  console.log("");
  console.log("  ✅ Store initialized with full automation:");
  console.log("  → Product research    : 8 AM & 8 PM daily");
  console.log("  → Landing pages       : 6 AM daily");
  console.log("  → TikTok content      : 7 AM daily (scripts for 5 posts)");
  console.log("  → Ad creator          : 9 AM daily");
  console.log("  → Store manager       : every hour");
  console.log("  → Refund manager      : every hour");
  console.log("  → Sales monitor       : every 30 minutes");
  console.log("");
  console.log("  Next steps:");
  console.log("  1. bun run src/index.ts dropshipping setup:tiktok   — add TikTok credentials");
  console.log("  2. bun run src/index.ts dropshipping setup:payment  — add payment processor");
  console.log("  3. bun run src/index.ts start                       — launch daemon");
}

async function cmdStatus(): Promise<void> {
  printBanner();
  const [store, products, orders, ads, refunds, tiktokPosts, analytics] = await Promise.all([
    loadStore(),
    loadProducts(),
    loadOrders(),
    loadAds(),
    loadRefunds(),
    loadTikTokPosts(),
    loadAnalytics(),
  ]);

  const active = (arr: { status: string }[], s: string) => arr.filter((x) => x.status === s).length;
  const config = await loadDsConfig();

  console.log(`  Store: ${store.name}  |  Niche: ${store.niche}  |  Initialized: ${store.initialized ? "Yes" : "No"}`);
  console.log("");
  console.log(`  Products      : ${active(products, "active")} active / ${products.length} total`);
  console.log(`  Orders        : ${active(orders, "pending") + active(orders, "processing")} pending / ${orders.length} total`);
  console.log(`  Refunds       : ${active(refunds, "pending")} pending / ${refunds.length} total`);
  console.log(`  TikTok drafts : ${active(tiktokPosts, "draft")} drafts / ${active(tiktokPosts, "posted")} posted`);
  console.log(`  Ad Campaigns  : ${active(ads, "active")} running / ${ads.length} total`);
  console.log("");
  console.log(`  Revenue : ${formatCurrency(analytics.totalRevenue)}`);
  console.log(`  Profit  : ${formatCurrency(analytics.totalProfit)}`);
  console.log(`  Orders  : ${analytics.totalOrders} completed  (${analytics.conversionRate.toFixed(1)}% conv.)`);
  console.log("");

  // Integrations
  const ttConfigured = !!config.tiktok.accessToken;
  const payConfigured = config.payment.processor !== "manual" ||
    !!config.payment.stripeSecretKey || !!config.payment.paypalClientId;
  console.log(`  TikTok API : ${ttConfigured ? "✓ Connected" : "✗ Not configured (run setup:tiktok)"}`);
  console.log(`  Payment    : ${payConfigured ? `✓ ${config.payment.processor}` : "○ Manual (run setup:payment)"}`);
  console.log("");

  // Agents
  console.log("  Agents:");
  for (const job of AGENT_JOBS) {
    const exists = existsSync(join(JOBS_DIR, `${job.name}.md`));
    console.log(`  ${exists ? "✓" : "✗"} ${job.name}`);
  }
  console.log("");
}

async function cmdProducts(): Promise<void> {
  const products = await loadProducts();
  if (products.length === 0) {
    console.log("\n  No products yet. Run `dropshipping research` to find products.\n");
    return;
  }
  console.log(`\n  Products (${products.length} total)\n`);
  for (const p of products) {
    const margin = ((p.salePrice - p.supplierPrice) / p.salePrice * 100).toFixed(0);
    const s = p.status === "active" ? "●" : p.status === "paused" ? "○" : "◌";
    console.log(`  ${s} ${p.name.padEnd(35)} ${formatCurrency(p.salePrice).padStart(8)}  ${String(margin).padStart(3)}% margin  [${p.category}]`);
  }
  console.log("");
}

async function cmdOrders(): Promise<void> {
  const orders = await loadOrders();
  if (orders.length === 0) { console.log("\n  No orders yet.\n"); return; }
  console.log(`\n  Orders (${orders.length} total)\n`);
  for (const o of orders) {
    const date = o.createdAt.slice(0, 10);
    console.log(`  ${o.id.padEnd(14)} ${date}  ${o.productName.padEnd(30)} ${formatCurrency(o.total).padStart(8)}  [${o.status}]`);
  }
  console.log("");
}

async function cmdRefunds(args: string[]): Promise<void> {
  const sub = args[0];

  if (sub === "process") {
    const id = args[1];
    const txRef = args[2];
    if (!id || !txRef) {
      console.log("\n  Usage: dropshipping refund process <refund-id> <transaction-ref>\n");
      return;
    }
    console.log(`\n  Processing refund ${id}...`);
    const result = await processRefund(id, txRef);
    if (result.success) {
      console.log(`  ✅ Refund processed. Processor ID: ${result.processorRefundId}`);
    } else {
      console.log(`  ✗ Failed: ${result.error}`);
    }
    return;
  }

  const refunds = await loadRefunds();
  if (refunds.length === 0) { console.log("\n  No refunds yet.\n"); return; }

  const filter = sub ?? "all";
  const list = filter === "all" ? refunds : refunds.filter((r) => r.status === filter);
  const summary = await refundSummary();

  console.log(`\n  Refunds — ${summary.pending} pending (${formatCurrency(summary.totalPending)}), ${summary.processed} processed, ${summary.denied} denied\n`);
  for (const r of list) {
    const date = r.createdAt.slice(0, 10);
    console.log(`  ${r.id.padEnd(16)} ${date}  ${r.productName.padEnd(28)} ${formatCurrency(r.amount).padStart(8)}  [${r.status}]`);
    if (r.reason) console.log(`     Reason: ${r.reason}`);
  }
  console.log("");
}

async function cmdTikTok(args: string[]): Promise<void> {
  const sub = args[0] ?? "status";

  if (sub === "status") {
    const info = await getUserInfo();
    if (!info) {
      console.log("\n  TikTok not connected. Run: dropshipping setup:tiktok\n");
    } else {
      console.log(`\n  TikTok: @${info.displayName}`);
      console.log(`  Followers : ${info.followerCount.toLocaleString()}`);
      console.log(`  Following : ${info.followingCount.toLocaleString()}`);
      console.log(`  Likes     : ${info.likesCount.toLocaleString()}`);
      console.log(`  Videos    : ${info.videoCount}`);
    }
    const posts = await loadTikTokPosts();
    const drafted = posts.filter((p) => p.status === "draft").length;
    const scheduled = posts.filter((p) => p.status === "scheduled").length;
    const postedToday = posts.filter((p) => p.status === "posted" && p.postedAt?.startsWith(new Date().toISOString().slice(0, 10))).length;
    console.log(`\n  Today     : ${postedToday} posted, ${scheduled} scheduled, ${drafted} drafts`);
    console.log("");
    return;
  }

  if (sub === "post") {
    console.log("\n  Processing scheduled TikTok posts...");
    const result = await processScheduledPosts();
    console.log(`  ✅ Posted: ${result.posted}  |  Failed: ${result.failed}\n`);
    return;
  }

  if (sub === "content") {
    console.log("\n  Running TikTok content creation agent...\n");
    const prompt = await readPromptFile("TIKTOK_ORGANIC.md");
    const res = await run("dropship-tiktok-content", prompt);
    console.log(res.stdout);
    return;
  }

  if (sub === "list") {
    const posts = await loadTikTokPosts();
    if (!posts.length) { console.log("\n  No TikTok posts yet.\n"); return; }
    console.log(`\n  TikTok Posts (${posts.length} total)\n`);
    for (const p of posts.slice(-20)) {
      const date = p.createdAt.slice(0, 10);
      const time = p.scheduledFor?.slice(11, 16) ?? "--:--";
      const vid = p.videoUrl ? "🎥" : "📝";
      console.log(`  ${vid} [${p.status.padEnd(9)}] ${date} ${time}  ${p.hookText.padEnd(35)}  [${p.productName}]`);
    }
    console.log("");
    return;
  }

  console.log("\n  TikTok subcommands: status | list | content | post\n");
}

async function cmdLandingPages(args: string[]): Promise<void> {
  const productId = args[0];
  const products = await loadProducts();
  const config = await loadDsConfig();

  if (productId) {
    const product = products.find((p) => p.id === productId || productSlug(p) === productId);
    if (!product) { console.log(`\n  Product not found: ${productId}\n`); return; }
    console.log(`\n  Generating landing page for: ${product.name}...`);
    const path = await generateLandingPage(product);
    const url = `${config.landingPage.baseUrl}/products/${productSlug(product)}`;
    console.log(`  ✅ Saved to: ${path}`);
    console.log(`  URL: ${url}\n`);
    return;
  }

  const active = products.filter((p) => p.status !== "draft");
  if (!active.length) { console.log("\n  No active products to generate pages for.\n"); return; }
  console.log(`\n  Generating landing pages for ${active.length} products...`);
  const results = await generateAllLandingPages(active);
  for (const { slug, path } of results) {
    console.log(`  ✓ ${slug}  →  ${path}`);
  }
  console.log(`\n  ✅ ${results.length} pages generated in .claude/claudeclaw/dropshipping/pages/`);
  if (!config.landingPage.orderFormUrl) {
    console.log("\n  ⚠️  Set orderFormUrl in ds-config.json to link buy buttons to your checkout.");
  }
  console.log("");
}

async function cmdAnalytics(): Promise<void> {
  const analytics = await recalcAnalytics();
  const products = await loadProducts();
  console.log("\n  Analytics\n");
  console.log(`  Total Revenue : ${formatCurrency(analytics.totalRevenue)}`);
  console.log(`  Total Profit  : ${formatCurrency(analytics.totalProfit)}`);
  console.log(`  Total Orders  : ${analytics.totalOrders}`);
  console.log(`  Conv. Rate    : ${analytics.conversionRate.toFixed(1)}%`);
  if (analytics.topProducts.length) {
    console.log("\n  Top Products:");
    for (const pid of analytics.topProducts) {
      const p = products.find((x) => x.id === pid);
      if (p) console.log(`    • ${p.name}`);
    }
  }
  const days = Object.entries(analytics.dailyRevenue).sort((a, b) => a[0].localeCompare(b[0])).slice(-7);
  if (days.length) {
    console.log("\n  Last 7 Days:");
    for (const [day, rev] of days) console.log(`    ${day}  ${formatCurrency(rev)}`);
  }
  console.log("");
}

async function cmdSetupTikTok(): Promise<void> {
  console.log(`
  TikTok API Setup
  ════════════════
  1. Go to: https://developers.tiktok.com/
  2. Create an app and enable "Content Posting API"
  3. Get your Client Key, Client Secret, and OAuth access token
  4. Edit: .claude/claudeclaw/dropshipping/ds-config.json

  Set these fields under "tiktok":
    clientKey     — from TikTok Developer Portal
    clientSecret  — from TikTok Developer Portal
    accessToken   — OAuth2 user access token
    refreshToken  — OAuth2 refresh token
    openId        — your TikTok user openId

  Then run: bun run src/index.ts dropshipping tiktok status
  to verify the connection.

  Note: For organic posting, you need a TikTok Creator/Business account.
  Videos require a publicly accessible MP4 URL in tiktok-posts.json.
`);
}

async function cmdSetupPayment(): Promise<void> {
  const config = await loadDsConfig();
  console.log(`
  Payment Processor Setup
  ═══════════════════════
  Current processor: ${config.payment.processor}

  Stripe setup:
    1. Get secret key from: https://dashboard.stripe.com/apikeys
    2. Edit ds-config.json → payment.processor = "stripe"
    3. Set payment.stripeSecretKey = "sk_live_..."

  PayPal setup:
    1. Create app at: https://developer.paypal.com/
    2. Edit ds-config.json → payment.processor = "paypal"
    3. Set payment.paypalClientId and payment.paypalClientSecret
    4. Set payment.paypalSandbox = false for live payments

  Manual mode (default):
    Refunds are tracked in refunds.json but not auto-processed.
    Use: dropshipping refund process <id> <tx-ref>

  Config file: .claude/claudeclaw/dropshipping/ds-config.json
`);
}

async function cmdAgentsInstall(): Promise<void> {
  console.log("\n  Installing all 7 dropshipping agent jobs...\n");
  await installAgentJobs();
  console.log("\n  Done. Restart the daemon for changes to take effect.\n");
}

async function cmdAgentsRemove(): Promise<void> {
  console.log("\n  Removing all dropshipping agent jobs...\n");
  await removeAgentJobs();
  console.log("\n  Done.\n");
}

async function cmdResearch(): Promise<void> {
  console.log("\n  Running product research agent...\n");
  const prompt = await readPromptFile("PRODUCT_RESEARCHER.md");
  const res = await run("dropship-research", prompt);
  console.log(res.stdout);
  if (res.exitCode !== 0) console.error("  Agent exited with code:", res.exitCode);
}

async function cmdAds(): Promise<void> {
  console.log("\n  Running ad creator agent...\n");
  const prompt = await readPromptFile("AD_CREATOR.md");
  const res = await run("dropship-ads", prompt);
  console.log(res.stdout);
  if (res.exitCode !== 0) console.error("  Agent exited with code:", res.exitCode);
}

async function cmdManage(): Promise<void> {
  console.log("\n  Running store manager agent...\n");
  const prompt = await readPromptFile("STORE_MANAGER.md");
  const res = await run("dropship-manage", prompt);
  console.log(res.stdout);
  if (res.exitCode !== 0) console.error("  Agent exited with code:", res.exitCode);
}

function printHelp(): void {
  console.log(`
  ClaudeClaw Dropshipping Store — Full Automation

  Usage: bun run src/index.ts dropshipping <command>

  Setup
    init [niche] [name]      Initialize store + install all 7 agent jobs
    setup:tiktok             Show TikTok API configuration guide
    setup:payment            Show payment processor configuration guide
    agents:install           Install all agent cron jobs
    agents:remove            Remove all agent cron jobs

  Store
    status                   Full store overview
    products                 List all products
    orders                   List all orders
    analytics                Sales analytics

  TikTok (Organic)
    tiktok status            TikTok account stats + post queue
    tiktok list              List all TikTok scripts and posts
    tiktok content           Run content creation agent now
    tiktok post              Process and publish scheduled posts

  Landing Pages
    landing-pages            Generate pages for all active products
    landing-pages [id]       Generate page for one product

  Refunds
    refund list              List all refund requests
    refund pending           List pending refunds only
    refund process <id> <tx> Process a refund via payment processor

  Agents (run now)
    research                 Run product research agent
    ads                      Run ad creator agent
    manage                   Run store manager agent

  Examples:
    bun run src/index.ts dropshipping init pet-products "Paws & Claws"
    bun run src/index.ts dropshipping tiktok content
    bun run src/index.ts dropshipping landing-pages
    bun run src/index.ts dropshipping refund process REF-123 pi_abc123
`);
}

export async function dropshipping(args: string[]): Promise<void> {
  const cmd = args[0] ?? "help";
  try {
    switch (cmd) {
      case "init":           await cmdInit(args.slice(1)); break;
      case "status":         await cmdStatus(); break;
      case "products":       await cmdProducts(); break;
      case "orders":         await cmdOrders(); break;
      case "analytics":      await cmdAnalytics(); break;
      case "research":       await cmdResearch(); break;
      case "ads":            await cmdAds(); break;
      case "manage":         await cmdManage(); break;
      case "tiktok":         await cmdTikTok(args.slice(1)); break;
      case "landing-pages":  await cmdLandingPages(args.slice(1)); break;
      case "refund":         await cmdRefunds(args.slice(1)); break;
      case "setup:tiktok":   await cmdSetupTikTok(); break;
      case "setup:payment":  await cmdSetupPayment(); break;
      case "agents:install": await cmdAgentsInstall(); break;
      case "agents:remove":  await cmdAgentsRemove(); break;
      case "help":
      default:               printHelp();
    }
  } catch (err) {
    console.error("  Error:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
