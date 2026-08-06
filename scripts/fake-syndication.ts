import { createServer, type Server } from "node:http";

/**
 * A stand-in for X's embed endpoint.
 *
 * The real one is unreachable from this environment, and building against a
 * live third party is how a suite becomes a network test. This answers in the
 * documented `tweet-result` shape, including the parts that make the parser
 * work for its living: a reply carrying its parent, a video tweet, a
 * multi-photo tweet, a deleted id, and a protected one.
 */

export type FakeSyndication = {
  url: string;
  server: Server;
  /** Every id the server was asked for, for assertions about batching. */
  requested: string[];
  close: () => Promise<void>;
};

const AUTHOR = {
  screen_name: "SOghenerukewe",
  name: "Andra",
  profile_image_url_https: "https://example.test/andra.jpg",
  is_blue_verified: true,
};

const REPLIER = {
  screen_name: "Boy994Boy",
  name: "CITYBOY",
  profile_image_url_https: "https://example.test/cityboy.jpg",
  is_blue_verified: true,
};

/** The exchange from the brief's first screenshot, as the endpoint would send it. */
const ORIGINAL = {
  id_str: "1000000000000000001",
  full_text: "Being loyal to a stingy man is cräzy asf.",
  created_at: "2026-08-06T15:24:00.000Z",
  favorite_count: 4200,
  reply_count: 310,
  retweet_count: 190,
  user: AUTHOR,
  conversation: [
    {
      id_str: "1000000000000000002",
      full_text: "Your mummy don cry come ur room again , Chaii.",
      created_at: "2026-08-06T15:41:00.000Z",
      favorite_count: 31000,
      reply_count: 240,
      retweet_count: 5100,
      user: REPLIER,
      in_reply_to_status_id_str: "1000000000000000001",
    },
    {
      id_str: "1000000000000000003",
      full_text: "This is why I stay single, honestly.",
      created_at: "2026-08-06T15:50:00.000Z",
      favorite_count: 120,
      reply_count: 4,
      retweet_count: 3,
      user: { screen_name: "quiet_one", name: "Tobi" },
      in_reply_to_status_id_str: "1000000000000000001",
    },
  ],
};

/** A video post, to exercise media normalisation. */
const VIDEO = {
  id_str: "1000000000000000010",
  full_text: "The cooking will be televised 😂",
  created_at: "2026-08-06T16:25:00.000Z",
  favorite_count: 347,
  reply_count: 93,
  retweet_count: 31,
  user: { screen_name: "khanofkhans11_", name: "KHAN'", is_blue_verified: true },
  video: { variants: [{ src: "https://example.test/clip.mp4", type: "video/mp4" }] },
  conversation: [
    {
      id_str: "1000000000000000011",
      full_text: "Nobody: me with my popcorn in Jude's comment section 😂😂",
      created_at: "2026-08-06T16:40:00.000Z",
      favorite_count: 2100,
      reply_count: 12,
      retweet_count: 300,
      user: { screen_name: "judeengees", name: "Jude" },
      in_reply_to_status_id_str: "1000000000000000010",
    },
  ],
};

/** Several photos, and a parent — the quote-reply shape. */
const CAROUSEL = {
  id_str: "1000000000000000020",
  full_text: "Tongues wag as P-Square's alleged elder brother shares his two cents.",
  created_at: "2026-08-06T12:00:00.000Z",
  favorite_count: 880,
  reply_count: 210,
  retweet_count: 140,
  user: { screen_name: "instablog9ja", name: "Instablog9ja", is_blue_verified: true },
  photos: [
    { url: "https://example.test/psquare-1.jpg" },
    { url: "https://example.test/psquare-2.jpg" },
  ],
  parent: {
    id_str: "1000000000000000021",
    full_text: "Family drama, part one.",
    created_at: "2026-08-06T11:00:00.000Z",
    favorite_count: 12,
    user: { screen_name: "someone_else", name: "Somebody" },
  },
  conversation: [
    {
      id_str: "1000000000000000022",
      full_text: "Two cents wey no reach one kobo.",
      created_at: "2026-08-06T12:30:00.000Z",
      favorite_count: 5400,
      reply_count: 40,
      retweet_count: 900,
      user: { screen_name: "naija_takes", name: "Naija Takes" },
      in_reply_to_status_id_str: "1000000000000000020",
    },
  ],
};

const TWEETS: Record<string, unknown> = {
  [ORIGINAL.id_str]: ORIGINAL,
  [VIDEO.id_str]: VIDEO,
  [CAROUSEL.id_str]: CAROUSEL,
};

/** Ids that answer 404 — deleted and protected posts are the common case. */
export const DELETED_ID = "1000000000000000099";

export async function startFakeSyndication(): Promise<FakeSyndication> {
  const requested: string[] = [];

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    if (url.pathname !== "/tweet-result") {
      res.writeHead(404).end();
      return;
    }

    const id = url.searchParams.get("id") ?? "";
    requested.push(id);

    // The endpoint requires the widget's token; a request without one is
    // rejected, and the suite should notice if we ever stop sending it.
    if (!url.searchParams.get("token")) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "token is required" }));
      return;
    }

    const tweet = TWEETS[id];
    if (!tweet) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
      return;
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(tweet));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Fake syndication server failed to bind");
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    server,
    requested,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

export const IDS = {
  original: ORIGINAL.id_str,
  bestReply: "1000000000000000002",
  weakReply: "1000000000000000003",
  video: VIDEO.id_str,
  carousel: CAROUSEL.id_str,
  carouselParent: "1000000000000000021",
};
