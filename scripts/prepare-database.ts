/**
 * Build-time database preparation, run by `vercel-build` before `next build`.
 *
 * Exists because the Postgres ports aren't reachable from every machine that
 * needs to set this project up, but Vercel's builders can reach Supabase fine.
 *
 * Three rules, in order of how much damage getting them wrong would do:
 *
 *   1. Production deploys only. Vercel hands preview deployments the same
 *      environment variables as production by default, so without this gate a
 *      pull-request preview build would migrate the production database.
 *   2. Migrations use `migrate deploy`, which applies only pending migrations
 *      and never generates or resets anything. Safe to run on every deploy.
 *   3. The demo seed runs *only into an empty database*. `prisma/seed.ts` is
 *      destructive by design — it deletes the demo organization and rebuilds it
 *      so local re-runs stay deterministic. Running that on a redeploy would
 *      erase whatever the org had published since. The guard below is the only
 *      thing standing between a routine redeploy and that.
 *
 * This step never fails the build. An earlier version did fail on an unreachable
 * database, on the theory that shipping code against a schema it doesn't match
 * is worse than a red deploy — but the practical result was a Vercel 404 with
 * no way to see what went wrong. Deploying and *reporting* the problem beats
 * blocking the deploy: lib/db-health.ts detects an unusable database at
 * request time and sends you to /setup, which names the specific failure, so
 * the app never renders against a schema it can't use.
 */

import { spawnSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

const SKIP = "→ skipping database preparation:";

function run(command: string, args: string[]) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(`\`${command} ${args.join(" ")}\` exited with ${result.status}`);
  }
}

async function main() {
  const vercelEnv = process.env.VERCEL_ENV;
  const allowNonProduction = process.env.SOCIALOS_DB_SETUP_ON_PREVIEW === "1";

  // Rule 1. Locally VERCEL_ENV is undefined, so `npm run vercel-build` on your
  // own machine behaves like production — that's deliberate, it's how you'd
  // test this path.
  if (vercelEnv && vercelEnv !== "production" && !allowNonProduction) {
    console.log(
      `${SKIP} VERCEL_ENV is "${vercelEnv}", not "production". Preview builds share production's environment variables, so migrating from one would hit the production database. Set SOCIALOS_DB_SETUP_ON_PREVIEW=1 if a preview genuinely has its own database.`
    );
    return;
  }

  if (!process.env.DATABASE_URL) {
    console.log(
      `${SKIP} DATABASE_URL is not set. The app will build and serve /setup, which lists what to configure.`
    );
    return;
  }

  console.log("→ Applying migrations (prisma migrate deploy)…");
  try {
    run("npx", ["prisma", "migrate", "deploy"]);
  } catch (error) {
    warn("Migrations did not run.", error);
    return;
  }

  if (process.env.SOCIALOS_SKIP_SEED === "1") {
    console.log("→ SOCIALOS_SKIP_SEED=1 — leaving the database empty.");
    return;
  }

  const db = new PrismaClient();
  let shouldSeed = false;
  try {
    // The guard. An organization existing means this database has been seeded
    // (or genuinely used), and the destructive seed must not touch it.
    const organizations = await db.organization.count();

    if (organizations > 0) {
      console.log(
        `→ Database already has ${organizations} organization${organizations === 1 ? "" : "s"} — skipping the demo seed so existing content is left alone.`
      );
    } else {
      console.log("→ Empty database — seeding the demo organization…");
      shouldSeed = true;
    }
  } catch (error) {
    // Can't read the guard, so we can't prove the database is empty. Skipping
    // is the only safe move: the seed deletes and rebuilds the demo org, and
    // running it against a database we couldn't inspect risks erasing content.
    warn("Couldn't check whether the database is already seeded, so the seed was skipped.", error);
    return;
  } finally {
    await db.$disconnect();
  }

  if (!shouldSeed) return;

  try {
    run("npx", ["prisma", "db", "seed"]);
  } catch (error) {
    warn("Seeding failed. The schema is in place but there's no demo data.", error);
  }
}

/**
 * Report and carry on. The build continues so the app deploys and can explain
 * the problem on /setup, which is more use than a failed deploy.
 */
function warn(summary: string, error: unknown) {
  console.warn(`\n⚠ ${summary}`);
  console.warn(error instanceof Error ? error.message : String(error));
  console.warn(
    "The build will continue. The app will deploy and show /setup, which names the problem — it won't render pages against a database it can't use. Fix DATABASE_URL / DIRECT_URL and redeploy.\n"
  );
}

// Deliberately resolves even on failure — see the note at the top of the file.
main().catch((error) => {
  warn("Database preparation hit an unexpected error.", error);
});
