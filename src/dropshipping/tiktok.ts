import { loadDsConfig, saveDsConfig } from "./dsConfig";
import { loadTikTokPosts, updateTikTokPost, type TikTokPost } from "./store";

const TIKTOK_API = "https://open.tiktokapis.com/v2";
const TOKEN_ENDPOINT = "https://open.tiktokapis.com/v2/oauth/token/";

export interface TikTokUserInfo {
  openId: string;
  unionId: string;
  displayName: string;
  avatarUrl: string;
  followerCount: number;
  followingCount: number;
  likesCount: number;
  videoCount: number;
}

export interface TikTokVideoStats {
  publishId: string;
  status: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
}

export interface PostVideoResult {
  success: boolean;
  publishId?: string;
  error?: string;
}

async function apiRequest<T>(
  method: string,
  path: string,
  body?: unknown,
  accessToken?: string
): Promise<{ data: T; error: { code: string; message: string } | null }> {
  const config = await loadDsConfig();
  const token = accessToken ?? config.tiktok.accessToken;

  const res = await fetch(`${TIKTOK_API}${path}`, {
    method,
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json; charset=UTF-8",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const json = await res.json() as { data: T; error: { code: string; message: string } };
  return { data: json.data, error: json.error?.code && json.error.code !== "ok" ? json.error : null };
}

export async function refreshAccessToken(): Promise<boolean> {
  const config = await loadDsConfig();
  if (!config.tiktok.refreshToken || !config.tiktok.clientKey || !config.tiktok.clientSecret) {
    return false;
  }

  try {
    const res = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_key: config.tiktok.clientKey,
        client_secret: config.tiktok.clientSecret,
        grant_type: "refresh_token",
        refresh_token: config.tiktok.refreshToken,
      }),
    });

    const json = await res.json() as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      error?: string;
    };

    if (json.error || !json.access_token) return false;

    const expiresAt = new Date(Date.now() + (json.expires_in ?? 86400) * 1000).toISOString();
    config.tiktok.accessToken = json.access_token;
    if (json.refresh_token) config.tiktok.refreshToken = json.refresh_token;
    config.tiktok.tokenExpiresAt = expiresAt;
    await saveDsConfig(config);
    return true;
  } catch {
    return false;
  }
}

export async function isTokenValid(): Promise<boolean> {
  const config = await loadDsConfig();
  if (!config.tiktok.accessToken) return false;
  if (!config.tiktok.tokenExpiresAt) return true;
  const expiresAt = new Date(config.tiktok.tokenExpiresAt).getTime();
  return Date.now() < expiresAt - 5 * 60 * 1000; // 5-min buffer
}

export async function ensureValidToken(): Promise<boolean> {
  if (await isTokenValid()) return true;
  return refreshAccessToken();
}

export async function getUserInfo(): Promise<TikTokUserInfo | null> {
  if (!await ensureValidToken()) return null;

  const result = await apiRequest<{
    user: {
      open_id: string;
      union_id: string;
      display_name: string;
      avatar_url: string;
      follower_count: number;
      following_count: number;
      likes_count: number;
      video_count: number;
    };
  }>("GET", "/user/info/?fields=open_id,union_id,display_name,avatar_url,follower_count,following_count,likes_count,video_count");

  if (result.error || !result.data?.user) return null;
  const u = result.data.user;
  return {
    openId: u.open_id,
    unionId: u.union_id,
    displayName: u.display_name,
    avatarUrl: u.avatar_url,
    followerCount: u.follower_count,
    followingCount: u.following_count,
    likesCount: u.likes_count,
    videoCount: u.video_count,
  };
}

/**
 * Post a video to TikTok using the Content Posting API (pull-from-URL method).
 * The videoUrl must be publicly accessible and point to a valid MP4.
 */
export async function postVideo(
  videoUrl: string,
  caption: string,
  hashtags: string[],
  options: {
    disableDuet?: boolean;
    disableStitch?: boolean;
    disableComment?: boolean;
    privacy?: "PUBLIC_TO_EVERYONE" | "MUTUAL_FOLLOW_FRIENDS" | "FOLLOWER_OF_CREATOR" | "SELF_ONLY";
  } = {}
): Promise<PostVideoResult> {
  if (!await ensureValidToken()) {
    return { success: false, error: "TikTok access token missing or expired. Run: dropshipping setup:tiktok" };
  }

  const hashtagText = hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ");
  const fullCaption = `${caption}\n\n${hashtagText}`.slice(0, 2200);

  const body = {
    post_info: {
      title: fullCaption,
      privacy_level: options.privacy ?? "PUBLIC_TO_EVERYONE",
      disable_duet: options.disableDuet ?? false,
      disable_stitch: options.disableStitch ?? false,
      disable_comment: options.disableComment ?? false,
    },
    source_info: {
      source: "PULL_FROM_URL",
      video_url: videoUrl,
    },
  };

  const result = await apiRequest<{ publish_id: string }>("POST", "/post/publish/video/init/", body);

  if (result.error) {
    return { success: false, error: `${result.error.code}: ${result.error.message}` };
  }

  return { success: true, publishId: result.data?.publish_id };
}

/** Check publish status of a posted video. */
export async function checkPublishStatus(publishId: string): Promise<{ status: string; error?: string } | null> {
  if (!await ensureValidToken()) return null;

  const result = await apiRequest<{ data: { status: string; fail_reason?: string } }>(
    "POST",
    "/post/publish/status/fetch/",
    { publish_id: publishId }
  );

  if (result.error) return null;

  const inner = (result.data as any)?.data;
  return inner ? { status: inner.status, error: inner.fail_reason } : null;
}

/** Process all scheduled TikTok posts whose scheduledFor time has passed. */
export async function processScheduledPosts(): Promise<{ posted: number; failed: number }> {
  const posts = await loadTikTokPosts();
  const now = new Date();
  let posted = 0;
  let failed = 0;

  for (const post of posts) {
    if (post.status !== "scheduled") continue;
    if (!post.videoUrl) continue;
    if (post.scheduledFor && new Date(post.scheduledFor) > now) continue;

    const result = await postVideo(post.videoUrl, post.caption, post.hashtags);
    if (result.success) {
      await updateTikTokPost(post.id, {
        status: "posted",
        publishId: result.publishId ?? null,
        postedAt: now.toISOString(),
      });
      posted++;
    } else {
      await updateTikTokPost(post.id, { status: "failed" });
      console.error(`[TikTok] Failed to post ${post.id}: ${result.error}`);
      failed++;
    }
  }

  return { posted, failed };
}
