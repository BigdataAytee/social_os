import { createServer, type Server } from "node:http";

/**
 * A stand-in for a unified provider's API (Platform-Connections.md §4).
 *
 * Strict where it matters: it rejects a request without the bearer API key, and
 * — the one that actually protects users — a request without the per-account
 * key header. On a multi-tenant plan that header is the only thing separating
 * one org's data from another's, so a fake that ignored it would let a
 * tenant-isolation bug ship.
 *
 * Point the app at it with SOCIALOS_UNIFIED_BASE.
 */

export const FAKE_UNIFIED_KEY = "fake-unified-api-key";

/**
 * What the API key resolves to when no Profile-Key header is sent.
 *
 * Named rather than implied, because "no header" is a real and supported
 * request shape — a single-brand deployment connects this way — and treating it
 * as an error is what hid a production bug behind a green suite.
 */
export const PRIMARY_PROFILE = "primary-profile";

/**
 * A profile the provider knows about but which has published nothing through
 * it — the state of every account on the day it is connected.
 *
 * Worth a fixture of its own because zero is a *correct* answer here, and the
 * app has to distinguish it from a broken pull.
 */
export const EMPTY_PROFILE = "acct-empty";

export type FakeUnified = {
  url: string;
  server: Server;
  /** Every Profile-Key the server was called with, for isolation assertions. */
  seenAccountKeys: string[];
  published: { post: string; platforms: string[] }[];
  close: () => Promise<void>;
};

/** Two accounts' worth of history, so cross-tenant leakage is detectable. */
function historyFor(accountKey: string) {
  if (accountKey === EMPTY_PROFILE) return [];

  const now = Date.now();
  const day = 86_400_000;

  // Only this key's own posts, so cross-tenant leakage shows up as the wrong
  // label rather than as silence.
  const label = accountKey === "acct-second" ? "second" : "primary";

  const rows: { id: string; text: string; daysAgo: number; video: boolean }[] = [];
  for (let i = 0; i < 12; i++) {
    rows.push({
      id: `${label}-post-${i}`,
      text:
        i % 3 === 0
          ? `#buildinpublic weekly shipping notes, edition ${i}. What changed.`
          : `Short note ${i} from the ${label} account.`,
      daysAgo: i * 3,
      video: i % 3 === 0,
    });
  }

  return rows.map((row) => ({
    id: row.id,
    post: row.text,
    // Half tagged with the post-rebrand name. A provider mid-migration answers
    // with both, and a strict match on the value we *send* would drop these
    // silently — a successful sync of nothing, which is the failure this
    // fixture exists to catch.
    platforms: [row.id.endsWith("1") || row.id.endsWith("4") ? "x" : "twitter"],
    created: new Date(now - row.daysAgo * day).toISOString(),
    postUrl: `https://example.test/${row.id}`,
    mediaUrls: row.video ? ["https://example.test/v.mp4"] : [],
    isVideo: row.video,
  }));
}

export async function startFakeUnified(): Promise<FakeUnified> {
  const seenAccountKeys: string[] = [];
  const published: { post: string; platforms: string[] }[] = [];

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };

    if (req.headers.authorization !== `Bearer ${FAKE_UNIFIED_KEY}`) {
      return send(401, { message: "Invalid API key" });
    }

    const suppliedKey = req.headers["profile-key"];

    // Mirrors Ayrshare's actual behaviour, which the first version of this fake
    // did not — and that gap is precisely why a bug reached production:
    //
    //   - header absent  → the API key's own primary profile. Legitimate, and
    //     what a one-click connect relies on.
    //   - header present but empty → a supplied key that is invalid. Rejected,
    //     with the message the real provider sends.
    //
    // A fake that demanded the header made the empty-header case untestable and
    // the absent-header case unreachable.
    if (typeof suppliedKey === "string" && suppliedKey.trim() === "") {
      return send(401, {
        message: "The Profile Key is invalid. Please verify correct Profile Key is being used.",
      });
    }
    const accountKey = suppliedKey ?? PRIMARY_PROFILE;
    if (typeof accountKey !== "string") {
      return send(400, { message: "Profile-Key must be a single value" });
    }
    seenAccountKeys.push(accountKey);

    const readBody = (then: (body: Record<string, unknown>) => void) => {
      let raw = "";
      req.on("data", (chunk) => (raw += chunk));
      req.on("end", () => {
        try {
          then(raw ? JSON.parse(raw) : {});
        } catch {
          send(400, { message: "Malformed JSON" });
        }
      });
    };

    // Error-shape probe. Ayrshare reports failures in several shapes depending
    // on the endpoint, and the client used to discard all of them; this lets the
    // suite assert on each one rather than on the shape we happened to expect.
    if (url.pathname === "/error-shape") {
      const shape = url.searchParams.get("shape");
      if (shape === "message") {
        return send(400, { status: "error", message: "Invalid platform value" });
      }
      if (shape === "errors") {
        return send(400, {
          status: "error",
          errors: [{ code: 189, message: "TikTok is not linked to this profile" }],
        });
      }
      if (shape === "data") {
        return send(400, { data: { message: "Nested detail" } });
      }
      if (shape === "unknown") {
        return send(400, { somethingElse: true, hint: "not a shape we parse" });
      }
      if (shape === "empty") {
        res.writeHead(400, { "Content-Type": "application/json" });
        return res.end("");
      }
      return send(400, { message: "unknown shape" });
    }

    if (url.pathname === "/history") {
      return send(200, { posts: historyFor(accountKey) });
    }

    if (url.pathname === "/analytics/post" && req.method === "POST") {
      return readBody((body) => {
        const id = String(body.id ?? "");
        // Videos out-engage text on this fixture, so the insights layer has a
        // recoverable pattern rather than uniform noise.
        const video = id.includes("-0") || Number(id.split("-").pop()) % 3 === 0;
        send(200, {
          twitter: {
            analytics: {
              likeCount: video ? 400 : 60,
              commentCount: video ? 55 : 6,
              shareCount: video ? 70 : 4,
              impressionCount: 9_000,
              saveCount: 12,
              clickCount: 30,
            },
          },
        });
      });
    }

    if (url.pathname === "/analytics/social" && req.method === "POST") {
      return readBody(() =>
        send(200, { twitter: { analytics: { followersCount: 22_065 } } })
      );
    }

    if (url.pathname === "/post" && req.method === "POST") {
      return readBody((body) => {
        published.push({
          post: String(body.post ?? ""),
          platforms: (body.platforms as string[]) ?? [],
        });
        send(200, {
          status: "success",
          postIds: [
            {
              platform: "twitter",
              id: `published-${published.length}`,
              postUrl: `https://example.test/published-${published.length}`,
            },
          ],
        });
      });
    }

    return send(404, { message: `No route ${url.pathname}` });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (typeof address === "string" || address === null) {
    throw new Error("Fake unified provider failed to bind");
  }

  return {
    server,
    url: `http://127.0.0.1:${address.port}`,
    seenAccountKeys,
    published,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
