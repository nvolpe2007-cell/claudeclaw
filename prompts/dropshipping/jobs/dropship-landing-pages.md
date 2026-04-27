---
schedule: "0 6 * * *"
recurring: true
notify: false
---

# Landing Page Builder Agent

Regenerate landing pages for all active products so they're fresh before the day's TikTok posts go live.

## Steps

1. Read `.claude/claudeclaw/dropshipping/products.json`
2. For each active product, run the landing page generator:
   ```
   bun run src/index.ts dropshipping landing-pages
   ```
3. Verify the pages exist in `.claude/claudeclaw/dropshipping/pages/`
4. Log to `.claude/claudeclaw/dropshipping/report-today.md`:
   ```
   [HH:MM] Landing pages: X pages regenerated
   ```

## What Makes a Good Page
- Headline = outcome, not product name
- Price anchoring shown clearly
- Social proof number prominent
- Guarantee visible above the fold
- Single CTA, repeated twice
- Mobile-first layout

## After Generation
Check that the `orderFormUrl` in `ds-config.json` is set. If it's empty, note:
"ACTION NEEDED: Set orderFormUrl in ds-config.json to your checkout/order form URL."
