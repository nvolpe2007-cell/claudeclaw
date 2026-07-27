import { mkdir } from "fs/promises";
import { join, basename, extname } from "path";

export interface MixOptions {
  videoPath: string;
  voiceoverPath: string;
  outputDir: string;
  originalAudioVolume: number;
  muteOriginalAudio: boolean;
}

export interface MixResult {
  outputPath: string;
  durationSeconds: number;
}

async function probeDuration(filePath: string): Promise<number> {
  const proc = Bun.spawn(
    ["ffprobe", "-v", "quiet", "-show_entries", "format=duration", "-of", "csv=p=0", filePath],
    { stdout: "pipe", stderr: "pipe" }
  );
  const raw = await new Response(proc.stdout).text();
  await proc.exited;
  return parseFloat(raw.trim()) || 0;
}

async function runFfmpeg(args: string[]): Promise<{ exitCode: number; stderr: string }> {
  const proc = Bun.spawn(["ffmpeg", "-y", ...args], { stdout: "pipe", stderr: "pipe" });
  const stderr = await new Response(proc.stderr).text();
  await proc.exited;
  return { exitCode: proc.exitCode ?? 1, stderr };
}

export async function mixVoiceover(options: MixOptions): Promise<MixResult> {
  await mkdir(options.outputDir, { recursive: true });

  const ext = extname(options.videoPath) || ".mp4";
  const base = basename(options.videoPath, ext);
  const outputPath = join(options.outputDir, `${base}_voiced${ext}`);

  let filterComplex: string;
  let mapArgs: string[];

  if (options.muteOriginalAudio || options.originalAudioVolume <= 0) {
    filterComplex = "[1:a]apad[aout]";
    mapArgs = ["-map", "0:v", "-map", "[aout]"];
  } else {
    const vol = Math.max(0, Math.min(1, options.originalAudioVolume));
    filterComplex = `[0:a]volume=${vol}[orig];[orig][1:a]amix=inputs=2:duration=longest[aout]`;
    mapArgs = ["-map", "0:v", "-map", "[aout]"];
  }

  const result = await runFfmpeg([
    "-i", options.videoPath,
    "-i", options.voiceoverPath,
    "-filter_complex", filterComplex,
    ...mapArgs,
    "-c:v", "copy",
    "-c:a", "aac",
    "-b:a", "192k",
    "-shortest",
    outputPath,
  ]);

  if (result.exitCode !== 0) {
    throw new Error(`ffmpeg mix failed (exit ${result.exitCode}): ${result.stderr.slice(-500)}`);
  }

  const durationSeconds = await probeDuration(outputPath);
  return { outputPath, durationSeconds };
}
