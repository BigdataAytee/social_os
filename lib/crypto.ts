import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

/**
 * Authenticated encryption for OAuth tokens at rest (ARCHITECTURE.md §10).
 *
 * AES-256-GCM, not CBC: a platform token is a bearer credential, so the store
 * has to detect tampering as well as hide the value. GCM's auth tag does that —
 * a modified ciphertext fails to decrypt rather than yielding plausible garbage
 * that we would then send to a platform API.
 *
 * The key never lives in the database. If SOCIALOS_ENCRYPTION_KEY is unset the
 * whole OAuth surface reports itself unconfigured rather than falling back to a
 * derived or default key — a predictable key is indistinguishable from storing
 * the tokens in plaintext, and it would be invisible in the UI.
 */

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12; // 96 bits — the size GCM is specified for.

export type SealedBox = {
  ciphertext: string;
  iv: string;
  authTag: string;
};

export class MissingEncryptionKeyError extends Error {
  constructor() {
    super(
      "SOCIALOS_ENCRYPTION_KEY is not set, so platform tokens cannot be stored safely. Generate one with: openssl rand -base64 32"
    );
    this.name = "MissingEncryptionKeyError";
  }
}

/**
 * Accepts base64 or hex. Rejects anything that isn't exactly 32 bytes — a
 * shorter key silently weakens every token in the table, so it fails loudly at
 * the point of use instead.
 */
function readKey(): Buffer {
  const raw = normalizeKey(process.env.SOCIALOS_ENCRYPTION_KEY);
  if (!raw) throw new MissingEncryptionKeyError();

  const decoded = /^[0-9a-f]{64}$/i.test(raw)
    ? Buffer.from(raw, "hex")
    : Buffer.from(raw, "base64");

  if (decoded.length !== KEY_BYTES) {
    throw new Error(
      `SOCIALOS_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes, got ${decoded.length}. Generate one with: openssl rand -base64 32`
    );
  }
  return decoded;
}

/**
 * Trim, and strip a matching pair of surrounding quotes.
 *
 * Pasting a quoted value into a hosting dashboard is common enough — people
 * copy `SOCIALOS_ENCRYPTION_KEY="abc…"` wholesale from a README — and the
 * result decodes to the wrong length while looking obviously correct in the
 * dashboard. Cheap to tolerate; expensive to debug.
 */
function normalizeKey(value: string | undefined): string {
  const trimmed = value?.trim() ?? "";
  return /^(["']).*\1$/s.test(trimmed) ? trimmed.slice(1, -1).trim() : trimmed;
}

/** True when tokens can be stored. Used to gate the connect UI. */
export function isEncryptionConfigured(): boolean {
  return encryptionKeyProblem() === null;
}

/**
 * *Why* tokens can't be stored, or null when they can.
 *
 * Split out from the boolean because collapsing "unset" and "set but invalid"
 * into one flag made every downstream message say "isn't set" — including to
 * someone looking at the variable in their dashboard, who then has no reason to
 * believe the app and no way to find the real problem. The two failures have
 * completely different fixes.
 */
export function encryptionKeyProblem(): string | null {
  try {
    readKey();
    return null;
  } catch (error) {
    return error instanceof Error
      ? error.message
      : "SOCIALOS_ENCRYPTION_KEY could not be read.";
  }
}

export function seal(plaintext: string): SealedBox {
  const key = readKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}

export function open(box: SealedBox): string {
  const key = readKey();
  const decipher = createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(box.iv, "base64")
  );
  decipher.setAuthTag(Buffer.from(box.authTag, "base64"));

  return Buffer.concat([
    decipher.update(Buffer.from(box.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export function sealJson(value: unknown): SealedBox {
  return seal(JSON.stringify(value));
}

export function openJson<T>(box: SealedBox): T {
  return JSON.parse(open(box)) as T;
}

// --------------------------------------------------------------- OAuth state

/**
 * The `state` parameter is signed rather than stored.
 *
 * It has to survive a full round trip through a third party and come back
 * proving three things: that we started this flow, which org and platform it
 * belongs to, and that it hasn't been replayed. An HMAC over the payload plus a
 * nonce echoed in an httpOnly cookie covers all three without a server-side
 * session table. Signing uses the same key material, so a deployment that can
 * store tokens can also verify state.
 */

const STATE_TTL_MS = 10 * 60 * 1000;

export type OAuthState = {
  orgId: string;
  userId: string;
  platform: string;
  nonce: string;
  returnTo: string;
  issuedAt: number;
};

function sign(payload: string): string {
  return createHmac("sha256", readKey()).update(payload).digest("base64url");
}

export function encodeState(state: Omit<OAuthState, "issuedAt">): string {
  const payload = Buffer.from(
    JSON.stringify({ ...state, issuedAt: Date.now() })
  ).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

/** Returns null for anything not signed by us, malformed, or expired. */
export function decodeState(value: string): OAuthState | null {
  const [payload, signature] = value.split(".");
  if (!payload || !signature) return null;

  const expected = Buffer.from(sign(payload));
  const actual = Buffer.from(signature);
  // Length check first: timingSafeEqual throws on a mismatch rather than
  // returning false, and the length is not itself a secret.
  if (expected.length !== actual.length) return null;
  if (!timingSafeEqual(expected, actual)) return null;

  try {
    const state = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8")
    ) as OAuthState;
    if (Date.now() - state.issuedAt > STATE_TTL_MS) return null;
    return state;
  } catch {
    return null;
  }
}

/** Constant-time compare for the state nonce against its cookie. */
export function nonceMatches(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

// ------------------------------------------------------------------ PKCE

export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  // S256 — the only method X and TikTok accept.
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function randomNonce(): string {
  return randomBytes(16).toString("base64url");
}
