/**
 * Claude Vision analysis: sends all images for one address in a single call
 * with a structured prompt, and constrains the response to a fixed JSON
 * schema (output_config.format) so every house gets the same sub-item grid.
 */
import Anthropic from "@anthropic-ai/sdk";
import { CATEGORIES, SUB_ITEMS, type PropertyImage, type VisionReport } from "./types.ts";

export interface VisionClient {
  analyze(
    address: string,
    images: PropertyImage[],
    extraContext?: string,
  ): Promise<VisionReport>;
}

const subItemSchema = {
  type: "object",
  properties: {
    severity: {
      type: "integer",
      enum: [0, 1, 2, 3],
      description:
        "0 = no issue visible, 1 = minor wear, 2 = clear deterioration, 3 = severe/urgent",
    },
    visible: {
      type: "boolean",
      description: "false if this item could not be assessed from the imagery",
    },
    evidence: {
      type: "string",
      description:
        "Short, concrete visual evidence (e.g. 'dark algae streaks on north roof slope'); empty string if nothing observed",
    },
  },
  required: ["severity", "visible", "evidence"],
  additionalProperties: false,
} as const;

function buildSchema() {
  const findingsProps: Record<string, unknown> = {};
  for (const cat of CATEGORIES) {
    findingsProps[cat] = {
      type: "object",
      properties: Object.fromEntries(SUB_ITEMS[cat].map((i) => [i, subItemSchema])),
      required: [...SUB_ITEMS[cat]],
      additionalProperties: false,
    };
  }
  return {
    type: "object",
    properties: {
      findings: {
        type: "object",
        properties: findingsProps,
        required: [...CATEGORIES],
        additionalProperties: false,
      },
      image_quality: {
        type: "object",
        properties: {
          street_view: { type: "string", enum: ["good", "partial", "obstructed", "missing"] },
          satellite: { type: "string", enum: ["good", "partial", "missing"] },
          house_identification: {
            type: "string",
            enum: ["high", "medium", "low"],
            description: "Confidence that the imagery shows the target property, not a neighbor",
          },
        },
        required: ["street_view", "satellite", "house_identification"],
        additionalProperties: false,
      },
      overall_notes: {
        type: "string",
        description: "1-3 sentences: most sale-relevant observations for a contractor",
      },
    },
    required: ["findings", "image_quality", "overall_notes"],
    additionalProperties: false,
  };
}

const VISION_SCHEMA = buildSchema();

const SYSTEM_PROMPT = `You are an exterior property condition assessor generating leads for renovation contractors. You review Street View (ground-level) and satellite (roof) imagery of a single residential property and report specific, evidence-based findings.

Rules:
- Score ONLY what is visually verifiable. If a sub-item cannot be assessed from the imagery, set visible=false and severity=0. Never guess.
- Severity scale: 0 = no issue, 1 = minor wear, 2 = clear deterioration a contractor would quote, 3 = severe/urgent damage.
- Every severity >= 1 must be backed by concrete visual evidence in the evidence field (what you see and where). Shadows, reflections, and image artifacts are NOT defects — when unsure, score lower.
- Use the satellite image primarily for the roof; use street-level images for everything else.
- Multiple street-level headings are provided; identify the target house (usually centered) and ignore neighboring properties.
- These are "worth a look" leads, not certified inspections — precision matters more than recall.`;

function userContent(
  address: string,
  images: PropertyImage[],
  extraContext?: string,
): Anthropic.ContentBlockParam[] {
  const blocks: Anthropic.ContentBlockParam[] = [];
  for (const img of images) {
    const label =
      img.kind === "satellite"
        ? "Satellite / roof view:"
        : `Street View (heading ${img.heading}°):`;
    blocks.push({ type: "text", text: label });
    blocks.push({
      type: "image",
      source: { type: "base64", media_type: img.mediaType, data: img.base64 },
    });
  }
  if (extraContext) {
    blocks.push({ type: "text", text: extraContext });
  }
  blocks.push({
    type: "text",
    text: `Assess the exterior condition of the property at: ${address}. Fill in every sub-item.`,
  });
  return blocks;
}

/** Request params for one address's analysis — shared by the synchronous
 * client and the Batch API path (identical params, halved price). */
export function buildVisionParams(
  model: string,
  address: string,
  images: PropertyImage[],
  extraContext?: string,
): Anthropic.MessageCreateParamsNonStreaming {
  return {
    model,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    system: SYSTEM_PROMPT,
    output_config: { format: { type: "json_schema", schema: VISION_SCHEMA } },
    messages: [{ role: "user", content: userContent(address, images, extraContext) }],
  };
}

export function parseVisionResponse(response: Anthropic.Message): VisionReport {
  if (response.stop_reason === "refusal") {
    throw new Error("vision request was refused by safety classifiers");
  }
  const text = response.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") {
    throw new Error(`no text block in vision response (stop_reason=${response.stop_reason})`);
  }
  return JSON.parse(text.text) as VisionReport;
}

export function createVisionClient(model: string): VisionClient {
  const client = new Anthropic({ maxRetries: 4 });
  return {
    async analyze(address, images, extraContext) {
      if (images.length === 0) throw new Error("no images to analyze");
      const response = await client.messages.create(
        buildVisionParams(model, address, images, extraContext),
      );
      return parseVisionResponse(response);
    },
  };
}
