import { initConfig, loadSettings } from "../config";
import { runPipeline } from "../youtube/pipeline";
import { listVoices } from "../youtube/elevenlabs";
import { searchVideos } from "../youtube/downloader";
import { fetchAllTrends } from "../youtube/trends";
import { generateViralIdeas } from "../youtube/ideator";

function printHelp() {
  console.log(`
Usage: claudeclaw youtube <subcommand> [options]

Subcommands:
  ideas          Fetch live trends and generate viral video ideas with Claude
  run            Download a video, generate ElevenLabs voiceover, mix, and upload
  search <query> Search YouTube and list matching videos
  voices         List available ElevenLabs voices
  help           Show this help

Options for 'ideas':
  --count <n>      Number of ideas to generate (default: 3)
  --geo <code>     Country code for trends, e.g. US, GB, AU (default: US)

Options for 'run':
  --url <url>      Use a specific YouTube video URL instead of auto-search
  --query <text>   Override the search query
  --script <text>  Custom narration script (skips auto-generation)
  --title <text>   Custom title for the uploaded video
  --tags <a,b,c>   Comma-separated extra tags to add

Configuration (in .claude/claudeclaw/settings.json):
  youtubeAutomation.enabled                true to allow 'run'
  youtubeAutomation.elevenlabs.apiKey      ElevenLabs API key
  youtubeAutomation.elevenlabs.voiceId     ElevenLabs voice ID
  youtubeAutomation.pipeline.contentType   "sleep" or "gaming"
  youtubeAutomation.upload.*               YouTube OAuth2 credentials

Examples:
  claudeclaw youtube run
  claudeclaw youtube run --url https://www.youtube.com/watch?v=dQw4w9WgXcQ
  claudeclaw youtube run --query "rain forest 4k ambient" --title "Forest Rain Sleep"
  claudeclaw youtube search "gaming highlights no copyright"
  claudeclaw youtube voices
`);
}

function parseFlags(args: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (key.startsWith("--")) {
      const name = key.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        out[name] = next;
        i++;
      } else {
        out[name] = "true";
      }
    }
  }
  return out;
}

export async function youtube(args: string[]) {
  const subcommand = args[0] ?? "help";

  if (subcommand === "help" || subcommand === "--help" || subcommand === "-h") {
    printHelp();
    return;
  }

  await initConfig();
  const settings = await loadSettings();
  const config = settings.youtubeAutomation;

  if (subcommand === "voices") {
    if (!config.elevenlabs.apiKey) {
      console.error(
        "Error: ElevenLabs API key not set.\n" +
        "Add it to youtubeAutomation.elevenlabs.apiKey in .claude/claudeclaw/settings.json"
      );
      process.exit(1);
    }
    console.log("Fetching ElevenLabs voices…");
    const voices = await listVoices(config.elevenlabs.apiKey);
    console.log(`\n${voices.length} voice(s) available:`);
    for (const v of voices) {
      const isCurrent = v.voice_id === config.elevenlabs.voiceId ? " ← current" : "";
      console.log(`  ${v.voice_id}  ${v.name}${isCurrent}`);
    }
    return;
  }

  if (subcommand === "search") {
    const query = args.slice(1).join(" ");
    if (!query) {
      console.error("Usage: claudeclaw youtube search <query>");
      process.exit(1);
    }
    console.log(`Searching YouTube for: "${query}"\n`);
    const results = await searchVideos(query, 5);
    if (results.length === 0) {
      console.log("No results found.");
      return;
    }
    for (const v of results) {
      const mins = Math.floor(v.durationSeconds / 60);
      const secs = v.durationSeconds % 60;
      const dur = v.durationSeconds > 0 ? `${mins}m${secs}s` : "unknown length";
      console.log(`[${dur}] ${v.title}`);
      console.log(`        by ${v.channelTitle}`);
      console.log(`        ${v.url}\n`);
    }
    return;
  }

  if (subcommand === "ideas") {
    const flags = parseFlags(args.slice(1));
    const count = flags.count ? parseInt(flags.count, 10) : 3;
    const geo = flags.geo ?? "US";

    console.log(`\nFetching live trending topics (${geo})…`);
    const trends = await fetchAllTrends(config.upload.clientId ? config.upload.clientId : "", geo);

    const googleCount = trends.google.length;
    const youtubeCount = trends.youtube.length;
    console.log(`  Google Trends: ${googleCount} topics`);
    console.log(`  YouTube Trending: ${youtubeCount} videos`);

    if (googleCount === 0 && youtubeCount === 0) {
      console.error("Could not fetch any trends. Check your internet connection.");
      process.exit(1);
    }

    console.log(`\nAsking Claude to generate ${count} viral video idea(s)…\n`);
    const result = await generateViralIdeas(
      config.anthropicApiKey,
      trends,
      config.pipeline.contentType,
      count
    );

    console.log("─".repeat(65));
    console.log(`TRENDS USED: ${result.trendsUsed.join(" · ")}`);
    console.log("─".repeat(65));

    for (let i = 0; i < result.ideas.length; i++) {
      const idea = result.ideas[i];
      const star = i === 0 ? " ★ TOP PICK" : "";
      console.log(`\n[${i + 1}]${star}  Viral Score: ${idea.estimatedViralScore}/10`);
      console.log(`TITLE:    ${idea.title}`);
      console.log(`HOOK:     ${idea.hook}`);
      console.log(`CONCEPT:  ${idea.concept}`);
      console.log(`TRENDS:   ${(idea.trendsCombined ?? []).join(", ")}`);
      console.log(`TAGS:     ${(idea.tags ?? []).slice(0, 8).join(", ")}`);
      console.log(`\nVIDEO PROMPT:\n  ${idea.videoPrompt}`);
      console.log(`\nSCRIPT PREVIEW:\n  ${idea.narrationScript.slice(0, 200)}…`);
      console.log("─".repeat(65));
    }

    console.log(`\nTo run the top pick through the full pipeline:`);
    console.log(
      `  bun run src/index.ts youtube run --script "${result.topPick.narrationScript.slice(0, 60).replace(/"/g, "'")}…" --title "${result.topPick.title}"`
    );
    return;
  }

  if (subcommand === "run") {
    if (!config.enabled) {
      console.error(
        "YouTube automation is disabled.\n" +
        "Set youtubeAutomation.enabled = true in .claude/claudeclaw/settings.json"
      );
      process.exit(1);
    }
    if (!config.elevenlabs.apiKey) {
      console.error(
        "ElevenLabs API key not configured.\n" +
        "Set youtubeAutomation.elevenlabs.apiKey in .claude/claudeclaw/settings.json"
      );
      process.exit(1);
    }

    const flags = parseFlags(args.slice(1));
    const extraTags = flags.tags
      ? flags.tags.split(",").map((t) => t.trim()).filter(Boolean)
      : [];

    console.log(`\nYouTube automation pipeline — content type: ${config.pipeline.contentType}`);
    console.log("─".repeat(60));

    const result = await runPipeline(
      config,
      {
        videoUrl: flags.url,
        searchQuery: flags.query,
        narrationScript: flags.script,
        title: flags.title,
        extraTags,
      },
      ({ step, message }) => {
        console.log(`[${new Date().toLocaleTimeString()}] [${step.padEnd(8)}] ${message}`);
      }
    );

    console.log("─".repeat(60));

    if (!result.success) {
      console.error(`\nPipeline failed: ${result.error}`);
      process.exit(1);
    }

    console.log("\nDone!");
    if (result.url) console.log(`YouTube:    ${result.url}`);
    if (result.outputPath) console.log(`Local file: ${result.outputPath}`);
    if (result.meta) console.log(`Source:     "${result.meta.title}" by ${result.meta.channelTitle}`);
    return;
  }

  console.error(`Unknown subcommand: "${subcommand}"`);
  printHelp();
  process.exit(1);
}
