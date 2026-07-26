// Uses Claude to synthesize trending topics into viral video concepts

import type { TrendsResult } from "./trends";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

export interface VideoIdea {
  title: string;
  hook: string;
  concept: string;
  trendsCombined: string[];
  narrationScript: string;
  videoPrompt: string;
  tags: string[];
  estimatedViralScore: number;
}

export interface IdeatorResult {
  ideas: VideoIdea[];
  topPick: VideoIdea;
  trendsUsed: string[];
}

function buildTrendsPrompt(trends: TrendsResult, contentType: "sleep" | "gaming", count: number): string {
  const googleList = trends.google
    .slice(0, 15)
    .map((t, i) => `${i + 1}. "${t.title}"${t.views ? ` (${t.views} searches)` : ""}`)
    .join("\n");

  const youtubeList = trends.youtube
    .slice(0, 15)
    .map((t, i) => `${i + 1}. "${t.title}"${t.views ? ` — ${t.views}` : ""}`)
    .join("\n");

  const typeDesc = contentType === "sleep"
    ? "relaxing sleep / ambient / meditation / lofi YouTube channel"
    : "faceless gaming highlight / commentary YouTube channel";

  return `You are a viral YouTube content strategist for a ${typeDesc}.

Here are TODAY'S top trending topics on Google:
${googleList || "(none fetched)"}

Here are TODAY'S trending YouTube videos:
${youtubeList || "(none fetched)"}

Your task: Generate ${count} viral video ideas that COMBINE multiple trending topics into one video for this channel. Each idea must:
- Weave together 2-4 trending topics in a clever, unexpected way
- Have a hook that makes someone stop scrolling in the first 3 seconds
- Fit naturally for a faceless ${contentType === "sleep" ? "sleep/ambient" : "gaming"} channel
- Be publishable TODAY while the trends are hot

For each idea, respond with a JSON array of objects with these exact keys:
- "title": catchy YouTube title (max 70 chars, include emojis)
- "hook": the opening 1-2 sentences that appear in the first 3 seconds
- "concept": 2-3 sentence explanation of how the trends are combined
- "trendsCombined": array of trend names used
- "narrationScript": full voiceover script (200-400 words), calm and relaxing tone${contentType === "sleep" ? ", designed for sleep" : ", enthusiastic but chill"}
- "videoPrompt": detailed text-to-video prompt for AI video generation (describe visuals, style, mood, lighting)
- "tags": array of 10-15 YouTube tags
- "estimatedViralScore": number 1-10 based on trend relevance and concept originality

Return ONLY the raw JSON array, no markdown, no explanation.`;
}

async function callClaude(apiKey: string, prompt: string): Promise<string> {
  const response = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    const err = await response.text().catch(() => response.statusText);
    throw new Error(`Claude API call failed (${response.status}): ${err}`);
  }

  const data = (await response.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };

  return data.content?.find((b) => b.type === "text")?.text ?? "";
}

export async function generateViralIdeas(
  anthropicApiKey: string,
  trends: TrendsResult,
  contentType: "sleep" | "gaming",
  count = 3
): Promise<IdeatorResult> {
  if (!anthropicApiKey) {
    throw new Error("Anthropic API key is not configured. Set youtubeAutomation.anthropicApiKey in settings.json");
  }

  const prompt = buildTrendsPrompt(trends, contentType, count);
  const raw = await callClaude(anthropicApiKey, prompt);

  let ideas: VideoIdea[];
  try {
    // Strip any accidental markdown fences
    const cleaned = raw.replace(/^```(?:json)?\s*/m, "").replace(/\s*```$/m, "").trim();
    ideas = JSON.parse(cleaned);
    if (!Array.isArray(ideas)) throw new Error("Response is not an array");
  } catch (e) {
    throw new Error(`Failed to parse Claude response as JSON: ${e}`);
  }

  // Sort by viral score descending
  ideas.sort((a, b) => (b.estimatedViralScore ?? 0) - (a.estimatedViralScore ?? 0));

  const trendsUsed = Array.from(
    new Set(ideas.flatMap((i) => i.trendsCombined ?? []))
  );

  return {
    ideas,
    topPick: ideas[0],
    trendsUsed,
  };
}
