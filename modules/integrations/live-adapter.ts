import { Platform, type Post } from "@prisma/client";

import { db } from "@/lib/db";
import { MockAdapter } from "./mock-adapter";
import { withAccessToken } from "./oauth/service";
import { CompetitorUnsupportedError, InboxUnsupportedError } from "./types";
import type {
  ExternalPostData,
  InboxItemData,
  PlatformAdapter,
  PublishResult,
  ReplyResult,
  Snapshot,
  Trend,
} from "./types";

/**
 * Adapters that read from the real platform APIs.
 *
 * Two things are deliberately delegated to MockAdapter rather than implemented:
 *
 *   - `publish`. This feature requests read-only scopes, so a real publish would
 *     fail with a permissions error. Delegating keeps the existing publish flow
 *     working exactly as it does today instead of regressing a shipped feature
 *     as a side effect of connecting an account. Real publishing needs write
 *     scopes and platform review, which is its own piece of work.
 *   - `fetchTrends`. None of the five expose a trends endpoint on the tiers
 *     these scopes grant (X retired its free trends API; TikTok's is
 *     ads-account-only). Inventing one from search results would be a different
 *     product feature wearing this method's name.
 *
 * `fetchPosts` and `fetchAnalytics` are the real work.
 */

/**
 * Resolved per call, not once at import.
 *
 * A module-level constant would freeze whatever the environment looked like the
 * first time this file was loaded — which is the wrong answer in a serverless
 * runtime that may import before the environment is fully populated, and makes
 * the override untestable because the module loads before any test can set it.
 */
function apiBase(platform: Platform): string {
  switch (platform) {
    case Platform.X:
      return process.env.SOCIALOS_API_BASE_X ?? "https://api.x.com/2";
    case Platform.TIKTOK:
      return (
        process.env.SOCIALOS_API_BASE_TIKTOK ?? "https://open.tiktokapis.com/v2"
      );
    case Platform.INSTAGRAM:
    case Platform.FACEBOOK:
      return (
        process.env.SOCIALOS_API_BASE_META ?? "https://graph.facebook.com/v21.0"
      );
    case Platform.YOUTUBE:
      return (
        process.env.SOCIALOS_API_BASE_YOUTUBE ??
        "https://www.googleapis.com/youtube/v3"
      );
  }
}

async function apiGet<T>(url: string, token: string): Promise<T> {
  const response = await fetch(url, {
    headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    const body = await response.text();
    // Rate limits are the one failure worth naming — they are transient and the
    // fix is "wait", not "reconnect", and conflating the two sends people to
    // re-authorise an account that is fine.
    if (response.status === 429) {
      throw new Error(
        `${new URL(url).hostname} rate-limited this request. The next sync will pick up where this one stopped.`
      );
    }
    throw new Error(
      `${new URL(url).hostname}${new URL(url).pathname} returned ${response.status}: ${body.slice(0, 200)}`
    );
  }
  return (await response.json()) as T;
}

/** Sum daily rollups out of the per-post numbers we just pulled. */
function snapshotsFromPosts(
  posts: ExternalPostData[],
  followers: number
): Snapshot[] {
  const byDay = new Map<string, Snapshot>();

  for (const post of posts) {
    const key = post.publishedAt.toISOString().slice(0, 10);
    const day = byDay.get(key) ?? {
      date: new Date(`${key}T00:00:00.000Z`),
      followers,
      reach: 0,
      engagement: 0,
      impressions: 0,
      clicks: 0,
    };
    day.engagement += post.likes + post.comments + post.shares;
    day.impressions += post.views;
    // Reach isn't separately reported by most of these endpoints; views is the
    // closest honest stand-in, and calling it reach beats leaving it at zero
    // and having every engagement rate divide by nothing.
    day.reach += post.views;
    day.clicks += post.metrics.clicks ?? 0;
    byDay.set(key, day);
  }

  return [...byDay.values()].sort(
    (a, b) => a.date.getTime() - b.date.getTime()
  );
}

export class LiveAdapter implements PlatformAdapter {
  private readonly fallback: MockAdapter;

  constructor(public readonly platform: Platform) {
    this.fallback = new MockAdapter(platform);
  }

  publish(post: Post): Promise<PublishResult> {
    return this.fallback.publish(post);
  }

  fetchTrends(): Promise<Trend[]> {
    return this.fallback.fetchTrends();
  }

  async fetchPosts(accountId: string, since: Date): Promise<ExternalPostData[]> {
    return withAccessToken(accountId, async (token, externalId) => {
      switch (this.platform) {
        case Platform.X:
          return this.xPosts(token, externalId, since);
        case Platform.TIKTOK:
          return this.tiktokPosts(token, since);
        case Platform.YOUTUBE:
          return this.youtubePosts(token, accountId, since);
        case Platform.FACEBOOK:
          return this.facebookPosts(token, externalId, since);
        case Platform.INSTAGRAM:
          return this.instagramPosts(token, externalId, since);
      }
    });
  }

  /**
   * Follower counts come from the profile endpoint; the rest is aggregated from
   * the posts, because only YouTube and Meta expose account-level daily series
   * and doing it one way for all five keeps the numbers comparable.
   */
  async fetchAnalytics(accountId: string, since: Date): Promise<Snapshot[]> {
    const posts = await this.fetchPosts(accountId, since);
    const followers = await withAccessToken(accountId, (token, externalId) =>
      this.followerCount(token, externalId)
    );
    return snapshotsFromPosts(posts, followers);
  }

  /**
   * Three of the five, honestly.
   *
   * X mentions are covered by `tweet.read`, and Meta comments by
   * `pages_read_engagement` — scopes this app already requests and a reviewer
   * has already granted. TikTok's comment API is not in `video.list`, and
   * YouTube's `commentThreads` needs a scope the connect flow doesn't ask for.
   *
   * Those two throw rather than returning empty, and the distinction is the
   * point: an empty array would show a working, quiet inbox for an account
   * whose comments are simply not being read. The sync layer records the reason
   * against the account so the person can see it.
   */
  async fetchInbox(accountId: string, since: Date): Promise<InboxItemData[]> {
    if (this.platform === Platform.TIKTOK) {
      throw new InboxUnsupportedError(
        "TikTok's comment API isn't covered by the video.list scope this app requests."
      );
    }
    if (this.platform === Platform.YOUTUBE) {
      throw new InboxUnsupportedError(
        "Reading YouTube comments needs the youtube.force-ssl scope, which this connect flow doesn't request."
      );
    }

    return withAccessToken(accountId, async (token, externalId) => {
      switch (this.platform) {
        case Platform.X:
          return this.xMentions(token, externalId, since);
        case Platform.FACEBOOK:
        case Platform.INSTAGRAM:
          return this.metaComments(token, accountId, since);
        default:
          return [];
      }
    });
  }

  /**
   * Always refused, and refused clearly.
   *
   * Every scope in `oauth/providers.ts` is read-only. A reply attempt would come
   * back from the platform as a permissions error after the person had already
   * written and sent it; saying so before they type is the difference between a
   * limitation and a bug.
   */
  async replyTo(): Promise<ReplyResult> {
    return {
      ok: false,
      error:
        "This connection is read-only. Replying needs write scopes and platform review — switch this account to a Unified connection, or reply on the platform.",
    };
  }

  /**
   * A competitor's public posts.
   *
   * Two of the five. X allows a lookup by username followed by that user's
   * timeline on `tweet.read` + `users.read`; YouTube allows channel search and
   * public video statistics on `youtube.readonly`. Meta does not let an app read
   * an arbitrary Page it doesn't administer, and TikTok has no public-profile
   * endpoint on these scopes — both throw rather than reporting a rival who
   * apparently posts nothing.
   */
  async fetchCompetitorPosts(
    accountId: string,
    handle: string,
    since: Date
  ): Promise<ExternalPostData[]> {
    if (this.platform === Platform.FACEBOOK || this.platform === Platform.INSTAGRAM) {
      throw new CompetitorUnsupportedError(
        "Meta only exposes Pages your app administers — a competitor's Page can't be read on these scopes."
      );
    }
    if (this.platform === Platform.TIKTOK) {
      throw new CompetitorUnsupportedError(
        "TikTok has no public-profile endpoint on the scopes this app requests."
      );
    }

    const clean = handle.replace(/^@/, "").trim();
    if (!clean) return [];

    return withAccessToken(accountId, async (token) =>
      this.platform === Platform.X
        ? this.xCompetitor(token, clean, since)
        : this.youtubeCompetitor(token, clean, since)
    );
  }

  private async xCompetitor(
    token: string,
    username: string,
    since: Date
  ): Promise<ExternalPostData[]> {
    const lookup = await apiGet<{ data?: { id: string } }>(
      `${apiBase(Platform.X)}/users/by/username/${encodeURIComponent(username)}`,
      token
    );
    const userId = lookup.data?.id;
    if (!userId) return [];

    const url = new URL(`${apiBase(Platform.X)}/users/${userId}/tweets`);
    url.searchParams.set("max_results", "100");
    url.searchParams.set("start_time", since.toISOString());
    url.searchParams.set("tweet.fields", "created_at,public_metrics,text,attachments");

    const body = await apiGet<{
      data?: {
        id: string;
        text: string;
        created_at: string;
        public_metrics?: Record<string, number>;
        attachments?: { media_keys?: string[] };
      }[];
    }>(url.toString(), token);

    return (body.data ?? []).map((tweet) => {
      const metrics = tweet.public_metrics ?? {};
      const media = tweet.attachments?.media_keys?.length ?? 0;
      return {
        externalId: tweet.id,
        permalink: `https://x.com/${username}/status/${tweet.id}`,
        text: tweet.text,
        mediaType: media > 1 ? "carousel" : media === 1 ? "image" : "text",
        publishedAt: new Date(tweet.created_at),
        likes: metrics.like_count ?? 0,
        comments: metrics.reply_count ?? 0,
        shares: metrics.retweet_count ?? 0,
        views: metrics.impression_count ?? 0,
        metrics: {},
      } satisfies ExternalPostData;
    });
  }

  private async youtubeCompetitor(
    token: string,
    handle: string,
    since: Date
  ): Promise<ExternalPostData[]> {
    // A handle resolves to a channel; a channel's uploads live in a playlist
    // whose id is the channel id with the second character changed. That is
    // Google's documented convention, not a trick — but going through
    // `search.list` instead costs a hundred quota units per call against
    // `playlistItems.list`'s one.
    const channels = await apiGet<{
      items?: { id: string }[];
    }>(
      `${apiBase(Platform.YOUTUBE)}/channels?part=id&forHandle=${encodeURIComponent(
        handle.startsWith("@") ? handle : `@${handle}`
      )}`,
      token
    );
    const channelId = channels.items?.[0]?.id;
    if (!channelId) return [];

    const uploads = `UU${channelId.slice(2)}`;
    const playlist = await apiGet<{
      items?: { contentDetails?: { videoId?: string; videoPublishedAt?: string } }[];
    }>(
      `${apiBase(Platform.YOUTUBE)}/playlistItems?part=contentDetails&maxResults=50&playlistId=${uploads}`,
      token
    );

    const recent = (playlist.items ?? []).filter((item) => {
      const at = item.contentDetails?.videoPublishedAt;
      return Boolean(item.contentDetails?.videoId) && at && new Date(at) >= since;
    });
    if (recent.length === 0) return [];

    const ids = recent
      .map((item) => item.contentDetails!.videoId!)
      .join(",");
    const videos = await apiGet<{
      items?: {
        id: string;
        snippet?: { title?: string; description?: string; publishedAt?: string };
        statistics?: Record<string, string>;
      }[];
    }>(
      `${apiBase(Platform.YOUTUBE)}/videos?part=snippet,statistics&id=${ids}`,
      token
    );

    return (videos.items ?? []).map((video) => ({
      externalId: video.id,
      permalink: `https://www.youtube.com/watch?v=${video.id}`,
      text: [video.snippet?.title, video.snippet?.description]
        .filter(Boolean)
        .join("\n\n"),
      mediaType: "video" as const,
      publishedAt: new Date(video.snippet?.publishedAt ?? Date.now()),
      likes: Number(video.statistics?.likeCount ?? 0),
      comments: Number(video.statistics?.commentCount ?? 0),
      shares: 0,
      views: Number(video.statistics?.viewCount ?? 0),
      metrics: {},
    }));
  }

  private async xMentions(
    token: string,
    userId: string,
    since: Date
  ): Promise<InboxItemData[]> {
    const url = new URL(`${apiBase(Platform.X)}/users/${userId}/mentions`);
    url.searchParams.set("max_results", "100");
    url.searchParams.set("start_time", since.toISOString());
    url.searchParams.set("tweet.fields", "created_at,text,conversation_id,author_id");
    url.searchParams.set("expansions", "author_id");
    url.searchParams.set("user.fields", "username,name");

    const body = await apiGet<{
      data?: {
        id: string;
        text: string;
        created_at: string;
        conversation_id?: string;
        author_id?: string;
      }[];
      includes?: { users?: { id: string; username: string; name?: string }[] };
    }>(url.toString(), token);

    const users = new Map(
      (body.includes?.users ?? []).map((user) => [user.id, user])
    );

    return (body.data ?? []).map((tweet) => {
      const author = tweet.author_id ? users.get(tweet.author_id) : undefined;
      return {
        // conversation_id groups a reply chain; falling back to the tweet id
        // makes a standalone mention its own thread, which is what it is.
        threadId: tweet.conversation_id ?? tweet.id,
        messageId: tweet.id,
        kind: "MENTION" as const,
        authorHandle: author ? `@${author.username}` : "@unknown",
        authorName: author?.name ?? null,
        text: tweet.text,
        sentAt: new Date(tweet.created_at),
        permalink: author
          ? `https://x.com/${author.username}/status/${tweet.id}`
          : null,
        externalPostId: null,
      };
    });
  }

  /**
   * Comments on our own recent posts.
   *
   * Meta has no "all comments across the account" endpoint — comments hang off
   * media. So this walks the posts we already know about, which also bounds the
   * work: `fetchPosts` is windowed by `since`, and this inherits that window.
   */
  private async metaComments(
    token: string,
    accountId: string,
    since: Date
  ): Promise<InboxItemData[]> {
    const posts = await db.externalPost.findMany({
      where: { accountId, publishedAt: { gte: since } },
      select: { externalId: true, permalink: true },
      orderBy: { publishedAt: "desc" },
      // A page's worth. Every id here is one more API call, and a sync that
      // fans out to two hundred requests will be rate-limited into failing.
      take: 25,
    });

    const items: InboxItemData[] = [];

    for (const post of posts) {
      const url = new URL(`${apiBase(this.platform)}/${post.externalId}/comments`);
      url.searchParams.set("fields", "id,message,created_time,from{id,name,username}");
      url.searchParams.set("limit", "50");

      try {
        const body = await apiGet<{
          data?: {
            id: string;
            message?: string;
            created_time: string;
            from?: { id: string; name?: string; username?: string };
          }[];
        }>(url.toString(), token);

        for (const comment of body.data ?? []) {
          if (!comment.message) continue;
          const sentAt = new Date(comment.created_time);
          if (sentAt < since) continue;
          items.push({
            threadId: comment.id,
            messageId: comment.id,
            kind: "COMMENT",
            authorHandle: comment.from?.username
              ? `@${comment.from.username}`
              : (comment.from?.name ?? "Someone"),
            authorName: comment.from?.name ?? null,
            text: comment.message,
            sentAt,
            permalink: post.permalink,
            externalPostId: post.externalId,
          });
        }
      } catch (error) {
        // One post's comments failing must not lose the other twenty-four.
        // Meta returns 400 for media that simply can't have comments, which is
        // a fact about that post rather than a failure of the sync.
        if (error instanceof Error && error.message.includes("429")) throw error;
      }
    }

    return items;
  }

  // ------------------------------------------------------------------- X

  private async xPosts(
    token: string,
    userId: string,
    since: Date
  ): Promise<ExternalPostData[]> {
    const url = new URL(`${apiBase(Platform.X)}/users/${userId}/tweets`);
    url.searchParams.set("max_results", "100");
    url.searchParams.set("start_time", since.toISOString());
    url.searchParams.set(
      "tweet.fields",
      "created_at,public_metrics,attachments,text"
    );
    url.searchParams.set("media.fields", "type");
    url.searchParams.set("expansions", "attachments.media_keys");

    const body = await apiGet<{
      data?: {
        id: string;
        text: string;
        created_at: string;
        public_metrics?: {
          like_count: number;
          reply_count: number;
          retweet_count: number;
          impression_count: number;
          quote_count?: number;
          bookmark_count?: number;
        };
        attachments?: { media_keys?: string[] };
      }[];
      includes?: { media?: { media_key: string; type: string }[] };
    }>(url.toString(), token);

    const mediaTypes = new Map(
      (body.includes?.media ?? []).map((m) => [m.media_key, m.type])
    );

    return (body.data ?? []).map((tweet) => {
      const metrics = tweet.public_metrics;
      const keys = tweet.attachments?.media_keys ?? [];
      const types = keys.map((k) => mediaTypes.get(k));

      return {
        externalId: tweet.id,
        permalink: `https://x.com/i/status/${tweet.id}`,
        text: tweet.text,
        mediaType: types.some((t) => t === "video" || t === "animated_gif")
          ? "video"
          : keys.length > 1
            ? "carousel"
            : keys.length === 1
              ? "image"
              : "text",
        publishedAt: new Date(tweet.created_at),
        likes: metrics?.like_count ?? 0,
        comments: metrics?.reply_count ?? 0,
        shares: (metrics?.retweet_count ?? 0) + (metrics?.quote_count ?? 0),
        views: metrics?.impression_count ?? 0,
        metrics: { bookmarks: metrics?.bookmark_count ?? 0 },
      };
    });
  }

  // -------------------------------------------------------------- TikTok

  private async tiktokPosts(
    token: string,
    since: Date
  ): Promise<ExternalPostData[]> {
    const url = new URL(`${apiBase(Platform.TIKTOK)}/video/list/`);
    url.searchParams.set(
      "fields",
      "id,title,video_description,create_time,like_count,comment_count,share_count,view_count,share_url"
    );

    // TikTok's video list is a POST with a JSON body and no date filter, so the
    // window is applied client-side.
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ max_count: 20 }),
    });
    if (!response.ok) {
      throw new Error(
        `TikTok video list returned ${response.status}: ${(await response.text()).slice(0, 200)}`
      );
    }

    const body = (await response.json()) as {
      data?: {
        videos?: {
          id: string;
          title?: string;
          video_description?: string;
          create_time: number;
          like_count?: number;
          comment_count?: number;
          share_count?: number;
          view_count?: number;
          share_url?: string;
        }[];
      };
    };

    return (body.data?.videos ?? [])
      .map((video) => ({
        externalId: video.id,
        permalink: video.share_url ?? null,
        text: video.video_description ?? video.title ?? "",
        mediaType: "video" as const,
        // create_time is Unix seconds.
        publishedAt: new Date(video.create_time * 1000),
        likes: video.like_count ?? 0,
        comments: video.comment_count ?? 0,
        shares: video.share_count ?? 0,
        views: video.view_count ?? 0,
        metrics: {},
      }))
      .filter((post) => post.publishedAt >= since);
  }

  // ------------------------------------------------------------- YouTube

  private async youtubePosts(
    token: string,
    accountId: string,
    since: Date
  ): Promise<ExternalPostData[]> {
    // The uploads playlist id was captured at connect time; without it this
    // would cost an extra channels call on every sync.
    const account = await db.connectedAccount.findUnique({
      where: { id: accountId },
      select: { meta: true },
    });
    const uploads = (account?.meta as { uploadsPlaylistId?: string } | null)
      ?.uploadsPlaylistId;
    if (!uploads) return [];

    const listUrl = new URL(`${apiBase(Platform.YOUTUBE)}/playlistItems`);
    listUrl.searchParams.set("part", "contentDetails");
    listUrl.searchParams.set("playlistId", uploads);
    listUrl.searchParams.set("maxResults", "50");

    const list = await apiGet<{
      items?: { contentDetails: { videoId: string; videoPublishedAt: string } }[];
    }>(listUrl.toString(), token);

    const recent = (list.items ?? []).filter(
      (item) => new Date(item.contentDetails.videoPublishedAt) >= since
    );
    if (recent.length === 0) return [];

    const videosUrl = new URL(`${apiBase(Platform.YOUTUBE)}/videos`);
    videosUrl.searchParams.set("part", "snippet,statistics");
    videosUrl.searchParams.set(
      "id",
      recent.map((item) => item.contentDetails.videoId).join(",")
    );

    const videos = await apiGet<{
      items?: {
        id: string;
        snippet: { title: string; description: string; publishedAt: string };
        statistics?: {
          viewCount?: string;
          likeCount?: string;
          commentCount?: string;
        };
      }[];
    }>(videosUrl.toString(), token);

    return (videos.items ?? []).map((video) => ({
      externalId: video.id,
      permalink: `https://www.youtube.com/watch?v=${video.id}`,
      // Title first: it is what the format and topic analysis keys on, and a
      // full description would drown it.
      text: `${video.snippet.title}\n\n${video.snippet.description}`.trim(),
      mediaType: "video" as const,
      publishedAt: new Date(video.snippet.publishedAt),
      likes: Number(video.statistics?.likeCount ?? 0),
      comments: Number(video.statistics?.commentCount ?? 0),
      shares: 0, // YouTube stopped reporting shares on the Data API.
      views: Number(video.statistics?.viewCount ?? 0),
      metrics: {},
    }));
  }

  // ------------------------------------------------------------ Facebook

  private async facebookPosts(
    token: string,
    pageId: string,
    since: Date
  ): Promise<ExternalPostData[]> {
    const url = new URL(`${apiBase(Platform.FACEBOOK)}/${pageId}/posts`);
    url.searchParams.set(
      "fields",
      "id,message,created_time,permalink_url,attachments{media_type},shares,comments.summary(true),likes.summary(true),insights.metric(post_impressions)"
    );
    url.searchParams.set("since", String(Math.floor(since.getTime() / 1000)));
    url.searchParams.set("limit", "50");

    const body = await apiGet<{
      data?: {
        id: string;
        message?: string;
        created_time: string;
        permalink_url?: string;
        attachments?: { data?: { media_type?: string }[] };
        shares?: { count: number };
        comments?: { summary?: { total_count: number } };
        likes?: { summary?: { total_count: number } };
        insights?: { data?: { name: string; values?: { value: number }[] }[] };
      }[];
    }>(url.toString(), token);

    return (body.data ?? []).map((post) => {
      const media = post.attachments?.data?.[0]?.media_type;
      const impressions =
        post.insights?.data?.find((d) => d.name === "post_impressions")
          ?.values?.[0]?.value ?? 0;

      return {
        externalId: post.id,
        permalink: post.permalink_url ?? null,
        text: post.message ?? "",
        mediaType:
          media === "video"
            ? "video"
            : media === "album"
              ? "carousel"
              : media === "photo"
                ? "image"
                : "text",
        publishedAt: new Date(post.created_time),
        likes: post.likes?.summary?.total_count ?? 0,
        comments: post.comments?.summary?.total_count ?? 0,
        shares: post.shares?.count ?? 0,
        views: impressions,
        metrics: {},
      };
    });
  }

  // ----------------------------------------------------------- Instagram

  private async instagramPosts(
    token: string,
    igUserId: string,
    since: Date
  ): Promise<ExternalPostData[]> {
    const url = new URL(`${apiBase(Platform.INSTAGRAM)}/${igUserId}/media`);
    url.searchParams.set(
      "fields",
      "id,caption,media_type,timestamp,permalink,like_count,comments_count,insights.metric(reach,saved)"
    );
    url.searchParams.set("limit", "50");

    const body = await apiGet<{
      data?: {
        id: string;
        caption?: string;
        media_type: string;
        timestamp: string;
        permalink?: string;
        like_count?: number;
        comments_count?: number;
        insights?: { data?: { name: string; values?: { value: number }[] }[] };
      }[];
    }>(url.toString(), token);

    return (body.data ?? [])
      .map((media) => {
        const insight = (name: string) =>
          media.insights?.data?.find((d) => d.name === name)?.values?.[0]
            ?.value ?? 0;

        return {
          externalId: media.id,
          permalink: media.permalink ?? null,
          text: media.caption ?? "",
          mediaType:
            media.media_type === "VIDEO" || media.media_type === "REELS"
              ? ("video" as const)
              : media.media_type === "CAROUSEL_ALBUM"
                ? ("carousel" as const)
                : ("image" as const),
          publishedAt: new Date(media.timestamp),
          likes: media.like_count ?? 0,
          comments: media.comments_count ?? 0,
          shares: 0, // Not exposed for organic media.
          views: insight("reach"),
          metrics: { saves: insight("saved") },
        };
      })
      .filter((post) => post.publishedAt >= since);
  }

  // ------------------------------------------------------------ followers

  private async followerCount(
    token: string,
    externalId: string
  ): Promise<number> {
    try {
      switch (this.platform) {
        case Platform.X: {
          const body = await apiGet<{
            data: { public_metrics?: { followers_count: number } };
          }>(
            `${apiBase(Platform.X)}/users/${externalId}?user.fields=public_metrics`,
            token
          );
          return body.data.public_metrics?.followers_count ?? 0;
        }
        case Platform.TIKTOK: {
          const body = await apiGet<{
            data: { user: { follower_count?: number } };
          }>(
            `${apiBase(Platform.TIKTOK)}/user/info/?fields=follower_count`,
            token
          );
          return body.data.user.follower_count ?? 0;
        }
        case Platform.YOUTUBE: {
          const body = await apiGet<{
            items?: { statistics?: { subscriberCount?: string } }[];
          }>(
            `${apiBase(Platform.YOUTUBE)}/channels?part=statistics&id=${externalId}`,
            token
          );
          return Number(body.items?.[0]?.statistics?.subscriberCount ?? 0);
        }
        case Platform.FACEBOOK: {
          const body = await apiGet<{ followers_count?: number; fan_count?: number }>(
            `${apiBase(Platform.FACEBOOK)}/${externalId}?fields=followers_count,fan_count`,
            token
          );
          return body.followers_count ?? body.fan_count ?? 0;
        }
        case Platform.INSTAGRAM: {
          const body = await apiGet<{ followers_count?: number }>(
            `${apiBase(Platform.INSTAGRAM)}/${externalId}?fields=followers_count`,
            token
          );
          return body.followers_count ?? 0;
        }
      }
    } catch {
      // A missing follower count must not fail an otherwise good sync — the
      // posts are the valuable half, and the previous snapshot still stands.
      return 0;
    }
  }
}
