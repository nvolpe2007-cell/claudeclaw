import { mkdir } from "fs/promises";
import { join } from "path";

export interface VideoMeta {
  id: string;
  title: string;
  description: string;
  durationSeconds: number;
  channelTitle: string;
  tags: string[];
  url: string;
}

export interface DownloadResult {
  videoPath: string;
  meta: VideoMeta;
}

export interface DownloadOptions {
  outputDir: string;
  quality: string;
  maxDurationSeconds: number;
}

async function runYtDlp(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["yt-dlp", ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  await proc.exited;
  return { stdout, stderr, exitCode: proc.exitCode ?? 1 };
}

export async function fetchVideoMeta(url: string): Promise<VideoMeta> {
  const result = await runYtDlp(["--dump-json", "--no-playlist", url]);
  if (result.exitCode !== 0) {
    throw new Error(`yt-dlp metadata fetch failed: ${result.stderr.trim()}`);
  }
  const json = JSON.parse(result.stdout.trim());
  return {
    id: json.id ?? "",
    title: json.title ?? "",
    description: json.description ?? "",
    durationSeconds: json.duration ?? 0,
    channelTitle: json.uploader ?? json.channel ?? "",
    tags: Array.isArray(json.tags) ? json.tags : [],
    url,
  };
}

export async function downloadVideo(url: string, options: DownloadOptions): Promise<DownloadResult> {
  await mkdir(options.outputDir, { recursive: true });

  const meta = await fetchVideoMeta(url);

  if (options.maxDurationSeconds > 0 && meta.durationSeconds > options.maxDurationSeconds) {
    throw new Error(
      `Video duration ${meta.durationSeconds}s exceeds max allowed ${options.maxDurationSeconds}s`
    );
  }

  const outputTemplate = join(options.outputDir, `${meta.id}.%(ext)s`);
  const result = await runYtDlp([
    "--format", options.quality,
    "--merge-output-format", "mp4",
    "--output", outputTemplate,
    "--no-playlist",
    "--no-warnings",
    url,
  ]);

  if (result.exitCode !== 0) {
    throw new Error(`yt-dlp download failed: ${result.stderr.trim()}`);
  }

  return { videoPath: join(options.outputDir, `${meta.id}.mp4`), meta };
}

export async function searchVideos(query: string, maxResults = 5): Promise<VideoMeta[]> {
  const result = await runYtDlp([
    "--dump-json",
    "--flat-playlist",
    "--no-warnings",
    `ytsearch${maxResults}:${query}`,
  ]);

  if (result.exitCode !== 0) {
    throw new Error(`yt-dlp search failed: ${result.stderr.trim()}`);
  }

  const videos: VideoMeta[] = [];
  for (const line of result.stdout.trim().split("\n").filter(Boolean)) {
    try {
      const json = JSON.parse(line);
      videos.push({
        id: json.id ?? "",
        title: json.title ?? "",
        description: json.description ?? "",
        durationSeconds: json.duration ?? 0,
        channelTitle: json.uploader ?? json.channel ?? "",
        tags: Array.isArray(json.tags) ? json.tags : [],
        url: json.url ?? json.webpage_url ?? `https://www.youtube.com/watch?v=${json.id}`,
      });
    } catch {
      // skip malformed entries
    }
  }
  return videos;
}
