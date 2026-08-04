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
 * Never fails the build for *absence* of configuration — a project with no
 * DATABASE_URL still deploys and serves /setup, which explains what's missing.
 * It does fail for a database that is configured but unreachable or refuses a
 * migration, because shipping code that expects a newer schema than the
 * database has is worse than a red deploy.
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
  run("npx", ["prisma", "migrate", "deploy"]);

  if (process.env.SOCIALOS_SKIP_SEED === "1") {
    console.log("→ SOCIALOS_SKIP_SEED=1 — leaving the database empty.");
    return;
  }

  const db = new PrismaClient();
  try {
    // The guard. An organization existing means this database has been seeded
    // (or genuinely used), and the destructive seed must not touch it.
    const organizations = await db.organization.count();

    if (organizations > 0) {
      console.log(
        `→ Database already has ${organizations} organization${organizations === 1 ? "" : "s"} — skipping the demo seed so existing content is left alone.`
      );
      return;
    }

    console.log("→ Empty database — seeding the demo organization…");
  } finally {
    await db.$disconnect();
  }

  run("npx", ["prisma", "db", "seed"]);
}

main().catch((error) => {
  console.error("\n✗ Database preparation failed.\n");
  console.error(error instanceof Error ? error.message : error);
  console.error(
    "\nThe deploy has been stopped rather than shipping code against a database that may not match it. Check DATABASE_URL and DIRECT_URL in Project Settings → Environment Variables, then redeploy.\n"
  );
  process.exit(1);
});
