import { join } from "path";
import { existsSync } from "fs";
import { mkdir, writeFile } from "fs/promises";
import {
  loadStore,
  saveStore,
  loadProducts,
  loadOrders,
  loadAds,
  loadAnalytics,
  recalcAnalytics,
  formatCurrency,
  type StoreConfig,
} from "../dropshipping/store";
import { run } from "../runner";

const JOBS_DIR = join(process.cwd(), ".claude", "claudeclaw", "jobs");
const PROMPTS_DIR = join(import.meta.dir, "..", "..", "prompts", "dropshipping");

// Agent job definitions: cron schedule, prompt file, description
const AGENT_JOBS: Array<{ name: string; schedule: string; promptFile: string; recurring: boolean; notify: boolean }> = [
  {
    name: "dropship-product-researcher",
    schedule: "0 8,20 * * *",
    promptFile: "PRODUCT_RESEARCHER.md",
    recurring: true,
    notify: true,
  },
  {
    name: "dropship-store-manager",
    schedule: "0 * * * *",
    promptFile: "STORE_MANAGER.md",
    recurring: true,
    notify: false,
  },
  {
    name: "dropship-ad-creator",
    schedule: "0 9 * * *",
    promptFile: "AD_CREATOR.md",
    recurring: true,
    notify: true,
  },
  {
    name: "dropship-sales-monitor",
    schedule: "*/30 * * * *",
    promptFile: "SALES_MONITOR.md",
    recurring: true,
    notify: true,
  },
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
    const frontmatter = [
      `---`,
      `schedule: "${job.schedule}"`,
      `recurring: ${job.recurring}`,
      `notify: ${job.notify}`,
      `---`,
      "",
      prompt,
    ].join("\n");

    const jobPath = join(JOBS_DIR, `${job.name}.md`);
    await writeFile(jobPath, frontmatter, "utf8");
    console.log(`  ✓ Installed job: ${job.name}`);
  }
}

async function removeAgentJobs(): Promise<void> {
  for (const job of AGENT_JOBS) {
    const jobPath = join(JOBS_DIR, `${job.name}.md`);
    if (existsSync(jobPath)) {
      await Bun.file(jobPath);
      const { unlink } = await import("fs/promises");
      await unlink(jobPath);
      console.log(`  ✓ Removed job: ${job.name}`);
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

async function cmdInit(args: string[]): Promise<void> {
  printBanner();
  const store = await loadStore();

  const niche = args[0] ?? store.niche;
  const name = args.slice(1).join(" ") || store.name;

  const updated: StoreConfig = {
    ...store,
    name: name !== "general" ? name : store.name,
    niche,
    initialized: true,
  };
  await saveStore(updated);

  console.log(`  Store: ${updated.name}`);
  console.log(`  Niche: ${updated.niche}`);
  console.log(`  Target margin: ${updated.targetMargin}%`);
  console.log("");
  console.log("  Installing automated agent jobs...");
  await installAgentJobs();
  console.log("");
  console.log("  ✅ Store initialized! Agents will run on schedule.");
  console.log("  → Product research: 8 AM & 8 PM daily");
  console.log("  → Store manager:    every hour");
  console.log("  → Ad creator:       9 AM daily");
  console.log("  → Sales monitor:    every 30 minutes");
  console.log("");
  console.log("  Run `bun run src/index.ts start` to launch the ClaudeClaw daemon.");
}

async function cmdStatus(): Promise<void> {
  printBanner();
  const [store, products, orders, ads, analytics] = await Promise.all([
    loadStore(),
    loadProducts(),
    loadOrders(),
    loadAds(),
    loadAnalytics(),
  ]);

  const activeProducts = products.filter((p) => p.status === "active");
  const pendingOrders = orders.filter((o) => o.status === "pending" || o.status === "processing");
  const activeAds = ads.filter((a) => a.status === "active");

  console.log(`  Store: ${store.name}  |  Niche: ${store.niche}`);
  console.log(`  Initialized: ${store.initialized ? "Yes" : "No"}`);
  console.log("");
  console.log(`  Products     : ${activeProducts.length} active / ${products.length} total`);
  console.log(`  Orders       : ${pendingOrders.length} pending / ${orders.length} total`);
  console.log(`  Ad Campaigns : ${activeAds.length} running / ${ads.length} total`);
  console.log("");
  console.log(`  Revenue  : ${formatCurrency(analytics.totalRevenue)}`);
  console.log(`  Profit   : ${formatCurrency(analytics.totalProfit)}`);
  console.log(`  Orders   : ${analytics.totalOrders} completed`);
  console.log(`  Conv.Rate: ${analytics.conversionRate.toFixed(1)}%`);
  console.log("");

  const jobStatuses = AGENT_JOBS.map((j) => {
    const exists = existsSync(join(JOBS_DIR, `${j.name}.md`));
    return `  ${exists ? "✓" : "✗"} ${j.name}`;
  });
  console.log("  Agents:");
  jobStatuses.forEach((s) => console.log(s));
  console.log("");
}

async function cmdProducts(): Promise<void> {
  const products = await loadProducts();
  if (products.length === 0) {
    console.log("  No products yet. Run `dropshipping research` to find products.");
    return;
  }
  console.log(`\n  Products (${products.length} total)\n`);
  for (const p of products) {
    const margin = ((p.salePrice - p.supplierPrice) / p.salePrice * 100).toFixed(0);
    const status = p.status === "active" ? "●" : p.status === "paused" ? "○" : "◌";
    console.log(`  ${status} ${p.name.padEnd(35)} ${formatCurrency(p.salePrice).padStart(8)}  ${margin}% margin  [${p.category}]`);
  }
  console.log("");
}

async function cmdOrders(): Promise<void> {
  const orders = await loadOrders();
  if (orders.length === 0) {
    console.log("  No orders yet.");
    return;
  }
  console.log(`\n  Orders (${orders.length} total)\n`);
  for (const o of orders) {
    const date = o.createdAt.slice(0, 10);
    console.log(`  ${o.id.padEnd(14)} ${date}  ${o.productName.padEnd(30)} ${formatCurrency(o.total).padStart(8)}  [${o.status}]`);
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

  if (analytics.topProducts.length > 0) {
    console.log("\n  Top Products:");
    for (const pid of analytics.topProducts) {
      const p = products.find((x) => x.id === pid);
      if (p) console.log(`    • ${p.name}`);
    }
  }

  const days = Object.entries(analytics.dailyRevenue).sort((a, b) => a[0].localeCompare(b[0])).slice(-7);
  if (days.length > 0) {
    console.log("\n  Last 7 Days Revenue:");
    for (const [day, rev] of days) {
      console.log(`    ${day}  ${formatCurrency(rev)}`);
    }
  }
  console.log("");
}

async function cmdResearch(): Promise<void> {
  console.log("\n  Running product research agent...\n");
  const prompt = await readPromptFile("PRODUCT_RESEARCHER.md");
  const result = await run("dropship-research", prompt);
  console.log(result.stdout);
  if (result.exitCode !== 0) {
    console.error("  Agent exited with code:", result.exitCode);
  }
}

async function cmdAds(): Promise<void> {
  console.log("\n  Running ad creator agent...\n");
  const prompt = await readPromptFile("AD_CREATOR.md");
  const result = await run("dropship-ads", prompt);
  console.log(result.stdout);
  if (result.exitCode !== 0) {
    console.error("  Agent exited with code:", result.exitCode);
  }
}

async function cmdManage(): Promise<void> {
  console.log("\n  Running store manager agent...\n");
  const prompt = await readPromptFile("STORE_MANAGER.md");
  const result = await run("dropship-manage", prompt);
  console.log(result.stdout);
  if (result.exitCode !== 0) {
    console.error("  Agent exited with code:", result.exitCode);
  }
}

async function cmdAgentsInstall(): Promise<void> {
  console.log("\n  Installing dropshipping agent jobs...\n");
  await installAgentJobs();
  console.log("\n  Done. Restart the daemon for changes to take effect.");
}

async function cmdAgentsRemove(): Promise<void> {
  console.log("\n  Removing dropshipping agent jobs...\n");
  await removeAgentJobs();
  console.log("\n  Done.");
}

function printHelp(): void {
  console.log(`
  ClaudeClaw Dropshipping Store

  Usage: bun run src/index.ts dropshipping <command> [options]

  Commands:
    init [niche] [store-name]  Initialize the store and install agent jobs
    status                     Show store overview and agent status
    products                   List all products
    orders                     List all orders
    analytics                  Show sales analytics
    research                   Run product research agent now
    ads                        Run ad creator agent now
    manage                     Run store manager agent now
    agents:install             Install all agent cron jobs
    agents:remove              Remove all agent cron jobs
    help                       Show this help

  Examples:
    bun run src/index.ts dropshipping init electronics "Tech Gadget Store"
    bun run src/index.ts dropshipping status
    bun run src/index.ts dropshipping research
`);
}

export async function dropshipping(args: string[]): Promise<void> {
  const cmd = args[0] ?? "help";

  try {
    switch (cmd) {
      case "init":
        await cmdInit(args.slice(1));
        break;
      case "status":
        await cmdStatus();
        break;
      case "products":
        await cmdProducts();
        break;
      case "orders":
        await cmdOrders();
        break;
      case "analytics":
        await cmdAnalytics();
        break;
      case "research":
        await cmdResearch();
        break;
      case "ads":
        await cmdAds();
        break;
      case "manage":
        await cmdManage();
        break;
      case "agents:install":
        await cmdAgentsInstall();
        break;
      case "agents:remove":
        await cmdAgentsRemove();
        break;
      case "help":
      default:
        printHelp();
    }
  } catch (err) {
    console.error("  Error:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
