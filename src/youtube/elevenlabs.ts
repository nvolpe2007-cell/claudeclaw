import { mkdir } from "fs/promises";
import { join } from "path";
import type { ElevenLabsConfig } from "../config";

const API_BASE = "https://api.elevenlabs.io/v1";

export interface TTSOptions {
  text: string;
  outputPath: string;
}

export interface TTSResult {
  audioPath: string;
  durationSeconds: number;
  characterCount: number;
}

async function probeAudioDuration(filePath: string): Promise<number> {
  const proc = Bun.spawn(
    ["ffprobe", "-v", "quiet", "-show_entries", "format=duration", "-of", "csv=p=0", filePath],
    { stdout: "pipe", stderr: "pipe" }
  );
  const raw = await new Response(proc.stdout).text();
  await proc.exited;
  return parseFloat(raw.trim()) || 0;
}

export async function generateVoiceover(
  config: ElevenLabsConfig,
  options: TTSOptions
): Promise<TTSResult> {
  if (!config.apiKey) throw new Error("ElevenLabs API key is not configured.");

  await mkdir(join(options.outputPath, ".."), { recursive: true });

  const response = await fetch(`${API_BASE}/text-to-speech/${config.voiceId}`, {
    method: "POST",
    headers: {
      "xi-api-key": config.apiKey,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text: options.text,
      model_id: config.modelId,
      voice_settings: {
        stability: config.stability,
        similarity_boost: config.similarityBoost,
      },
    }),
  });

  if (!response.ok) {
    const err = await response.text().catch(() => response.statusText);
    throw new Error(`ElevenLabs TTS failed (${response.status}): ${err}`);
  }

  const buffer = await response.arrayBuffer();
  await Bun.write(options.outputPath, buffer);

  const durationSeconds = await probeAudioDuration(options.outputPath);
  return { audioPath: options.outputPath, durationSeconds, characterCount: options.text.length };
}

export async function listVoices(apiKey: string): Promise<Array<{ voice_id: string; name: string }>> {
  if (!apiKey) throw new Error("ElevenLabs API key is not configured.");

  const response = await fetch(`${API_BASE}/voices`, {
    headers: { "xi-api-key": apiKey },
  });

  if (!response.ok) throw new Error(`Failed to list ElevenLabs voices (${response.status})`);

  const data = (await response.json()) as { voices: Array<{ voice_id: string; name: string }> };
  return data.voices ?? [];
}
