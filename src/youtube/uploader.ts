import { readFile } from "fs/promises";
import type { YoutubeUploadConfig } from "../config";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const UPLOAD_URL =
  "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status";

export interface VideoUploadOptions {
  videoPath: string;
  title: string;
  description: string;
  tags: string[];
  categoryId: string;
  privacyStatus: string;
}

export interface UploadResult {
  videoId: string;
  url: string;
}

async function getAccessToken(config: YoutubeUploadConfig): Promise<string> {
  const resp = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: config.refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!resp.ok) {
    const err = await resp.text().catch(() => resp.statusText);
    throw new Error(`Google OAuth token refresh failed (${resp.status}): ${err}`);
  }

  const data = (await resp.json()) as { access_token?: string };
  if (!data.access_token) throw new Error("No access_token in Google OAuth response");
  return data.access_token;
}

export async function uploadVideo(
  config: YoutubeUploadConfig,
  options: VideoUploadOptions
): Promise<UploadResult> {
  if (!config.clientId || !config.clientSecret || !config.refreshToken) {
    throw new Error("YouTube OAuth credentials (clientId, clientSecret, refreshToken) are not configured.");
  }

  const accessToken = await getAccessToken(config);

  const metadata = {
    snippet: {
      title: options.title.slice(0, 100),
      description: options.description.slice(0, 5000),
      tags: options.tags.slice(0, 500),
      categoryId: options.categoryId,
    },
    status: {
      privacyStatus: options.privacyStatus,
      selfDeclaredMadeForKids: false,
    },
  };

  const videoBuffer = await readFile(options.videoPath);
  const videoSize = videoBuffer.byteLength;

  // Initiate resumable upload to get the upload URI
  const initResp = await fetch(UPLOAD_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": "video/mp4",
      "X-Upload-Content-Length": String(videoSize),
    },
    body: JSON.stringify(metadata),
  });

  if (!initResp.ok) {
    const err = await initResp.text().catch(() => initResp.statusText);
    throw new Error(`YouTube upload init failed (${initResp.status}): ${err}`);
  }

  const uploadUri = initResp.headers.get("Location");
  if (!uploadUri) throw new Error("YouTube did not return a resumable upload URI");

  const uploadResp = await fetch(uploadUri, {
    method: "PUT",
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": String(videoSize),
    },
    body: videoBuffer,
  });

  if (!uploadResp.ok) {
    const err = await uploadResp.text().catch(() => uploadResp.statusText);
    throw new Error(`YouTube video upload failed (${uploadResp.status}): ${err}`);
  }

  const data = (await uploadResp.json()) as { id?: string };
  if (!data.id) throw new Error("YouTube did not return a video ID after upload");

  return { videoId: data.id, url: `https://www.youtube.com/watch?v=${data.id}` };
}
