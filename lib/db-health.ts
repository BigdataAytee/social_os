import { cache } from "react";

import { db } from "@/lib/db";

/**
 * Is the database usable right now?
 *
 * The deploy no longer fails when migrations can't run (see
 * scripts/prepare-database.ts), which means the app can boot against a database
 * that is missing, unreachable, or has no tables. Without this check those cases
 * surface as an unhandled 500 on the first authenticated page — a blank failure
 * with nothing to act on. With it they land on /setup, which says which one it is.
 */

export type DatabaseStatus =
  | "ok"
  /** No DATABASE_URL at all. */
  | "unconfigured"
  /** Configured, but the server refused or timed out. */
  | "unreachable"
  /** Reachable, but `prisma migrate deploy` has never succeeded against it. */
  | "not-migrated";

/** Prisma's code for "relation does not exist". */
const TABLE_MISSING = "P2021";

function codeOf(error: unknown): string | null {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code: unknown }).code)
    : null;
}

export const checkDatabase = cache(async (): Promise<DatabaseStatus> => {
  if (!process.env.DATABASE_URL) return "unconfigured";

  try {
    // Cheapest possible round trip — proves we can connect and authenticate
    // without depending on any table existing yet.
    await db.$queryRaw`SELECT 1`;
  } catch {
    return "unreachable";
  }

  try {
    await db.organization.count();
    return "ok";
  } catch (error) {
    // A missing table means the connection is fine but migrations haven't run.
    // Anything else is a live database having a bad day — treat it as reachable
    // rather than claiming it needs migrating.
    return codeOf(error) === TABLE_MISSING ? "not-migrated" : "unreachable";
  }
});

export const DATABASE_STATUS_MESSAGE: Record<
  Exclude<DatabaseStatus, "ok">,
  string
> = {
  unconfigured:
    "DATABASE_URL isn't set, so there's no database to read from yet.",
  unreachable:
    "The database is configured but wouldn't accept a connection. Check DATABASE_URL and DIRECT_URL, and that the database is running.",
  "not-migrated":
    "The database is reachable but has no tables — migrations haven't run against it yet. The next deploy will apply them, or run `npm run setup` against it directly.",
};
