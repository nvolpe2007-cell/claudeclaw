import { mkdir } from "fs/promises";
import { join } from "path";
import type { YoutubeAutomationConfig } from "../config";
import { searchVideos, downloadVideo, type VideoMeta } from "./downloader";
import { generateVoiceover } from "./elevenlabs";
import { mixVoiceover } from "./mixer";
import { uploadVideo } from "./uploader";

export interface PipelineInput {
  /** Direct YouTube URL. When omitted, the pipeline searches automatically. */
  videoUrl?: string;
  /** Search query override. */
  searchQuery?: string;
  /** Custom narration script. When omitted an auto-generated one is used. */
  narrationScript?: string;
  /** Custom title for the uploaded video. */
  title?: string;
  /** Custom description for the uploaded video. */
  description?: string;
  /** Extra tags appended to the default tag set. */
  extraTags?: string[];
}

export interface PipelineResult {
  success: boolean;
  videoId?: string;
  url?: string;
  outputPath?: string;
  meta?: VideoMeta;
  error?: string;
}

export type PipelineStep = "search" | "download" | "script" | "tts" | "mix" | "upload" | "done";

export interface PipelineProgress {
  step: PipelineStep;
  message: string;
}

type ProgressCallback = (p: PipelineProgress) => void;

function log(cb: ProgressCallback | undefined, step: PipelineStep, message: string) {
  if (cb) cb({ step, message });
  else console.log(`[youtube-pipeline] [${step}] ${message}`);
}

function buildSleepScript(meta: VideoMeta): string {
  return [
    `Welcome. Take a deep breath and let yourself unwind as you settle in with "${meta.title || "this relaxing video"}".`,
    "Allow the gentle visuals to guide you into a state of peaceful rest.",
    "There is nothing you need to do right now. Simply let go.",
    "Your body is relaxing. Your mind is growing still.",
    "Let each breath carry you deeper into calm.",
    "You are safe. You are at peace. Let sleep come naturally.",
  ].join(" ");
}

function buildGamingScript(meta: VideoMeta): string {
  const creator = meta.channelTitle || "this creator";
  return [
    `What's up everyone! Today we're watching some awesome content from ${creator}.`,
    `They've put together "${meta.title || "this gameplay"}" and it's seriously impressive.`,
    "Watch how they handle each moment with skill and precision.",
    "This is the kind of gameplay that keeps you on the edge of your seat.",
    "If you enjoy content like this, make sure to subscribe and hit that notification bell.",
    "Let's see how this one plays out!",
  ].join(" ");
}

function buildTitle(meta: VideoMeta, contentType: "sleep" | "gaming", custom?: string): string {
  if (custom) return custom;
  return contentType === "sleep"
    ? `Relaxing Sleep Video: ${meta.title} | Calm Narration`
    : `${meta.title} | Relaxing Commentary`;
}

function buildDescription(
  meta: VideoMeta,
  narration: string,
  contentType: "sleep" | "gaming",
  custom?: string
): string {
  if (custom) return custom;
  const intro =
    contentType === "sleep"
      ? "A relaxing sleep video with calm, soothing narration to help you unwind and drift off to sleep."
      : "Relaxing gaming content with a calm voiceover for easy viewing.";
  return `${intro}\n\nOriginal video: "${meta.title}" by ${meta.channelTitle}\n\n${narration.slice(0, 200)}…`;
}

export async function runPipeline(
  config: YoutubeAutomationConfig,
  input: PipelineInput,
  onProgress?: ProgressCallback
): Promise<PipelineResult> {
  const outputDir = join(process.cwd(), config.pipeline.outputDir);
  const rawDir = join(outputDir, "raw");
  const ttsDir = join(outputDir, "tts");
  const mixedDir = join(outputDir, "mixed");

  await mkdir(rawDir, { recursive: true });
  await mkdir(ttsDir, { recursive: true });
  await mkdir(mixedDir, { recursive: true });

  try {
    // Step 1 — resolve video URL
    let videoUrl = input.videoUrl;
    let meta: VideoMeta | undefined;

    if (!videoUrl) {
      const query =
        input.searchQuery ??
        (config.pipeline.contentType === "sleep"
          ? "relaxing nature ambient 4k no copyright"
          : "small gaming highlights no copyright");

      log(onProgress, "search", `Searching for: ${query}`);
      const results = await searchVideos(query, 5);

      if (results.length === 0) {
        return { success: false, error: "No videos found for the search query." };
      }

      const candidate =
        results.find(
          (v) =>
            v.durationSeconds > 0 &&
            (config.pipeline.maxDurationSeconds === 0 ||
              v.durationSeconds <= config.pipeline.maxDurationSeconds)
        ) ?? results[0];

      videoUrl = candidate.url;
      meta = candidate;
      log(onProgress, "search", `Selected: "${candidate.title}" by ${candidate.channelTitle}`);
    }

    // Step 2 — download video
    log(onProgress, "download", `Downloading: ${videoUrl}`);
    const { videoPath, meta: downloadedMeta } = await downloadVideo(videoUrl, {
      outputDir: rawDir,
      quality: config.pipeline.videoQuality,
      maxDurationSeconds: config.pipeline.maxDurationSeconds,
    });
    meta = meta ?? downloadedMeta;
    log(onProgress, "download", `Downloaded to ${videoPath}`);

    // Step 3 — narration script
    const narration =
      input.narrationScript ??
      (config.pipeline.contentType === "gaming"
        ? buildGamingScript(meta)
        : buildSleepScript(meta));
    log(onProgress, "script", `Script ready (${narration.length} characters)`);

    // Step 4 — ElevenLabs TTS
    const voiceoverPath = join(ttsDir, `${meta.id}_vo.mp3`);
    log(onProgress, "tts", `Generating ElevenLabs voiceover (voice: ${config.elevenlabs.voiceId}, model: ${config.elevenlabs.modelId})`);
    const ttsResult = await generateVoiceover(config.elevenlabs, {
      text: narration,
      outputPath: voiceoverPath,
    });
    log(onProgress, "tts", `Voiceover: ${ttsResult.durationSeconds.toFixed(1)}s`);

    // Step 5 — mix
    log(onProgress, "mix", "Mixing voiceover into video");
    const mixResult = await mixVoiceover({
      videoPath,
      voiceoverPath: ttsResult.audioPath,
      outputDir: mixedDir,
      originalAudioVolume: config.pipeline.originalAudioVolume,
      muteOriginalAudio: config.pipeline.muteOriginalAudio,
    });
    log(onProgress, "mix", `Mixed video: ${mixResult.outputPath}`);

    // Step 6 — upload (optional)
    const canUpload =
      config.upload.clientId && config.upload.clientSecret && config.upload.refreshToken;

    if (canUpload) {
      const title = buildTitle(meta, config.pipeline.contentType, input.title);
      const description = buildDescription(meta, narration, config.pipeline.contentType, input.description);
      const tags = [...config.pipeline.defaultTags, ...(input.extraTags ?? [])];

      log(onProgress, "upload", `Uploading to YouTube: "${title}"`);
      const uploadResult = await uploadVideo(config.upload, {
        videoPath: mixResult.outputPath,
        title,
        description,
        tags,
        categoryId: config.upload.categoryId,
        privacyStatus: config.upload.privacyStatus,
      });

      log(onProgress, "done", `Uploaded: ${uploadResult.url}`);
      return {
        success: true,
        videoId: uploadResult.videoId,
        url: uploadResult.url,
        outputPath: mixResult.outputPath,
        meta,
      };
    }

    log(onProgress, "done", `Pipeline complete. Mixed video: ${mixResult.outputPath}`);
    return { success: true, outputPath: mixResult.outputPath, meta };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
