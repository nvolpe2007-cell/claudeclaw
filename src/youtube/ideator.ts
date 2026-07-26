// Uses the local Claude CLI (via ClaudeClaw runner) to synthesize viral video concepts
// No separate Anthropic API key needed — piggybacks on your existing Claude session.

import type { TrendsResult } from "./trends";

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

Respond with a JSON array of objects with these exact keys:
- "title": catchy YouTube title (max 70 chars, include emojis)
- "hook": the opening 1-2 sentences spoken in the first 3 seconds
- "concept": 2-3 sentence explanation of how the trends are combined
- "trendsCombined": array of trend names used
- "narrationScript": full voiceover script (200-400 words), calm and relaxing tone${contentType === "sleep" ? ", designed to help the viewer sleep" : ", enthusiastic but chill"}
- "videoPrompt": detailed text-to-video prompt for AI video generation (describe visuals, style, mood, lighting)
- "tags": array of 10-15 YouTube tags
- "estimatedViralScore": number 1-10 based on trend relevance and concept originality

Return ONLY the raw JSON array, no markdown fences, no explanation.`;
}

async function runClaudeCli(prompt: string): Promise<string> {
  const proc = Bun.spawn(
    ["claude", "-p", prompt, "--output-format", "text", "--dangerously-skip-permissions"],
    { stdout: "pipe", stderr: "pipe" }
  );

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  await proc.exited;

  if (proc.exitCode !== 0) {
    throw new Error(`Claude CLI failed (exit ${proc.exitCode}): ${stderr.trim().slice(0, 300)}`);
  }

  return stdout.trim();
}

export async function generateViralIdeas(
  _anthropicApiKey: string,
  trends: TrendsResult,
  contentType: "sleep" | "gaming",
  count = 3
): Promise<IdeatorResult> {
  const prompt = buildTrendsPrompt(trends, contentType, count);
  const raw = await runClaudeCli(prompt);

  let ideas: VideoIdea[];
  try {
    const cleaned = raw.replace(/^```(?:json)?\s*/m, "").replace(/\s*```$/m, "").trim();
    // Find the JSON array in the response
    const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
    if (!arrayMatch) throw new Error("No JSON array found in response");
    ideas = JSON.parse(arrayMatch[0]);
    if (!Array.isArray(ideas)) throw new Error("Response is not an array");
  } catch (e) {
    throw new Error(`Failed to parse Claude response as JSON: ${e}\n\nRaw output: ${raw.slice(0, 500)}`);
  }

  ideas.sort((a, b) => (b.estimatedViralScore ?? 0) - (a.estimatedViralScore ?? 0));

  const trendsUsed = Array.from(new Set(ideas.flatMap((i) => i.trendsCombined ?? [])));

  return { ideas, topPick: ideas[0], trendsUsed };
}
