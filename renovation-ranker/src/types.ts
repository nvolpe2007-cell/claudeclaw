/** Shared domain types for the renovation ranker. */

export const CATEGORIES = [
  "roof",
  "windows",
  "siding_paint",
  "gutters_fascia",
  "driveway_hardscape",
  "landscaping",
] as const;
export type Category = (typeof CATEGORIES)[number];

/**
 * Sub-items the vision model must score per category. These are fixed so
 * scoring is consistent across houses — the model returns evidence-based
 * severity (0-3) per sub-item, never a vague overall score.
 */
export const SUB_ITEMS: Record<Category, readonly string[]> = {
  roof: [
    "missing_or_damaged_shingles",
    "algae_moss_streaking",
    "visible_patching",
    "sagging_ridgeline",
    "exposed_underlayment",
    "roof_section_age_mismatch",
    "chimney_or_flashing_damage",
  ],
  windows: [
    "single_pane_appearance",
    "frame_rot_or_damage",
    "fogging_seal_failure",
    "mismatched_styles",
    "boarded_or_broken_panes",
    "damaged_screens",
  ],
  siding_paint: [
    "peeling_chalking_paint",
    "cracked_stucco",
    "warped_rotting_siding",
    "water_staining",
    "faded_color",
    "visible_wood_rot_trim",
    "garage_door_damage",
  ],
  gutters_fascia: [
    "sagging_gutters",
    "rust_staining",
    "disconnected_downspouts",
    "fascia_rot",
  ],
  driveway_hardscape: ["cracking", "heaving", "oil_staining", "sun_bleaching"],
  landscaping: [
    "overgrowth",
    "dead_lawn",
    "dead_trees_shrubs_near_structure",
    "fence_disrepair",
  ],
};

export type Severity = 0 | 1 | 2 | 3;

export interface SubItemFinding {
  severity: Severity;
  /** false when the sub-item could not be assessed from the imagery */
  visible: boolean;
  /** Short evidence description; empty when nothing observed */
  evidence: string;
}

export type CategoryFindings = Record<string, SubItemFinding>;

export interface ImageQuality {
  street_view: "good" | "partial" | "obstructed" | "missing";
  satellite: "good" | "partial" | "missing";
  house_identification: "high" | "medium" | "low";
}

/** Structured output returned by the vision model. */
export interface VisionReport {
  findings: Record<Category, CategoryFindings>;
  image_quality: ImageQuality;
  overall_notes: string;
}

export const CONTRACTOR_TYPES = [
  "roofing",
  "siding",
  "windows",
  "landscaping",
  "general",
] as const;
export type ContractorType = (typeof CONTRACTOR_TYPES)[number];

export interface Scores {
  /** 0-100 per category */
  categories: Record<Category, number>;
  /** 0-100 weighted overall per contractor type */
  byContractor: Record<ContractorType, number>;
  /** 0-1; downweighted by image age/quality */
  confidence: number;
}

export interface ParcelData {
  yearBuilt?: number;
  sqft?: number;
  lastSaleYear?: number;
  /** true = owner lives at the property, false = absentee owner (rental/investment/vacation) */
  ownerOccupied?: boolean;
  /** Owner's mailing address, when known and non-owner-occupied — who to actually contact. */
  ownerMailingAddress?: string;
}

export interface AddressInfo {
  address: string;
  lat: number;
  lng: number;
  zip: string | null;
  /** From county assessor / parcel imports — fed to the vision model as
   * context (a 60-year-old never-replaced roof is a strong prior). */
  parcel?: ParcelData;
}

export interface StreetViewMeta {
  status: string;
  panoId: string | null;
  /** "YYYY-MM" capture date from the metadata endpoint, if available */
  captureDate: string | null;
  /** camera position */
  lat: number | null;
  lng: number | null;
}

export interface PropertyImage {
  kind: "street_view" | "satellite";
  mediaType: "image/jpeg" | "image/png";
  base64: string;
  /** heading used for street view images */
  heading?: number;
}

export type ScanStatus = "scored" | "no_reliable_imagery" | "error";

export interface ScanRecord {
  address: string;
  lat: number;
  lng: number;
  zip: string | null;
  scanDate: string; // ISO
  status: ScanStatus;
  panoId: string | null;
  imageryCaptureDate: string | null;
  model: string | null;
  report: VisionReport | null;
  scores: Scores | null;
  /** Carried over from AddressInfo at scan time so exports can surface it. */
  parcel?: ParcelData;
  error?: string;
}
