---
name: dropshipping
description: Manage the automated dropshipping store. Trigger when user asks about: dropshipping, the store, products, ads, sales, orders, analytics, revenue, profit, product research, ad campaigns, store status, or anything related to the e-commerce dropshipping business. Also trigger for phrases like "check sales", "how's the store", "run ads", "find products", "what sold", "how much did we make", "show me revenue".
---

# Dropshipping Store Manager

You manage an automated dropshipping store running inside ClaudeClaw. Use `$ARGUMENTS` to determine what the user needs.

## Available Commands

Run these via Bash to control the store:

```bash
bun run src/index.ts dropshipping status        # store overview
bun run src/index.ts dropshipping products      # list all products
bun run src/index.ts dropshipping orders        # list all orders
bun run src/index.ts dropshipping analytics     # sales analytics
bun run src/index.ts dropshipping research      # run product research now
bun run src/index.ts dropshipping ads           # run ad creator now
bun run src/index.ts dropshipping manage        # run store manager now
```

## Data Files
All store data lives in `.claude/claudeclaw/dropshipping/`:
- `store.json` — store configuration
- `products.json` — product catalog
- `orders.json` — order history
- `ads.json` — ad campaigns
- `analytics.json` — sales metrics
- `research-YYYY-MM-DD.md` — product research reports
- `ads-YYYY-MM-DD.md` — daily ad copy
- `report-today.md` — today's store report
- `monitor-log.md` — sales monitor log

## Automated Agents (run via ClaudeClaw cron)
| Agent | Schedule | Purpose |
|-------|----------|---------|
| Product Researcher | 8 AM & 8 PM | Finds new winning products |
| Store Manager | Every hour | Reviews catalog, orders, pricing |
| Ad Creator | 9 AM daily | Writes ad copy for all platforms |
| Sales Monitor | Every 30 min | Watches revenue and alerts on spikes |

## How to Help the User

- **"How's the store?"** → Run `status` command and summarize
- **"Show me products"** → Run `products` command
- **"Find me new products"** → Run `research` command
- **"Create ads"** → Run `ads` command
- **"Show me sales"** → Run `analytics` command and explain results
- **"Add a product"** → Help user add to `products.json` with correct format
- **"Set up the store"** → Run `init` command with their chosen niche

Always give a clear, actionable summary of the data. Numbers should include currency formatting. Flag anything that needs the user's attention.

## Initializing the Store
If the store isn't set up yet, guide the user:
1. Ask for their niche (e.g., pet products, home decor, fitness)
2. Run: `bun run src/index.ts dropshipping init [niche] [store name]`
3. Start the ClaudeClaw daemon: `bun run src/index.ts start`
4. The four agents will automatically begin running on schedule
