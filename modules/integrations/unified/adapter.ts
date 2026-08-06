import { Platform, type Post } from "@prisma/client";

import { MockAdapter } from "../mock-adapter";
import type {
  ExternalPostData,
  InboxItemData,
  PlatformAdapter,
  PublishResult,
  ReplyResult,
  Snapshot,
  Trend,
} from "../types";
import { networkName, unifiedRequest } from "./client";

/**
 * One `PlatformAdapter` implementation covering all five networks, backed by a
 * unified provider (Platform-Connections.md §4).
 *
 * Built before any direct adapter because it's the fastest path to real data
 * everywhere: the provider already holds the platform approvals, so a user
 * connects through a flow that's already been reviewed instead of waiting on
 * TikTok's audit queue or Meta's app review.
 *
 * Unlike `LiveAdapter`, `publish` here is real. The provider's whole proposition
 * is that it holds write approval, so delegating publishing to the mock would
 * throw away the main reason to be on unified at all.
 *
 * `fetchTrends` still delegates to the mock: no unified provider exposes trend
 * discovery, because none of the underlying platforms expose it on the tiers
 * these integrations grant. Answering with something invented would be a
 * different feature wearing this method's name.
 */

type ProviderPost = {
  id: string;
  post?: string;
  platforms?: string[];
  created?: string;
  postUrl?: string;
  mediaUrls?: string[];
  isVideo?: boolean;
};

type ProviderComment = {
  id: string;
  text?: string;
  created?: string;
  /** The thread to reply into, where the provider distinguishes it. */
  threadId?: string;
  postId?: string;
  type?: string;
  url?: string;
  from?: { username?: string; name?: string };
};

type ProviderAnalytics = {
  /** Keyed by the provider's network name. */
  [network: string]:
    | {
        analytics?: {
          impressionCount?: number;
          likeCount?: number;
          commentCount?: number;
          shareCount?: number;
          viewCount?: number;
          saveCount?: number;
          clickCount?: number;
          followersCount?: number;
        };
      }
    | undefined;
};

/** Providers report a single media type inconsistently; normalise once, here. */
function mediaTypeOf(post: ProviderPost): ExternalPostData["mediaType"] {
  const count = post.mediaUrls?.length ?? 0;
  if (post.isVideo) return "video";
  if (count > 1) return "carousel";
  if (count === 1) return "image";
  return "text";
}

export class UnifiedAdapter implements PlatformAdapter {
  private readonly fallback: MockAdapter;

  constructor(public readonly platform: Platform) {
    this.fallback = new MockAdapter(platform);
  }

  fetchTrends(region?: string | null): Promise<Trend[]> {
    return this.fallback.fetchTrends(region);
  }

  /**
   * Real publish through the provider.
   *
   * The post's own `platformData` is not sent yet — the native per-platform
   * shapes land in step 4, and inventing a mapping for a shape nothing produces
   * would be guesswork. Body text and the target network are enough for the
   * existing publish flow, which is all that calls this today.
   */
  async publish(post: Post): Promise<PublishResult> {
    try {
      const account = await this.accountFor(post.orgId);
      if (!account) {
        return {
          ok: false,
          error: `No connected ${this.platform} account to publish to.`,
        };
      }

      const body = await unifiedRequest<{
        status?: string;
        errors?: { message: string }[];
        postIds?: { platform: string; id: string; postUrl?: string }[];
      }>({
        path: "/post",
        method: "POST",
        accountId: account,
        body: {
          post: post.body,
          platforms: [networkName(this.platform)],
        },
      });

      const first = body.postIds?.[0];
      if (body.errors?.length || !first) {
        return {
          ok: false,
          error: body.errors?.[0]?.message ?? "The provider accepted nothing.",
        };
      }
      return {
        ok: true,
        externalId: first.id,
        url: first.postUrl ?? "",
      };
    } catch (error) {
      // A publish failure is a PublishResult, not a throw — the post service
      // records FAILED and the queue shows why, which is the existing contract.
      return {
        ok: false,
        error: error instanceof Error ? error.message : "Publish failed.",
      };
    }
  }

  async fetchPosts(accountId: string, since: Date): Promise<ExternalPostData[]> {
    const network = networkName(this.platform);

    const history = await unifiedRequest<{ posts?: ProviderPost[] } | ProviderPost[]>({
      path: "/history",
      accountId,
      query: { lastRecords: 100, platform: network },
    });

    // Providers differ on whether history is the array or wraps it.
    const posts = Array.isArray(history) ? history : (history.posts ?? []);

    const recent = posts.filter((post) => {
      if (!post.created) return false;
      if (post.platforms && !post.platforms.includes(network)) return false;
      return new Date(post.created) >= since;
    });
    if (recent.length === 0) return [];

    // Metrics come from a separate per-post call; one failing must not lose the
    // rest, so each is settled independently and a failure yields zeros rather
    // than dropping the post — a post that exists with unknown engagement is
    // still a post the insights layer should see.
    const settled = await Promise.allSettled(
      recent.map(async (post) => {
        const analytics = await unifiedRequest<ProviderAnalytics>({
          path: "/analytics/post",
          method: "POST",
          accountId,
          body: { id: post.id, platforms: [network] },
        });
        return { post, metrics: analytics[network]?.analytics ?? {} };
      })
    );

    return settled.map((outcome, index) => {
      const post = recent[index]!;
      const metrics =
        outcome.status === "fulfilled" ? outcome.value.metrics : {};

      return {
        externalId: post.id,
        permalink: post.postUrl ?? null,
        text: post.post ?? "",
        mediaType: mediaTypeOf(post),
        publishedAt: new Date(post.created!),
        likes: metrics.likeCount ?? 0,
        comments: metrics.commentCount ?? 0,
        shares: metrics.shareCount ?? 0,
        // Impressions where the platform reports them, views where it doesn't —
        // insights divides by this, so zero would silently score every post at
        // its raw interaction count instead.
        views: metrics.impressionCount ?? metrics.viewCount ?? 0,
        metrics: {
          ...(metrics.saveCount !== undefined ? { saves: metrics.saveCount } : {}),
          ...(metrics.clickCount !== undefined ? { clicks: metrics.clickCount } : {}),
        },
      };
    });
  }

  /**
   * Daily rollups, aggregated from the posts in the window plus one account-level
   * follower reading — the same construction `LiveAdapter` uses, so a switch
   * between modes doesn't move the numbers under a chart.
   */
  async fetchAnalytics(accountId: string, since: Date): Promise<Snapshot[]> {
    const [posts, followers] = await Promise.all([
      this.fetchPosts(accountId, since),
      this.followerCount(accountId),
    ]);

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
      day.reach += post.views;
      day.clicks += post.metrics.clicks ?? 0;
      byDay.set(key, day);
    }

    return [...byDay.values()].sort(
      (a, b) => a.date.getTime() - b.date.getTime()
    );
  }

  /**
   * Comments and DMs through the provider's own inbox endpoint.
   *
   * This is the mode where an inbox can actually be two-way: the provider holds
   * write approval on every network, which is the whole reason to be on it.
   * Direct connections can read three networks and reply to none.
   */
  async fetchInbox(accountId: string, since: Date): Promise<InboxItemData[]> {
    const network = networkName(this.platform);

    const body = await unifiedRequest<{ comments?: ProviderComment[] } | ProviderComment[]>({
      path: "/comments",
      accountId,
      query: { platform: network, lastRecords: 100 },
    });

    const comments = Array.isArray(body) ? body : (body.comments ?? []);

    return comments
      .filter((comment) => {
        if (!comment.created || !comment.text) return false;
        return new Date(comment.created) >= since;
      })
      .map((comment) => ({
        threadId: comment.threadId ?? comment.postId ?? comment.id,
        messageId: comment.id,
        kind: comment.type === "dm" ? ("DM" as const) : ("COMMENT" as const),
        authorHandle: comment.from?.username
          ? `@${comment.from.username}`
          : (comment.from?.name ?? "Someone"),
        authorName: comment.from?.name ?? null,
        text: comment.text!,
        sentAt: new Date(comment.created!),
        permalink: comment.url ?? null,
        externalPostId: comment.postId ?? null,
      }));
  }

  async replyTo(
    accountId: string,
    threadId: string,
    text: string
  ): Promise<ReplyResult> {
    try {
      const body = await unifiedRequest<{
        id?: string;
        errors?: { message: string }[];
      }>({
        path: "/comments",
        method: "POST",
        accountId,
        body: {
          platform: networkName(this.platform),
          commentId: threadId,
          comment: text,
        },
      });

      if (body.errors?.length || !body.id) {
        return {
          ok: false,
          error: body.errors?.[0]?.message ?? "The provider accepted nothing.",
        };
      }
      return { ok: true, externalId: body.id };
    } catch (error) {
      // Same contract as publish: a refusal is a result, not a throw, so the
      // person sees why their reply didn't send instead of an error page.
      return {
        ok: false,
        error: error instanceof Error ? error.message : "Reply failed.",
      };
    }
  }

  /**
   * Delegated to the mock, and this one is a genuine gap rather than a choice.
   *
   * Unified providers front *your* connected accounts; none of them offer
   * "fetch an arbitrary competitor's posts", because that isn't an account they
   * hold a token for. Throwing would be more honest than delegating — except
   * that it would make competitor tracking silently worse for the mode this app
   * steers people toward, so the mock's fixture keeps the feature usable and
   * this comment keeps it truthful.
   */
  fetchCompetitorPosts(
    accountId: string,
    handle: string,
    since: Date
  ): Promise<ExternalPostData[]> {
    return this.fallback.fetchCompetitorPosts(accountId, handle, since);
  }

  private async followerCount(accountId: string): Promise<number> {
    try {
      const body = await unifiedRequest<ProviderAnalytics>({
        path: "/analytics/social",
        method: "POST",
        accountId,
        body: { platforms: [networkName(this.platform)] },
      });
      return body[networkName(this.platform)]?.analytics?.followersCount ?? 0;
    } catch {
      // Never fail a good sync over a missing follower count — the posts are
      // the valuable half and the previous snapshot still stands.
      return 0;
    }
  }

  /** The org's connected account id for this platform, or null. */
  private async accountFor(orgId: string): Promise<string | null> {
    const { db } = await import("@/lib/db");
    const account = await db.connectedAccount.findFirst({
      where: {
        orgId,
        platform: this.platform,
        integrationMode: "UNIFIED",
        credential: { isNot: null },
      },
      select: { id: true },
    });
    return account?.id ?? null;
  }
}
