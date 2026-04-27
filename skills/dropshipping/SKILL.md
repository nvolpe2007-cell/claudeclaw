---
name: dropshipping
description: Manage the fully-automated dropshipping store. Trigger when user asks about: dropshipping, the store, products, TikTok posts, organic marketing, landing pages, ad copy, sales, orders, refunds, analytics, revenue, profit, product research, or anything related to the e-commerce dropshipping business. Also trigger for phrases like "check sales", "how's the store", "run ads", "find products", "what sold", "how much did we make", "post to TikTok", "create landing page", "refund customer", "process refund", "show me revenue".
---

# Dropshipping Store Manager

You manage a fully-automated dropshipping store running inside ClaudeClaw. Use `$ARGUMENTS` to determine what the user needs.

## 7 Automated Agents

| Agent | Schedule | Purpose |
|-------|----------|---------|
| Product Researcher | 8 AM & 8 PM | Finds trending products with margin analysis |
| Landing Page Builder | 6 AM | Regenerates HTML pages for all products |
| TikTok Organic | 7 AM | Creates 5 TikTok video scripts per day |
| Ad Creator | 9 AM | Writes Facebook, TikTok, Google & email ads |
| Store Manager | Every hour | Reviews catalog, orders, pricing |
| Refund Manager | Every hour | Reviews and processes refund requests |
| Sales Monitor | Every 30 min | Watches revenue, alerts on spikes |

## Available Commands

```bash
# Setup
bun run src/index.ts dropshipping init [niche] [name]
bun run src/index.ts dropshipping setup:tiktok
bun run src/index.ts dropshipping setup:payment

# Store overview
bun run src/index.ts dropshipping status
bun run src/index.ts dropshipping products
bun run src/index.ts dropshipping orders
bun run src/index.ts dropshipping analytics

# TikTok (organic)
bun run src/index.ts dropshipping tiktok status
bun run src/index.ts dropshipping tiktok list
bun run src/index.ts dropshipping tiktok content  # run content agent now
bun run src/index.ts dropshipping tiktok post     # publish scheduled posts

# Landing pages
bun run src/index.ts dropshipping landing-pages
bun run src/index.ts dropshipping landing-pages [product-id]

# Refunds
bun run src/index.ts dropshipping refund list
bun run src/index.ts dropshipping refund pending
bun run src/index.ts dropshipping refund process <id> <tx-ref>

# Run agents now
bun run src/index.ts dropshipping research
bun run src/index.ts dropshipping ads
bun run src/index.ts dropshipping manage
```

## Data Files (`.claude/claudeclaw/dropshipping/`)
- `store.json` — store config
- `products.json` — product catalog
- `orders.json` — orders
- `refunds.json` — refund requests
- `ads.json` — ad campaigns
- `tiktok-posts.json` — TikTok scripts and post status
- `analytics.json` — sales metrics
- `pages/` — generated HTML landing pages
- `ds-config.json` — API credentials (TikTok, Stripe, PayPal)
- `email-drafts/` — customer service email drafts

## How to Help the User

- **"How's the store?"** → Run `status`, summarize key metrics
- **"Make TikTok content"** → Run `tiktok content`
- **"Post to TikTok"** → Run `tiktok post` (requires videoUrl in tiktok-posts.json)
- **"Build landing pages"** → Run `landing-pages`
- **"Handle refund"** → Run `refund list`, process with `refund process`
- **"Find new products"** → Run `research`
- **"Create ads"** → Run `ads`
- **"Show sales"** → Run `analytics`

## TikTok Organic Flow
1. Content agent runs at 7 AM → writes 5 video scripts to `tiktok-posts.json`
2. User records videos (using the scripts) and uploads them as MP4s
3. User sets `videoUrl` on each post in `tiktok-posts.json`
4. Changes status to `"scheduled"` with `scheduledFor` time
5. `tiktok post` command (or cron) auto-publishes at scheduled times via TikTok API

## Refund Flow
1. Customer requests refund → add to `refunds.json` with status `"pending"`
2. Refund Manager agent reviews hourly → auto-approves or flags for review
3. For auto-approved: `refund process <id> <tx-ref>` calls Stripe/PayPal API
4. Email drafts saved to `email-drafts/refund-[id].md` for sending

## First-Time Setup
1. `dropshipping init [niche] [store-name]`
2. `dropshipping setup:tiktok` — configure TikTok API
3. `dropshipping setup:payment` — configure Stripe or PayPal
4. Edit `ds-config.json` → set `landingPage.orderFormUrl` to your checkout URL
5. `start` — launch the daemon, all 7 agents start running automatically
