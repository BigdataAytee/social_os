import { createServer, type Server } from "node:http";

/**
 * Stand-ins for Google News RSS and Reddit's JSON.
 *
 * Both are unreachable from this environment and both are third parties whose
 * documents change without notice, so the suite runs against these. The shapes
 * here are the awkward ones on purpose: CDATA, entities, an Atom entry with its
 * link in an attribute, a Google News title with the outlet suffixed, a
 * stickied Reddit post that must be dropped, and a feed that 500s.
 */

export type FakeFeeds = {
  url: string;
  server: Server;
  /** Every path requested, for asserting on region and query parameters. */
  requested: string[];
  close: () => Promise<void>;
};

const RSS = `<?xml version="1.0"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/">
<channel>
  <title>Top stories</title>
  <item>
    <title><![CDATA[Retention is the metric everyone gets wrong - Punch]]></title>
    <link>https://punchng.example/retention-metric?utm_source=rss</link>
    <description><![CDATA[<p>Analysts say the &amp; measure is misapplied.</p>]]></description>
    <pubDate>Wed, 06 Aug 2026 09:00:00 GMT</pubDate>
    <media:thumbnail url="https://example.test/retention.jpg"/>
  </item>
  <item>
    <title>Retention numbers climb across fintech - Vanguard</title>
    <link>https://vanguard.example/retention-fintech</link>
    <description>Quarterly filings show a shift.</description>
    <pubDate>Wed, 06 Aug 2026 07:30:00 GMT</pubDate>
  </item>
  <item>
    <title>Fintech retention gap widens - Premium Times</title>
    <link>https://premium.example/retention-gap</link>
    <description>Retention among new users lags the sector.</description>
    <pubDate>Wed, 06 Aug 2026 06:00:00 GMT</pubDate>
  </item>
  <item>
    <title>Why retention beats discounting - BusinessDay</title>
    <link>https://businessday.example/retention-discounting</link>
    <description>Operators argue retention spend compounds.</description>
    <pubDate>Wed, 06 Aug 2026 05:30:00 GMT</pubDate>
  </item>
  <item>
    <title>Retention teams are hiring - TechCabal</title>
    <link>https://techcabal.example/retention-hiring</link>
    <description>Job postings mentioning retention have doubled.</description>
    <pubDate>Wed, 06 Aug 2026 05:00:00 GMT</pubDate>
  </item>
  <item>
    <title>Something else entirely - The Cable</title>
    <link>https://cable.example/unrelated</link>
    <description>A story about roads and bridges.</description>
    <pubDate>Wed, 06 Aug 2026 04:00:00 GMT</pubDate>
  </item>
</channel>
</rss>`;

const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>An Atom feed</title>
  <entry>
    <title>Retention, revisited</title>
    <link rel="alternate" href="https://atom.example/retention-revisited"/>
    <summary>An Atom entry whose link is an attribute.</summary>
    <published>2026-08-06T05:00:00Z</published>
  </entry>
</feed>`;

const REDDIT = {
  data: {
    children: [
      {
        data: {
          id: "abc123",
          title: "Pinned: read the rules",
          selftext: "",
          permalink: "/r/nigeria/comments/abc123/pinned/",
          created_utc: 1_770_000_000,
          score: 5,
          num_comments: 0,
          subreddit: "nigeria",
          stickied: true,
        },
      },
      {
        data: {
          id: "def456",
          title: "Why retention beats acquisition for local startups",
          selftext: "A long argument about unit economics.",
          permalink: "/r/nigeria/comments/def456/retention/",
          thumbnail: "https://example.test/reddit.jpg",
          created_utc: 1_770_100_000,
          score: 1240,
          num_comments: 310,
          subreddit: "nigeria",
          stickied: false,
        },
      },
      {
        data: {
          id: "ghi789",
          title: "Retention thread, part two",
          selftext: "More of the same.",
          permalink: "/r/nigeria/comments/ghi789/retention2/",
          created_utc: 1_770_200_000,
          score: 420,
          num_comments: 88,
          subreddit: "nigeria",
          stickied: false,
        },
      },
    ],
  },
};

export async function startFakeFeeds(): Promise<FakeFeeds> {
  const requested: string[] = [];

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    requested.push(req.url ?? "");

    const send = (status: number, body: string, type: string) => {
      res.writeHead(status, { "Content-Type": type });
      res.end(body);
    };

    // A feed that is simply broken. One dead source must never lose the others.
    if (url.pathname === "/broken") {
      return send(500, "upstream on fire", "text/plain");
    }
    if (url.pathname === "/atom") {
      return send(200, ATOM, "application/atom+xml");
    }
    if (url.pathname.startsWith("/r/")) {
      return send(200, JSON.stringify(REDDIT), "application/json");
    }
    // Google News: both /search and the bare front page.
    return send(200, RSS, "application/rss+xml");
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Fake feed server failed to bind");
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    server,
    requested,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
