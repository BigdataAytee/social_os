import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";

/**
 * A stand-in for X's OAuth and API endpoints, for exercising the connect flow
 * without a developer app or network access.
 *
 * It is deliberately strict about the parts that are easy to get wrong and
 * impossible to notice until launch day: it rejects a token request whose PKCE
 * verifier doesn't hash to the challenge, one that reuses a code, one whose
 * redirect_uri doesn't match the authorize call, and one missing HTTP Basic
 * auth — which is X's requirement and nobody else's. A permissive fake would
 * pass a broken implementation.
 *
 * Point the app at it with SOCIALOS_OAUTH_BASE_X and SOCIALOS_API_BASE_X.
 */

export type FakePlatform = {
  server: Server;
  url: string;
  /** Codes issued but not yet redeemed. */
  pending: Map<string, { challenge?: string; redirectUri: string }>;
  issuedRefreshTokens: string[];
  close: () => Promise<void>;
};

const CLIENT_ID = "fake-client-id";
const CLIENT_SECRET = "fake-client-secret";

/** Deterministic post fixtures with a shape insights can find patterns in. */
function tweets() {
  const now = Date.now();
  const day = 86_400_000;

  // Videos on Tuesday mornings do well; long text posts do badly. A real
  // account's data is messier, but the analysis has to find *something*
  // recoverable or the test proves nothing.
  const rows: {
    id: string;
    text: string;
    daysAgo: number;
    hourUtc: number;
    weekday: number;
    likes: number;
    replies: number;
    reposts: number;
    impressions: number;
    video: boolean;
  }[] = [];

  let id = 1000;
  for (let week = 0; week < 8; week++) {
    // Tuesday 09:00 video — the pattern to be found.
    rows.push({
      id: String(id++),
      text: `#buildinpublic shipping notes, week ${week + 1}. What changed and why.`,
      daysAgo: week * 7,
      hourUtc: 9,
      weekday: 2,
      likes: 420 + week * 5,
      replies: 60,
      reposts: 80,
      impressions: 9_000,
      video: true,
    });
    // Thursday 22:00 long text — the anti-pattern.
    rows.push({
      id: String(id++),
      text:
        // Deliberately over 500 characters so it lands in the top length band
        // and the length analysis has something to distinguish.
        "A longer reflection on content operations and the way teams organise their publishing calendars across platforms, which is a topic that deserves more nuance than a single post can reasonably give it, and yet here we are trying anyway. ".repeat(
          3
        ),
      daysAgo: week * 7 + 2,
      hourUtc: 22,
      weekday: 4,
      likes: 40,
      replies: 3,
      reposts: 2,
      impressions: 11_000,
      video: false,
    });
    // Saturday 14:00 short text — middling.
    rows.push({
      id: String(id++),
      text: `#buildinpublic quick one: ship the smaller thing.`,
      daysAgo: week * 7 + 4,
      hourUtc: 14,
      weekday: 6,
      likes: 180,
      replies: 20,
      reposts: 25,
      impressions: 8_000,
      video: false,
    });
  }

  return rows.map((row) => {
    // Anchor each post on the intended weekday so the timing analysis has a
    // real signal rather than whatever weekday the test happened to run on.
    const date = new Date(now - row.daysAgo * day);
    const shift = (date.getUTCDay() - row.weekday + 7) % 7;
    date.setUTCDate(date.getUTCDate() - shift);
    date.setUTCHours(row.hourUtc, 0, 0, 0);

    return {
      id: row.id,
      text: row.text,
      created_at: date.toISOString(),
      public_metrics: {
        like_count: row.likes,
        reply_count: row.replies,
        retweet_count: row.reposts,
        impression_count: row.impressions,
        quote_count: 0,
        bookmark_count: 12,
      },
      ...(row.video
        ? { attachments: { media_keys: [`media_${row.id}`] } }
        : {}),
    };
  });
}

const TWEETS = tweets();
const MEDIA = TWEETS.filter((t) => "attachments" in t).map((t) => ({
  media_key: `media_${t.id}`,
  type: "video",
}));

export async function startFakePlatform(): Promise<FakePlatform> {
  const pending = new Map<string, { challenge?: string; redirectUri: string }>();
  const issuedRefreshTokens: string[] = [];
  const validAccessTokens = new Set<string>();

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    const authorized = () => {
      const header = req.headers.authorization ?? "";
      return (
        header.startsWith("Bearer ") &&
        validAccessTokens.has(header.slice("Bearer ".length))
      );
    };

    // ---------------------------------------------------------- authorize
    if (url.pathname === "/i/oauth2/authorize") {
      const redirect = url.searchParams.get("redirect_uri");
      const state = url.searchParams.get("state");
      if (!redirect || !state) return send(400, { error: "invalid_request" });

      if (url.searchParams.get("code_challenge_method") !== "S256") {
        return send(400, { error: "pkce_required" });
      }

      const code = `code_${Math.random().toString(36).slice(2)}`;
      pending.set(code, {
        challenge: url.searchParams.get("code_challenge") ?? undefined,
        redirectUri: redirect,
      });

      const back = new URL(redirect);
      back.searchParams.set("code", code);
      back.searchParams.set("state", state);
      res.writeHead(302, { Location: back.toString() });
      return res.end();
    }

    // -------------------------------------------------------------- token
    if (url.pathname === "/2/oauth2/token" && req.method === "POST") {
      let raw = "";
      req.on("data", (chunk) => (raw += chunk));
      req.on("end", () => {
        const form = new URLSearchParams(raw);

        // X requires HTTP Basic on this endpoint.
        const basic = req.headers.authorization;
        const expected = `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64")}`;
        if (basic !== expected) {
          return send(401, { error: "invalid_client" });
        }

        const grant = form.get("grant_type");

        if (grant === "refresh_token") {
          const presented = form.get("refresh_token") ?? "";
          if (!issuedRefreshTokens.includes(presented)) {
            return send(400, { error: "invalid_grant" });
          }
          const access = `access_${Math.random().toString(36).slice(2)}`;
          const refresh = `refresh_${Math.random().toString(36).slice(2)}`;
          validAccessTokens.add(access);
          issuedRefreshTokens.push(refresh);
          return send(200, {
            access_token: access,
            refresh_token: refresh,
            expires_in: 7200,
            scope: "tweet.read users.read offline.access",
          });
        }

        const code = form.get("code") ?? "";
        const issued = pending.get(code);
        // Single use — a replayed code must fail.
        if (!issued) return send(400, { error: "invalid_grant" });
        pending.delete(code);

        if (form.get("redirect_uri") !== issued.redirectUri) {
          return send(400, { error: "redirect_uri_mismatch" });
        }

        if (issued.challenge) {
          const verifier = form.get("code_verifier") ?? "";
          const computed = createHash("sha256")
            .update(verifier)
            .digest("base64url");
          if (computed !== issued.challenge) {
            return send(400, { error: "invalid_code_verifier" });
          }
        }

        const access = `access_${Math.random().toString(36).slice(2)}`;
        const refresh = `refresh_${Math.random().toString(36).slice(2)}`;
        validAccessTokens.add(access);
        issuedRefreshTokens.push(refresh);
        return send(200, {
          access_token: access,
          refresh_token: refresh,
          expires_in: 7200,
          scope: "tweet.read users.read offline.access",
        });
      });
      return;
    }

    // ---------------------------------------------------------------- API
    if (!authorized()) return send(401, { title: "Unauthorized" });

    if (url.pathname === "/2/users/me") {
      return send(200, {
        data: {
          id: "user-42",
          username: "northwind",
          name: "Northwind Studio",
          public_metrics: { followers_count: 22_065 },
        },
      });
    }

    if (url.pathname === "/2/users/user-42") {
      return send(200, {
        data: { id: "user-42", public_metrics: { followers_count: 22_065 } },
      });
    }

    if (url.pathname === "/2/users/user-42/tweets") {
      const start = url.searchParams.get("start_time");
      const since = start ? new Date(start) : new Date(0);
      const data = TWEETS.filter((t) => new Date(t.created_at) >= since);
      return send(200, { data, includes: { media: MEDIA } });
    }

    return send(404, { error: "not_found", path: url.pathname });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (typeof address === "string" || address === null) {
    throw new Error("Fake platform failed to bind");
  }

  return {
    server,
    url: `http://127.0.0.1:${address.port}`,
    pending,
    issuedRefreshTokens,
    close: () =>
      new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

export const FAKE_CLIENT = { id: CLIENT_ID, secret: CLIENT_SECRET };
export const FAKE_TWEET_COUNT = TWEETS.length;
