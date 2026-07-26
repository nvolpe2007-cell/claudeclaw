// Fetches currently trending topics from Google Trends RSS and YouTube trending videos

export interface TrendingTopic {
  title: string;
  source: "google" | "youtube";
  views?: string;
  url?: string;
}

async function fetchGoogleTrends(geo = "US"): Promise<TrendingTopic[]> {
  const url = `https://trends.google.com/trends/trendingsearches/daily/rss?geo=${geo}`;
  const response = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; bot)" },
  });

  if (!response.ok) throw new Error(`Google Trends fetch failed (${response.status})`);

  const xml = await response.text();
  const topics: TrendingTopic[] = [];

  // Parse <item> blocks from RSS
  const items = xml.match(/<item>([\s\S]*?)<\/item>/g) ?? [];
  for (const item of items.slice(0, 20)) {
    const title = item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/)?.[1]
      ?? item.match(/<title>(.*?)<\/title>/)?.[1]
      ?? "";
    const approxTraffic = item.match(/<ht:approx_traffic>(.*?)<\/ht:approx_traffic>/)?.[1] ?? "";
    const link = item.match(/<link>(.*?)<\/link>/)?.[1] ?? "";

    if (title) {
      topics.push({
        title: title.trim(),
        source: "google",
        views: approxTraffic || undefined,
        url: link || undefined,
      });
    }
  }

  return topics;
}

async function fetchYoutubeTrending(apiKey: string, regionCode = "US"): Promise<TrendingTopic[]> {
  if (!apiKey) return [];

  const url = new URL("https://www.googleapis.com/youtube/v3/videos");
  url.searchParams.set("part", "snippet,statistics");
  url.searchParams.set("chart", "mostPopular");
  url.searchParams.set("regionCode", regionCode);
  url.searchParams.set("maxResults", "20");
  url.searchParams.set("key", apiKey);

  const response = await fetch(url.toString());
  if (!response.ok) return [];

  const data = (await response.json()) as {
    items?: Array<{
      id: string;
      snippet?: { title?: string; categoryId?: string };
      statistics?: { viewCount?: string };
    }>;
  };

  return (data.items ?? []).map((item) => ({
    title: item.snippet?.title ?? "",
    source: "youtube" as const,
    views: item.statistics?.viewCount
      ? `${Math.floor(Number(item.statistics.viewCount) / 1000)}K views`
      : undefined,
    url: `https://www.youtube.com/watch?v=${item.id}`,
  })).filter((t) => t.title);
}

export interface TrendsResult {
  google: TrendingTopic[];
  youtube: TrendingTopic[];
  fetchedAt: string;
}

export async function fetchAllTrends(youtubeApiKey = "", geo = "US"): Promise<TrendsResult> {
  const [google, youtube] = await Promise.allSettled([
    fetchGoogleTrends(geo),
    fetchYoutubeTrending(youtubeApiKey, geo),
  ]);

  return {
    google: google.status === "fulfilled" ? google.value : [],
    youtube: youtube.status === "fulfilled" ? youtube.value : [],
    fetchedAt: new Date().toISOString(),
  };
}
