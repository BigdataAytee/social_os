/**
 * Outside signal, with no API key (X-HUB.md §1).
 *
 * The hub's first two sources were both inward-looking: posts you pasted, and
 * your own account. Neither tells you what is happening *now*, which is the
 * thing a suggestion most needs to be about.
 *
 * These do, and they are free and meant to be read:
 *
 *   - **Google News RSS.** `news.google.com/rss/search?q=…&gl=NG&ceid=NG:en`.
 *     Any query, scoped by country and language, no key. What is being written
 *     about a topic, right now, in your market.
 *   - **Any RSS or Atom feed.** Every outlet publishes one. A Nigerian brand
 *     pointing this at Punch, Vanguard and Premium Times gets its own market's
 *     news rather than a global average.
 *   - **Reddit's public JSON.** `reddit.com/r/<sub>/top.json`. Free, no key,
 *     and a genuine read on what a community is actually arguing about.
 *
 * **What this is not.** It is not X's trending topics. X has no free trends
 * endpoint, and the sites that republish them offer no API — scraping one would
 * be fragile, against their terms, and would break silently on a layout change.
 * `trends()` therefore still refuses. What you get instead is what is being
 * *written* about a topic, which is usually the thing behind a trend anyway.
 *
 * Every parser here is defensive to the point of dullness. These are third
 * party documents that change without warning, and a feed that adds a field
 * must never take the hub down.
 */

export type FeedItem = {
  /** Stable per source, so a re-pull updates rather than duplicates. */
  externalId: string;
  source: string;
  /** The outlet or subreddit, in the handle slot. */
  authorHandle: string;
  title: string;
  text: string;
  url: string | null;
  imageUrl: string | null;
  publishedAt: Date;
  /** Reddit reports score and comments; RSS reports neither. */
  score: number;
  comments: number;
};

const NEWS_BASE = "https://news.google.com/rss";
const REDDIT_BASE = "https://www.reddit.com";

function newsBase(): string {
  return process.env.SOCIALOS_NEWS_BASE?.trim() || NEWS_BASE;
}

function redditBase(): string {
  return process.env.SOCIALOS_REDDIT_BASE?.trim() || REDDIT_BASE;
}

/**
 * A stable id for a feed item.
 *
 * Feeds rarely carry one, and the link is the only thing that identifies the
 * same article across pulls. Hashed rather than used raw so a tracking-laden
 * URL and its clean twin don't become two rows.
 */
function idFor(source: string, url: string, title: string): string {
  const canonical = url.split("?")[0] || title;
  let hash = 2166136261;
  for (let i = 0; i < canonical.length; i++) {
    hash ^= canonical.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${source}_${(hash >>> 0).toString(36)}`;
}

function strip(html: string): string {
  return html
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function tag(block: string, name: string): string | null {
  const match = block.match(
    new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i")
  );
  return match ? strip(match[1] ?? "") : null;
}

/**
 * Parse RSS or Atom.
 *
 * A regex parser rather than an XML library, deliberately: this runs in a
 * serverless function, the shapes needed are four fields deep, and adding a
 * parser dependency to read `<title>` is weight for its own sake. It is not a
 * general XML parser and does not pretend to be — malformed input yields fewer
 * items, never an exception.
 */
export function parseFeed(xml: string, source: string): FeedItem[] {
  const blocks = [
    ...xml.matchAll(/<item[\s>][\s\S]*?<\/item>/gi),
    ...xml.matchAll(/<entry[\s>][\s\S]*?<\/entry>/gi),
  ].map((match) => match[0]);

  const items: FeedItem[] = [];

  for (const block of blocks) {
    const title = tag(block, "title");
    if (!title) continue;

    // Atom puts the URL in an attribute; RSS puts it in the element.
    const link =
      tag(block, "link") ??
      block.match(/<link[^>]*href="([^"]+)"/i)?.[1] ??
      null;

    const description =
      tag(block, "description") ??
      tag(block, "summary") ??
      tag(block, "content") ??
      "";

    const date =
      tag(block, "pubDate") ??
      tag(block, "published") ??
      tag(block, "updated") ??
      null;

    const image =
      block.match(/<media:thumbnail[^>]*url="([^"]+)"/i)?.[1] ??
      block.match(/<enclosure[^>]*url="([^"]+)"[^>]*type="image/i)?.[1] ??
      null;

    // Google News suffixes the outlet onto the title with a hyphen; the outlet
    // is more useful in the handle slot than repeated in every headline.
    const parts = title.split(" - ");
    const outlet = parts.length > 1 ? parts[parts.length - 1]!.trim() : source;
    const headline = parts.length > 1 ? parts.slice(0, -1).join(" - ") : title;

    const when = date ? new Date(date) : new Date();

    items.push({
      externalId: idFor(source, link ?? title, title),
      source,
      authorHandle: outlet,
      title: headline,
      text: description || headline,
      url: link,
      imageUrl: image,
      publishedAt: Number.isNaN(when.getTime()) ? new Date() : when,
      score: 0,
      comments: 0,
    });
  }

  return items;
}

type RedditListing = {
  data?: {
    children?: {
      data?: {
        id?: string;
        title?: string;
        selftext?: string;
        permalink?: string;
        url?: string;
        thumbnail?: string;
        created_utc?: number;
        score?: number;
        num_comments?: number;
        subreddit?: string;
        over_18?: boolean;
        stickied?: boolean;
      };
    }[];
  };
};

export function parseReddit(json: unknown, source: string): FeedItem[] {
  const listing = json as RedditListing;
  const children = listing?.data?.children ?? [];

  return children
    .map((child) => child.data)
    .filter((post): post is NonNullable<typeof post> => Boolean(post?.title))
    // Stickied posts are moderator furniture, not discussion, and they'd sit at
    // the top of every pull forever.
    .filter((post) => !post.stickied && !post.over_18)
    .map((post) => ({
      externalId: `${source}_${post.id ?? idFor(source, post.permalink ?? "", post.title!)}`,
      source,
      authorHandle: `r/${post.subreddit ?? "reddit"}`,
      title: post.title!,
      text: (post.selftext || post.title!).slice(0, 2000),
      url: post.permalink ? `https://reddit.com${post.permalink}` : (post.url ?? null),
      imageUrl:
        post.thumbnail && post.thumbnail.startsWith("http")
          ? post.thumbnail
          : null,
      publishedAt: post.created_utc
        ? new Date(post.created_utc * 1000)
        : new Date(),
      score: post.score ?? 0,
      comments: post.num_comments ?? 0,
    }));
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: {
        // Some feeds refuse an empty agent. Naming the app is the polite thing
        // and makes us identifiable in their logs.
        "User-Agent": "SocialOS/1.0 (+https://socialos.app)",
        Accept: "application/rss+xml, application/xml, application/json, text/xml",
      },
      next: { revalidate: 900 },
    });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    // One dead feed must never lose the others.
    return null;
  }
}

/** What is being written about a topic, right now, in one market. */
export async function newsFor(
  query: string,
  opts: { region?: string | null; language?: string | null } = {}
): Promise<FeedItem[]> {
  const region = (opts.region ?? "US").toUpperCase();
  const language = (opts.language ?? "en").split("-")[0] ?? "en";

  const url = new URL(`${newsBase()}/search`);
  url.searchParams.set("q", query);
  url.searchParams.set("hl", `${language}-${region}`);
  url.searchParams.set("gl", region);
  url.searchParams.set("ceid", `${region}:${language}`);

  const xml = await fetchText(url.toString());
  return xml ? parseFeed(xml, "news").slice(0, 12) : [];
}

/** Headlines for a market with no query — the front page. */
export async function topNews(
  opts: { region?: string | null; language?: string | null } = {}
): Promise<FeedItem[]> {
  const region = (opts.region ?? "US").toUpperCase();
  const language = (opts.language ?? "en").split("-")[0] ?? "en";

  const url = new URL(newsBase());
  url.searchParams.set("hl", `${language}-${region}`);
  url.searchParams.set("gl", region);
  url.searchParams.set("ceid", `${region}:${language}`);

  const xml = await fetchText(url.toString());
  return xml ? parseFeed(xml, "news").slice(0, 12) : [];
}

/** Any RSS or Atom URL the org configures. */
export async function feedItems(url: string): Promise<FeedItem[]> {
  const xml = await fetchText(url);
  if (!xml) return [];
  const host = (() => {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return "feed";
    }
  })();
  return parseFeed(xml, host).slice(0, 12);
}

/** What a community is actually arguing about. */
export async function redditTop(
  subreddit: string,
  window: "day" | "week" = "day"
): Promise<FeedItem[]> {
  const clean = subreddit.replace(/^\/?r\//, "").trim();
  if (!clean) return [];

  const text = await fetchText(
    `${redditBase()}/r/${encodeURIComponent(clean)}/top.json?t=${window}&limit=15`
  );
  if (!text) return [];

  try {
    return parseReddit(JSON.parse(text), "reddit").slice(0, 12);
  } catch {
    return [];
  }
}
