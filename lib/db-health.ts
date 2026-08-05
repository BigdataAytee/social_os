import { cache } from "react";

import { db } from "@/lib/db";

/**
 * Is the database usable right now, and if not, why?
 *
 * The deploy no longer fails when migrations can't run (see
 * scripts/prepare-database.ts), which means the app can boot against a database
 * that is missing, unreachable, or has no tables. Without this check those cases
 * surface as an unhandled 500 on the first authenticated page.
 *
 * The status alone turned out not to be enough. "unreachable" covers a wrong
 * password, a paused Supabase project, a hostname typo and a value that isn't a
 * URL at all — four different fixes behind one word, with the real error only in
 * server logs the person deploying may never see. So this also returns the
 * underlying error, password-redacted, plus anything wrong we can spot by
 * *reading* the connection strings without opening a socket.
 */

export type DatabaseStatus =
  | "ok"
  /** No DATABASE_URL at all. */
  | "unconfigured"
  /** Configured, but the server refused, timed out, or rejected our credentials. */
  | "unreachable"
  /** Reachable, but `prisma migrate deploy` has never succeeded against it. */
  | "not-migrated"
  /**
   * Migrated, but behind this build: the code expects migrations the database
   * hasn't got. Distinct from "not-migrated" because the tables the health
   * check itself touches all exist — the app looks fine right up until a page
   * queries a column added by the missing migration.
   */
  | "schema-outdated";

export type DatabaseHealth = {
  status: DatabaseStatus;
  /** What the driver actually said, with any password removed. */
  detail?: string;
  /** Prisma's error code, when it gave one (P1001, P1000, …). */
  code?: string;
  /** Problems visible in the connection strings themselves. */
  hints: string[];
  /** Migrations this build ships that the database hasn't applied. */
  pendingMigrations?: string[];
};

/** Prisma's code for "relation does not exist". */
const TABLE_MISSING = "P2021";

/**
 * Plain-English readings of the connection failures worth naming. Prisma's own
 * text is accurate but assumes you already know what it's describing.
 *
 * Matched on the message, not just the error code: Prisma 5 leaves `errorCode`
 * undefined on the PrismaClientInitializationError thrown by a failed connect,
 * which is precisely the case this page exists to explain. The code is used
 * when present and inferred from the text when not.
 */
const FAILURES: { code: string; test: RegExp; meaning: string }[] = [
  {
    code: "P1000",
    test: /authentication failed|password authentication/i,
    meaning:
      "The database rejected the username or password. If you rotated the Supabase database password, update DATABASE_URL and DIRECT_URL to match — and note that a password containing @ : / ? # or & must be percent-encoded (@ becomes %40).",
  },
  {
    code: "P1001",
    test: /can'?t reach database server|connection refused|getaddrinfo|dns/i,
    meaning:
      "Nothing answered at that host and port. On Supabase the usual cause is a project paused for inactivity — open the dashboard and resume it — or a host or port that doesn't match the one under Project Settings → Database.",
  },
  {
    code: "P1002",
    test: /timed out|timeout/i,
    meaning:
      "The host accepted the connection but timed out before responding. Usually a paused or overloaded database.",
  },
  {
    code: "P1003",
    test: /database .* does not exist/i,
    meaning: "The host is reachable but has no database by that name.",
  },
  {
    code: "P1013",
    test: /must start with the protocol|invalid .*connection string|invalid port/i,
    meaning:
      "The connection string itself is malformed, so no connection was attempted. Check DATABASE_URL for stray quotes and for an unencoded @ in the password.",
  },
  {
    code: "P1017",
    test: /server has closed the connection|connection closed/i,
    meaning:
      "The database closed the connection, often a pooler rejecting the connection mode.",
  },
];

function codeOf(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  for (const key of ["code", "errorCode"] as const) {
    if (key in error) {
      const value = (error as Record<string, unknown>)[key];
      if (typeof value === "string" && value) return value;
    }
  }
  return undefined;
}

/**
 * Never render a password. Prisma usually redacts connection strings in its
 * messages, but "usually" isn't good enough for a page served unauthenticated —
 * strip the credentials ourselves before the text can reach a response.
 */
export function redact(text: string): string {
  return text
    .replace(/(postgres(?:ql)?:\/\/[^:\s/]+):[^@\s]*@/gi, "$1:****@")
    .replace(/\b(password)=[^\s&"']+/gi, "$1=****");
}

function describe(error: unknown): { detail: string; code?: string } {
  const raw = error instanceof Error ? error.message : String(error);

  // Prisma initialization errors arrive as several lines behind an
  // "Invalid `prisma.x()` invocation:" banner. The first line after the banner
  // is the one that says what actually happened.
  const summary =
    raw
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line && !/^invalid `.*` invocation:?$/i.test(line)) ?? raw;

  const match = FAILURES.find((failure) => failure.test.test(raw));

  return {
    code: codeOf(error) ?? match?.code,
    detail: redact(
      match ? `${summary} — ${match.meaning}` : summary
    ).slice(0, 600),
  };
}

/**
 * Report what's wrong with the connection strings without connecting. These are
 * the mistakes that produce a generic connection failure and give no clue which
 * of the two variables is at fault.
 */
export function inspectConnectionStrings(
  env: Record<string, string | undefined> = process.env
): string[] {
  const hints: string[] = [];

  for (const name of ["DATABASE_URL", "DIRECT_URL"] as const) {
    const value = env[name];

    if (!value) {
      // A missing DATABASE_URL is already reported as `unconfigured`; DIRECT_URL
      // only matters for migrations, so name that consequence specifically.
      if (name === "DIRECT_URL" && env.DATABASE_URL) {
        hints.push(
          "DIRECT_URL isn't set. Migrations need the direct connection on port 5432; without it they run through the pooler, which is unreliable for schema changes."
        );
      }
      continue;
    }

    // Vercel stores values verbatim. Pasting the surrounding quotes from a .env
    // line is a common and completely invisible mistake — the variable looks
    // correct in the dashboard and is unparseable at runtime.
    if (/^["']|["']$/.test(value)) {
      hints.push(
        `${name} begins or ends with a quote character. Vercel stores values literally, so remove the surrounding quotes and redeploy.`
      );
      continue;
    }

    if (value !== value.trim()) {
      hints.push(
        `${name} has leading or trailing whitespace — trim it and redeploy.`
      );
    }

    const trimmed = value.trim();

    if (!/^postgres(ql)?:\/\//i.test(trimmed)) {
      hints.push(
        `${name} doesn't start with postgresql:// — it isn't a Postgres connection string.`
      );
      continue;
    }

    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      hints.push(
        `${name} isn't a parseable URL. If the password contains @ : / ? # or &, percent-encode it (@ becomes %40).`
      );
      continue;
    }

    // A password containing a literal @ still *parses* — the parser splits on
    // the last one, so the host looks right and the credentials are silently
    // truncated. It surfaces much later as an authentication failure, which is
    // why it's worth naming here rather than leaving to P1000.
    const authority = trimmed.slice(trimmed.indexOf("://") + 3).split("/")[0] ?? "";
    if (authority.split("@").length > 2) {
      hints.push(
        `${name} has more than one @ before the host, so the password is being cut short. Percent-encode any @ inside the password as %40.`
      );
    }

    const pooled = (url.port || "5432") === "6543";

    if (name === "DATABASE_URL" && pooled && !url.searchParams.has("pgbouncer")) {
      hints.push(
        "DATABASE_URL uses the pooled port 6543 but has no ?pgbouncer=true. Prisma's prepared statements break against transaction-mode pgbouncer without it."
      );
    }

    if (name === "DIRECT_URL" && pooled) {
      hints.push(
        "DIRECT_URL points at the pooled port 6543. Migrations need the direct connection — change it to 5432."
      );
    }
  }

  return hints;
}

/**
 * Migrations this build ships that the database hasn't applied.
 *
 * Exists because a database can be *behind* the code rather than empty, and
 * nothing else notices. The common way to get there is a preview deployment:
 * scripts/prepare-database.ts deliberately refuses to migrate from a preview
 * build (previews share production's environment variables, so migrating from
 * one would alter the production database), which means a preview whose branch
 * adds a migration runs new code against an old schema. Every page that touches
 * the changed table then dies with Prisma P2022 and an opaque digest.
 *
 * Compares the migration folders shipped in the build against the rows Prisma
 * records in `_prisma_migrations`. Any failure to read either side returns
 * empty — an inconclusive check must never manufacture a problem, because the
 * cost of a false positive here is locking a working app out of its own pages.
 */
async function pendingMigrations(): Promise<string[]> {
  let shipped: string[];
  try {
    const { readdirSync } = await import("node:fs");
    const { join } = await import("node:path");
    shipped = readdirSync(join(process.cwd(), "prisma", "migrations"), {
      withFileTypes: true,
    })
      .filter((entry) => entry.isDirectory() && /^\d{14}_/.test(entry.name))
      .map((entry) => entry.name);
  } catch {
    // The folder isn't in the deployment bundle (see next.config.mjs) or we're
    // somewhere without a filesystem. Can't compare; don't guess.
    return [];
  }
  if (shipped.length === 0) return [];

  try {
    const applied = await db.$queryRaw<{ migration_name: string }[]>`
      SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL
    `;
    const done = new Set(applied.map((row) => row.migration_name));
    return shipped.filter((name) => !done.has(name)).sort();
  } catch {
    // No _prisma_migrations table means the schema was applied by hand rather
    // than by `migrate deploy`. That is a legitimate setup, not a fault.
    return [];
  }
}

export const getDatabaseHealth = cache(async (): Promise<DatabaseHealth> => {
  const hints = inspectConnectionStrings();

  if (!process.env.DATABASE_URL) return { status: "unconfigured", hints };

  try {
    // Cheapest possible round trip — proves we can connect and authenticate
    // without depending on any table existing yet.
    await db.$queryRaw`SELECT 1`;
  } catch (error) {
    return { status: "unreachable", hints, ...describe(error) };
  }

  try {
    await db.organization.count();

    // The tables this check touches are the oldest ones, so they exist in every
    // version of the schema. That is exactly why passing them proves nothing
    // about whether the database matches *this build*.
    const pending = await pendingMigrations();
    if (pending.length > 0) {
      return { status: "schema-outdated", hints, pendingMigrations: pending };
    }

    return { status: "ok", hints };
  } catch (error) {
    // A missing table means the connection is fine but migrations haven't run.
    // Anything else is a live database having a bad day — treat it as reachable
    // rather than claiming it needs migrating.
    const described = describe(error);
    return described.code === TABLE_MISSING
      ? { status: "not-migrated", hints, ...described }
      : { status: "unreachable", hints, ...described };
  }
});

export async function checkDatabase(): Promise<DatabaseStatus> {
  return (await getDatabaseHealth()).status;
}

export const DATABASE_STATUS_MESSAGE: Record<
  Exclude<DatabaseStatus, "ok">,
  string
> = {
  unconfigured:
    "DATABASE_URL isn't set, so there's no database to read from yet.",
  unreachable:
    "The database is configured but wouldn't accept a connection. What it returned is below.",
  "not-migrated":
    "The database is reachable but has no tables — migrations haven't run against it yet. The next deploy will apply them, or run `npm run setup` against it directly.",
  "schema-outdated":
    "The database is reachable, but this deployment's code expects migrations it hasn't got. Pages would fail on the tables those migrations change, so they aren't rendered.",
};
