import type { Platform } from "@prisma/client";

import { openJson } from "@/lib/crypto";
import { db } from "@/lib/db";
import { unifiedApiKey, unifiedProvider } from "./provider";

/**
 * The one HTTP client every unified call goes through.
 *
 * §4's registry sketch has a single `unifiedAdapter` instance with the platform
 * passed per call. The `PlatformAdapter` interface carries `platform` as a
 * property, so the registry returns a thin per-platform binding instead — but
 * they all share *this*, which holds the provider config, the API key and the
 * per-account scoping. That's the "one instance" that matters: there is one
 * implementation of the provider protocol, not five.
 *
 * The account key is read through the same encrypted `PlatformCredential` row a
 * direct token uses. Platform-Connections.md §3 is explicit that a provider
 * reference is still sensitive — it authorises actions on the user's behalf —
 * so it gets the same treatment rather than being stashed in `meta`.
 */

export type UnifiedAccountRef = {
  /** The provider's key for this org's connected account. */
  accountKey: string;
};

export class UnifiedNotConfiguredError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "UnifiedNotConfiguredError";
  }
}

/**
 * Reads the provider account key for a ConnectedAccount.
 *
 * Deliberately mirrors `withAccessToken` in shape but not in contract: there is
 * no refresh here, because keeping the platform token alive is the provider's
 * problem once an account is on `UNIFIED` (§3). That is most of the reason to
 * pick unified in the first place.
 *
 * **Returns null for a primary-profile connection**, and that distinction is
 * the whole point. A one-click connect stores an empty reference to mean "use
 * the provider's primary profile". Sending that as the header value is not the
 * same as omitting the header: Ayrshare reads an empty `Profile-Key` as a
 * *supplied and invalid* key and rejects the call outright — which is exactly
 * what the first real connection did, reporting "The Profile Key is invalid"
 * for an account that had no profile key by design.
 */
async function accountKey(accountId: string): Promise<string | null> {
  const credential = await db.platformCredential.findUnique({
    where: { accountId },
  });
  if (!credential) {
    throw new Error("This account has no stored provider reference — reconnect it.");
  }
  let stored: string;
  try {
    stored = openJson<{ accessToken: string }>(credential).accessToken;
  } catch {
    throw new Error(
      "The stored provider reference could not be decrypted. If SOCIALOS_ENCRYPTION_KEY changed, reconnect the account."
    );
  }
  return stored.trim() === "" ? null : stored;
}

type RequestOptions = {
  path: string;
  method?: "GET" | "POST";
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  /** Omit for calls that aren't scoped to one connected account. */
  accountId?: string;
};

export async function unifiedRequest<T>(opts: RequestOptions): Promise<T> {
  const provider = unifiedProvider();
  const key = unifiedApiKey();
  if (!key) {
    throw new UnifiedNotConfiguredError(
      `${provider.apiKeyEnv} isn't set, so unified accounts can't be reached.`
    );
  }

  const url = new URL(`${provider.baseUrl}${opts.path}`);
  for (const [name, value] of Object.entries(opts.query ?? {})) {
    if (value !== undefined) url.searchParams.set(name, String(value));
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${key}`,
    Accept: "application/json",
  };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.accountId) {
    // Omitted entirely when there is no profile key — see `accountKey`. An
    // empty header value is a different request from an absent one.
    const key = await accountKey(opts.accountId);
    if (key) headers[provider.accountKeyHeader] = key;
  }

  const response = await fetch(url, {
    method: opts.method ?? "GET",
    headers,
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });

  const text = await response.text();
  let payload: unknown;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { message: text };
  }

  if (!response.ok) {
    const message = extractMessage(payload, text, response.status);

    // A provider outage and a revoked account need different responses from the
    // person reading the error — one is "wait", the other is "reconnect" — so
    // they are not flattened into one message.
    if (response.status === 401 || response.status === 403) {
      throw new Error(
        `${provider.label} rejected the request for this account (${message}). Reconnect it.`
      );
    }
    if (response.status === 429) {
      throw new Error(
        `${provider.label} rate-limited this request. The next sync picks up where this one stopped.`
      );
    }
    if (response.status >= 500) {
      throw new Error(
        `${provider.label} is having trouble (${response.status}). This is on their side; the next sync will retry.`
      );
    }
    // The path is included because "400 on /history" and "400 on
    // /analytics/post" are different problems, and the previous message named
    // neither the endpoint nor the reason.
    throw new Error(
      `${provider.label} returned ${response.status} from ${opts.path}: ${message}`
    );
  }

  return payload as T;
}

/**
 * The provider's own words for what went wrong.
 *
 * The first version read `.message` then `.error` and otherwise fell back to
 * `HTTP ${status}` — which, interpolated into "returned 400: HTTP 400",
 * reported the status twice and the reason never. Ayrshare puts its detail in
 * at least four shapes depending on the endpoint, and an error handler that
 * discards the error is worse than no handler: it converts a diagnosable
 * failure into a mystery.
 *
 * Falls through to the raw body, truncated. An unparsed response is still far
 * more use than a status code, and this is the one place where showing the
 * provider's own text is exactly what the reader needs.
 */
function extractMessage(payload: unknown, raw: string, status: number): string {
  const body = payload as {
    message?: unknown;
    error?: unknown;
    errors?: unknown;
    status?: unknown;
    code?: unknown;
    data?: { message?: unknown };
  };

  const first =
    Array.isArray(body?.errors) && body.errors.length > 0
      ? (body.errors[0] as { message?: unknown; code?: unknown })
      : null;

  const detail =
    text(body?.message) ??
    text(body?.error) ??
    text(first?.message) ??
    text(body?.data?.message) ??
    // Nothing recognised. The raw body beats the status code every time.
    (raw.trim() ? raw.trim().slice(0, 300) : null);

  const code = body?.code ?? first?.code;
  const suffix = code !== undefined && code !== null ? ` (code ${String(code)})` : "";

  return detail ? `${detail}${suffix}` : `no detail in the ${status} response`;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** The provider's own name for a platform, in its request payloads. */
export function networkName(platform: Platform): string {
  return unifiedProvider().networkFor[platform];
}
