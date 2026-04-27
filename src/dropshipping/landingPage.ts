import { join } from "path";
import { mkdir } from "fs/promises";
import { type Product, DATA_DIR } from "./store";
import { loadDsConfig } from "./dsConfig";

const PAGES_DIR = join(DATA_DIR, "pages");

export async function ensurePagesDir(): Promise<void> {
  await mkdir(PAGES_DIR, { recursive: true });
}

export function productSlug(product: Product): string {
  return product.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export async function generateLandingPage(product: Product): Promise<string> {
  const config = await loadDsConfig();
  await ensurePagesDir();

  const slug = productSlug(product);
  const orderUrl = config.landingPage.orderFormUrl || "#order";
  const brandColor = config.landingPage.brandColor || "#6366f1";
  const baseUrl = config.landingPage.baseUrl || "";
  const canonicalUrl = `${baseUrl}/products/${slug}`;

  const savings = product.salePrice * 0.3;
  const originalPrice = (product.salePrice + savings).toFixed(2);
  const discount = Math.round((savings / (product.salePrice + savings)) * 100);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(product.name)} – Limited Time Deal</title>
<meta name="description" content="${escapeHtml(product.description.slice(0, 160))}">
<link rel="canonical" href="${canonicalUrl}">
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --brand: ${brandColor};
    --brand-dark: color-mix(in srgb, ${brandColor} 80%, black);
    --text: #111827;
    --muted: #6b7280;
    --bg: #f9fafb;
    --white: #ffffff;
    --radius: 12px;
    --shadow: 0 4px 24px rgba(0,0,0,.10);
  }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: var(--bg); color: var(--text); line-height: 1.6; }
  a { color: var(--brand); }
  .container { max-width: 680px; margin: 0 auto; padding: 0 20px; }

  /* ─── Urgency bar ─── */
  .urgency-bar { background: var(--brand); color: #fff; text-align: center; padding: 10px 16px; font-size: 14px; font-weight: 600; letter-spacing: .3px; }
  .urgency-bar span { background: rgba(255,255,255,.25); border-radius: 4px; padding: 2px 8px; margin-left: 6px; }

  /* ─── Hero ─── */
  .hero { background: var(--white); padding: 40px 0 32px; }
  .hero img { width: 100%; max-height: 380px; object-fit: cover; border-radius: var(--radius); margin-bottom: 24px; }
  .badge { display: inline-block; background: #fef3c7; color: #92400e; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; padding: 4px 10px; border-radius: 4px; margin-bottom: 12px; }
  .hero h1 { font-size: clamp(22px, 5vw, 32px); font-weight: 800; line-height: 1.2; margin-bottom: 12px; }
  .hero .subtitle { font-size: 17px; color: var(--muted); margin-bottom: 24px; }
  .price-block { display: flex; align-items: center; gap: 12px; margin-bottom: 24px; flex-wrap: wrap; }
  .price-current { font-size: 36px; font-weight: 800; color: var(--brand); }
  .price-original { font-size: 20px; color: var(--muted); text-decoration: line-through; }
  .price-save { background: #dcfce7; color: #166534; font-size: 13px; font-weight: 700; padding: 3px 10px; border-radius: 20px; }
  .cta-primary { display: block; background: var(--brand); color: #fff; text-align: center; padding: 18px 32px; border-radius: 50px; font-size: 18px; font-weight: 700; text-decoration: none; letter-spacing: .3px; transition: transform .15s, box-shadow .15s; box-shadow: 0 4px 16px rgba(99,102,241,.35); margin-bottom: 12px; }
  .cta-primary:hover { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(99,102,241,.45); color: #fff; }
  .cta-note { text-align: center; font-size: 13px; color: var(--muted); }

  /* ─── Trust badges ─── */
  .trust { display: flex; justify-content: center; gap: 24px; flex-wrap: wrap; padding: 24px 0; border-top: 1px solid #e5e7eb; border-bottom: 1px solid #e5e7eb; margin: 24px 0; }
  .trust-item { text-align: center; font-size: 13px; color: var(--muted); }
  .trust-item .icon { font-size: 22px; display: block; margin-bottom: 4px; }

  /* ─── Benefits ─── */
  .section { padding: 40px 0; }
  .section-title { font-size: 22px; font-weight: 800; margin-bottom: 24px; text-align: center; }
  .benefits { display: grid; gap: 16px; }
  .benefit { background: var(--white); border-radius: var(--radius); padding: 20px; display: flex; gap: 16px; align-items: flex-start; box-shadow: var(--shadow); }
  .benefit .icon { font-size: 28px; flex-shrink: 0; }
  .benefit h3 { font-size: 16px; font-weight: 700; margin-bottom: 4px; }
  .benefit p { font-size: 14px; color: var(--muted); }

  /* ─── Social proof ─── */
  .social-proof { background: var(--brand); color: #fff; border-radius: var(--radius); padding: 28px; text-align: center; margin: 32px 0; }
  .social-proof .number { font-size: 48px; font-weight: 900; line-height: 1; }
  .social-proof .label { font-size: 16px; opacity: .85; margin-top: 6px; }
  .stats { display: flex; justify-content: center; gap: 32px; margin-top: 20px; flex-wrap: wrap; }
  .stat { text-align: center; }
  .stat .val { font-size: 28px; font-weight: 800; }
  .stat .lbl { font-size: 12px; opacity: .75; text-transform: uppercase; letter-spacing: .5px; }

  /* ─── Testimonials ─── */
  .testimonials { display: grid; gap: 16px; }
  .testimonial { background: var(--white); border-radius: var(--radius); padding: 20px; box-shadow: var(--shadow); }
  .stars { color: #f59e0b; font-size: 16px; margin-bottom: 8px; }
  .testimonial .quote { font-size: 15px; margin-bottom: 12px; }
  .testimonial .author { font-size: 13px; font-weight: 700; color: var(--muted); }

  /* ─── FAQ ─── */
  .faq { display: grid; gap: 12px; }
  details { background: var(--white); border-radius: var(--radius); padding: 16px 20px; box-shadow: var(--shadow); cursor: pointer; }
  summary { font-weight: 700; font-size: 15px; list-style: none; display: flex; justify-content: space-between; align-items: center; }
  summary::after { content: "+"; font-size: 20px; color: var(--brand); }
  details[open] summary::after { content: "−"; }
  details p { margin-top: 10px; font-size: 14px; color: var(--muted); }

  /* ─── Final CTA ─── */
  .final-cta { background: var(--white); border-radius: var(--radius); padding: 40px 32px; text-align: center; box-shadow: var(--shadow); margin: 32px 0 48px; }
  .final-cta h2 { font-size: 24px; font-weight: 800; margin-bottom: 8px; }
  .final-cta p { color: var(--muted); margin-bottom: 24px; }

  /* ─── Footer ─── */
  footer { background: var(--white); border-top: 1px solid #e5e7eb; padding: 24px 0; text-align: center; font-size: 13px; color: var(--muted); }
  footer a { color: var(--muted); text-decoration: none; margin: 0 8px; }
</style>
</head>
<body>

<div class="urgency-bar">
  🔥 Flash Sale – ${discount}% OFF Today Only
  <span id="countdown">Loading...</span>
</div>

<div class="hero">
  <div class="container">
    <span class="badge">Trending Now</span>
    <h1>${escapeHtml(product.name)}</h1>
    <p class="subtitle">${escapeHtml(product.description)}</p>

    <div class="price-block">
      <span class="price-current">$${product.salePrice.toFixed(2)}</span>
      <span class="price-original">$${originalPrice}</span>
      <span class="price-save">Save ${discount}%</span>
    </div>

    <a href="${escapeHtml(orderUrl)}" class="cta-primary" id="cta-top">
      🛒 Get Yours Now – $${product.salePrice.toFixed(2)}
    </a>
    <p class="cta-note">✅ Free Shipping &nbsp;|&nbsp; 30-Day Money-Back &nbsp;|&nbsp; Secure Checkout</p>
  </div>
</div>

<div class="container">

  <div class="trust">
    <div class="trust-item"><span class="icon">🚚</span>Free Shipping</div>
    <div class="trust-item"><span class="icon">🔒</span>Secure Payment</div>
    <div class="trust-item"><span class="icon">↩️</span>30-Day Returns</div>
    <div class="trust-item"><span class="icon">⭐</span>4.8/5 Rating</div>
  </div>

  <div class="section">
    <h2 class="section-title">Why Customers Love It</h2>
    <div class="benefits">
      <div class="benefit">
        <span class="icon">✨</span>
        <div>
          <h3>Premium Quality</h3>
          <p>Built to last — every detail crafted for long-term use and satisfaction.</p>
        </div>
      </div>
      <div class="benefit">
        <span class="icon">⚡</span>
        <div>
          <h3>Instant Results</h3>
          <p>See the difference the moment you use it. No waiting, no complicated setup.</p>
        </div>
      </div>
      <div class="benefit">
        <span class="icon">💯</span>
        <div>
          <h3>100% Satisfaction Guaranteed</h3>
          <p>Not happy? We'll refund every penny. Zero questions asked, zero hassle.</p>
        </div>
      </div>
    </div>
  </div>

  <div class="social-proof">
    <div class="number">12,847</div>
    <div class="label">happy customers and counting</div>
    <div class="stats">
      <div class="stat"><div class="val">4.8★</div><div class="lbl">Avg Rating</div></div>
      <div class="stat"><div class="val">97%</div><div class="lbl">Would Recommend</div></div>
      <div class="stat"><div class="val">&lt;2 days</div><div class="lbl">Avg Delivery</div></div>
    </div>
  </div>

  <div class="section">
    <h2 class="section-title">What Real Customers Say</h2>
    <div class="testimonials">
      <div class="testimonial">
        <div class="stars">★★★★★</div>
        <p class="quote">"I was skeptical at first, but this completely exceeded my expectations. Worth every penny and I've already ordered one for my sister."</p>
        <p class="author">— Sarah M., verified buyer</p>
      </div>
      <div class="testimonial">
        <div class="stars">★★★★★</div>
        <p class="quote">"Fast shipping, great quality. Exactly as described. This is my second purchase and I'll definitely be back."</p>
        <p class="author">— James R., verified buyer</p>
      </div>
      <div class="testimonial">
        <div class="stars">★★★★☆</div>
        <p class="quote">"Really solid product. My only wish is I had found it sooner. Makes such a difference in my daily routine."</p>
        <p class="author">— Priya K., verified buyer</p>
      </div>
    </div>
  </div>

  <div class="section">
    <h2 class="section-title">Frequently Asked Questions</h2>
    <div class="faq">
      <details>
        <summary>How long does shipping take?</summary>
        <p>Standard orders ship within 1–2 business days and arrive in 3–7 business days. Express options available at checkout.</p>
      </details>
      <details>
        <summary>What if I'm not satisfied?</summary>
        <p>We offer a full 30-day money-back guarantee. Contact us at support@${slug}.com and we'll process your refund within 24 hours.</p>
      </details>
      <details>
        <summary>Is my payment information secure?</summary>
        <p>Yes. We use 256-bit SSL encryption and never store card details. All payments are processed through Stripe or PayPal.</p>
      </details>
      <details>
        <summary>Do you ship internationally?</summary>
        <p>Yes! We ship to 50+ countries. International orders typically arrive within 7–14 business days.</p>
      </details>
      <details>
        <summary>How do I track my order?</summary>
        <p>You'll receive a tracking email as soon as your order ships. You can also check status at any time using your order number.</p>
      </details>
    </div>
  </div>

  <div class="final-cta">
    <h2>Ready to Try It Risk-Free?</h2>
    <p>Join over 12,000 happy customers. 30-day guarantee, free returns.</p>
    <a href="${escapeHtml(orderUrl)}" class="cta-primary">
      🛒 Order Now – Only $${product.salePrice.toFixed(2)}
    </a>
    <p class="cta-note">Free shipping · Secure checkout · 30-day money-back</p>
  </div>

</div>

<footer>
  <div class="container">
    <p>© ${new Date().getFullYear()} ${escapeHtml(product.name)} Store &nbsp;|&nbsp;
      <a href="#">Privacy</a>
      <a href="#">Terms</a>
      <a href="${escapeHtml(orderUrl)}">Contact</a>
    </p>
  </div>
</footer>

<script>
  // Countdown timer — resets daily
  function updateCountdown() {
    const now = new Date();
    const midnight = new Date(now); midnight.setHours(23, 59, 59, 999);
    const diff = midnight - now;
    const h = String(Math.floor(diff / 3600000)).padStart(2, '0');
    const m = String(Math.floor((diff % 3600000) / 60000)).padStart(2, '0');
    const s = String(Math.floor((diff % 60000) / 1000)).padStart(2, '0');
    const el = document.getElementById('countdown');
    if (el) el.textContent = h + ':' + m + ':' + s + ' left';
  }
  updateCountdown();
  setInterval(updateCountdown, 1000);
</script>

</body>
</html>`;

  const outputPath = join(PAGES_DIR, `${slug}.html`);
  await Bun.write(outputPath, html);
  return outputPath;
}

export async function generateAllLandingPages(products: Product[]): Promise<{ slug: string; path: string }[]> {
  await ensurePagesDir();
  const results: { slug: string; path: string }[] = [];
  for (const product of products.filter((p) => p.status !== "draft")) {
    const path = await generateLandingPage(product);
    results.push({ slug: productSlug(product), path });
  }
  return results;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
