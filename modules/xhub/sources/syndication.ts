import type {
  XCapabilities,
  XHubSource,
  XPostData,
  XTrendData,
} from "../source";
import { XSourceUnsupportedError } from "../source";

/**
 * X content with no API key, no tier and no scopes.
 *
 * `cdn.syndication.twimg.com/tweet-result` is the endpoint that renders every
 * embedded tweet on the web. Hand it a tweet id and it answers with the text,
 * the author, the media and the public counts — the same data a reader sees on
 * the page the tweet is embedded in.
 *
 * **This is the path that makes the hub buildable today.** Search and trends
 * still need a paid tier, but search was never the interesting part: the
 * ranking, the grouping, the written story and the one-click actions are the
 * product, and they only need *content*. Content arrives here from the user —
 * a pasted link, a share, a watchlist of posts worth reading — and from their
 * own account's mentions through the OAuth source. Discovery is seeded rather
 * than crawled, and everything downstream is identical.
 *
 * Scope of use, deliberately: this hydrates posts a person has pointed us at.
 * It is not a crawler and must not become one — the endpoint exists to render
 * embeds, and using it to harvest at volume would be abusing an interface that
 * was offered in good faith. `timeline` and `search` therefore refuse rather
 * than being faked by iterating ids.
 *
 * The response shape below is written from the documented embed payload and
 * **has not been exercised against the live endpoint** — this sandbox has no
 * route to it. Every field is read defensively for that reason, and
 * `scripts/fake-syndication.ts` is what the suite actually runs against.
 */

const DEFAULT_BASE = "https://cdn.syndication.twimg.com";

/**
 * The endpoint wants a token derived from the tweet id. It is not a secret and
 * not authentication — it is a cache-busting parameter the widget computes
 * client-side, and requests without it are rejected.
 */
function tokenFor(id: string): string {
  // The widget's own derivation: (id / 1e15) * π, base-36, punctuation dropped.
  const n = Number(id) / 1e15;
  return ((n * Math.PI).toString(36).replace(/(0+|\.)/g, "") || "x").slice(0, 12);
}

type SyndicationUser = {
  screen_name?: string;
  name?: string;
  profile_image_url_https?: string;
  verified?: boolean;
  is_blue_verified?: boolean;
};

type SyndicationMedia = {
  type?: string;
  media_url_https?: string;
  url?: string;
  video_info?: { variants?: { url?: string; content_type?: string }[] };
};

type SyndicationTweet = {
  id_str?: string;
  text?: string;
  full_text?: string;
  created_at?: string;
  conversation_count?: number;
  favorite_count?: number;
  reply_count?: number;
  retweet_count?: number;
  user?: SyndicationUser;
  mediaDetails?: SyndicationMedia[];
  photos?: { url?: string }[];
  video?: { variants?: { src?: string; type?: string }[] };
  in_reply_to_status_id_str?: string;
  in_reply_to_screen_name?: string;
  parent?: SyndicationTweet;
  /** Some responses carry a slice of the reply thread. Best-effort. */
  conversation?: SyndicationTweet[];
};

function base(): string {
  // Test seam, matching every other adapter in this codebase.
  return process.env.SOCIALOS_SYNDICATION_BASE?.trim() || DEFAULT_BASE;
}

/** Tweet id out of any of the URL shapes people actually paste. */
export function tweetIdFrom(input: string): string | null {
  const trimmed = input.trim();
  if (/^\d{5,25}$/.test(trimmed)) return trimmed;
  const match = trimmed.match(
    /(?:twitter\.com|x\.com)\/[^/]+\/status(?:es)?\/(\d{5,25})/i
  );
  return match?.[1] ?? null;
}

function mediaOf(tweet: SyndicationTweet): {
  mediaType: XPostData["mediaType"];
  mediaUrls: string[];
} {
  const videos =
    tweet.video?.variants
      ?.map((v) => v.src)
      .filter((src): src is string => Boolean(src)) ?? [];
  if (videos.length > 0) return { mediaType: "video", mediaUrls: [videos[0]!] };

  const details = tweet.mediaDetails ?? [];
  const fromDetails = details
    .map((m) => m.media_url_https ?? m.url)
    .filter((url): url is string => Boolean(url));
  const photos = (tweet.photos ?? [])
    .map((p) => p.url)
    .filter((url): url is string => Boolean(url));
  const images = fromDetails.length > 0 ? fromDetails : photos;

  if (details.some((m) => m.type === "video" || m.video_info)) {
    return { mediaType: "video", mediaUrls: images };
  }
  if (images.length > 1) return { mediaType: "carousel", mediaUrls: images };
  if (images.length === 1) return { mediaType: "image", mediaUrls: images };
  return { mediaType: "text", mediaUrls: [] };
}

function toPost(tweet: SyndicationTweet): XPostData | null {
  const id = tweet.id_str;
  const handle = tweet.user?.screen_name;
  if (!id || !handle) return null;

  const { mediaType, mediaUrls } = mediaOf(tweet);

  return {
    externalId: id,
    authorHandle: `@${handle}`,
    authorName: tweet.user?.name ?? null,
    authorAvatarUrl: tweet.user?.profile_image_url_https ?? null,
    authorVerified: Boolean(tweet.user?.verified || tweet.user?.is_blue_verified),
    text: tweet.full_text ?? tweet.text ?? "",
    // The embed payload has no conversation id of its own; the root of a reply
    // chain is the parent where there is one, and the tweet itself otherwise.
    conversationId: tweet.in_reply_to_status_id_str ?? id,
    replyToId: tweet.in_reply_to_status_id_str ?? null,
    permalink: `https://x.com/${handle}/status/${id}`,
    mediaType,
    mediaUrls,
    likes: tweet.favorite_count ?? 0,
    replies: tweet.reply_count ?? tweet.conversation_count ?? 0,
    reposts: tweet.retweet_count ?? 0,
    // Not reported on this endpoint. Zero rather than a guess: the ranking
    // treats a missing view count as missing, not as no reach.
    views: 0,
    publishedAt: tweet.created_at ? new Date(tweet.created_at) : new Date(),
  };
}

export class SyndicationSource implements XHubSource {
  readonly id = "syndication";
  readonly label = "X embeds";

  supports(): XCapabilities {
    return {
      // Not "posts by a handle" — this hydrates ids a person supplied.
      timelines: false,
      // Some responses carry part of the reply thread. Declared true because
      // the module degrades to the original alone when they don't.
      conversations: true,
      search: false,
      trends: false,
    };
  }

  unavailableReason(capability: keyof XCapabilities): string | null {
    if (capability === "timelines") {
      return "Embeds resolve posts you point at, not a creator's timeline. Paste links, or connect X directly to read timelines.";
    }
    if (capability === "search") {
      return "Keyword search needs a paid X API tier. Paste links or add a watchlist instead — everything downstream works the same.";
    }
    if (capability === "trends") {
      return "X retired the free trends endpoint. Trends need a paid tier, or you can seed topics by hand.";
    }
    return null;
  }

  /**
   * Hydrate posts from ids or URLs.
   *
   * The one method that does real work here, and the entry point for every
   * paste, share and bookmark. Failures are per-id: one deleted or protected
   * tweet in a batch of twenty must not lose the other nineteen.
   */
  async hydrate(inputs: string[]): Promise<XPostData[]> {
    const ids = [...new Set(inputs.map(tweetIdFrom).filter((id): id is string => Boolean(id)))];
    const out: XPostData[] = [];

    for (const id of ids) {
      const tweet = await this.fetchTweet(id);
      if (!tweet) continue;
      const post = toPost(tweet);
      if (post) out.push(post);

      // A quoted or replied-to parent is context the story needs, and it comes
      // free in the same response rather than costing another request.
      if (tweet.parent) {
        const parent = toPost(tweet.parent);
        if (parent) out.push(parent);
      }
    }

    return out;
  }

  async conversation(conversationId: string): Promise<XPostData[]> {
    const tweet = await this.fetchTweet(conversationId);
    if (!tweet) return [];

    const replies = (tweet.conversation ?? [])
      .map(toPost)
      .filter((post): post is XPostData => post !== null);

    // Not an error when empty — the embed payload carries replies sometimes and
    // not others, and a story with an original and no replies is still a story.
    return replies;
  }

  async timeline(): Promise<XPostData[]> {
    throw new XSourceUnsupportedError(
      "timelines",
      this.unavailableReason("timelines")!
    );
  }

  async search(): Promise<XPostData[]> {
    throw new XSourceUnsupportedError("search", this.unavailableReason("search")!);
  }

  async trends(): Promise<XTrendData[]> {
    throw new XSourceUnsupportedError("trends", this.unavailableReason("trends")!);
  }

  private async fetchTweet(id: string): Promise<SyndicationTweet | null> {
    const url = new URL(`${base()}/tweet-result`);
    url.searchParams.set("id", id);
    url.searchParams.set("lang", "en");
    url.searchParams.set("token", tokenFor(id));

    try {
      const response = await fetch(url, {
        headers: { Accept: "application/json" },
        // Cached briefly: a hub that re-renders shouldn't re-fetch the same
        // embed, and these counts move slowly enough that a minute is fine.
        next: { revalidate: 60 },
      });
      // 404 is a deleted or protected tweet — a fact about that post, not a
      // failure of the batch.
      if (!response.ok) return null;
      return (await response.json()) as SyndicationTweet;
    } catch {
      return null;
    }
  }
}
