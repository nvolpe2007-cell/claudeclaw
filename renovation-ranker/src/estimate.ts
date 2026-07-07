/**
 * Pre-scan cost projection. All unit prices come from a pricing file YOU
 * fill in from the current Google Maps Platform and Claude API price pages —
 * nothing here assumes numbers, per the plan ("get exact current pricing...
 * don't assume old numbers"). The math is just itemized arithmetic.
 */
export interface Pricing {
  /** USD per call */
  geocode_per_call: number;
  sv_metadata_per_call: number;
  street_view_image_per_call: number;
  static_map_per_call: number;
  /** Typical vision request size; tune after your first real scans by
   * reading usage from the Anthropic console */
  vision_input_tokens_per_address: number;
  vision_output_tokens_per_address: number;
  /** USD per million tokens */
  claude_input_per_mtok: number;
  claude_output_per_mtok: number;
  /** e.g. 0.5 for the Batch API's 50% discount */
  batch_discount: number;
}

export interface EstimateOptions {
  addresses: number;
  streetViewImagesPerAddress: number; // default pipeline fetches 3
  useBatch: boolean;
  /** imported parcel addresses skip geocoding */
  preGeocoded: boolean;
}

export interface EstimateLine {
  label: string;
  units: number;
  unitCost: number;
  total: number;
}

export function estimateScan(p: Pricing, opts: EstimateOptions): EstimateLine[] {
  const n = opts.addresses;
  const lines: EstimateLine[] = [];
  const add = (label: string, units: number, unitCost: number) =>
    lines.push({ label, units, unitCost, total: round2(units * unitCost) });

  if (!opts.preGeocoded) add("Geocoding", n, p.geocode_per_call);
  add("Street View metadata", n, p.sv_metadata_per_call);
  add("Street View images", n * opts.streetViewImagesPerAddress, p.street_view_image_per_call);
  add("Static satellite maps", n, p.static_map_per_call);

  const discount = opts.useBatch ? p.batch_discount : 1;
  add(
    `Claude vision input${opts.useBatch ? " (batch)" : ""}`,
    n,
    (p.vision_input_tokens_per_address / 1_000_000) * p.claude_input_per_mtok * discount,
  );
  add(
    `Claude vision output${opts.useBatch ? " (batch)" : ""}`,
    n,
    (p.vision_output_tokens_per_address / 1_000_000) * p.claude_output_per_mtok * discount,
  );
  return lines;
}

export function formatEstimate(lines: EstimateLine[], addresses: number): string {
  const total = lines.reduce((s, l) => s + l.total, 0);
  const out = ["Projected scan cost (from your pricing file — verify prices are current):"];
  for (const l of lines) {
    out.push(
      `  ${l.label.padEnd(30)} ${String(l.units).padStart(7)} × $${l.unitCost.toFixed(6)} = $${l.total.toFixed(2)}`,
    );
  }
  out.push(`  ${"TOTAL".padEnd(30)} ${String(addresses).padStart(7)} addresses      $${round2(total).toFixed(2)}`);
  out.push(`  Per address: $${(total / Math.max(1, addresses)).toFixed(4)}`);
  return out.join("\n");
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
