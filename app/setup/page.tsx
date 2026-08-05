import { redirect } from "next/navigation";
import type { Metadata } from "next";

import { Logo } from "@/components/shell/logo";
import {
  DATABASE_STATUS_MESSAGE,
  getDatabaseHealth,
  type DatabaseHealth,
} from "@/lib/db-health";
import { isSupabaseConfigured } from "@/lib/supabase/env";

export const metadata: Metadata = { title: "Setup · SocialOS" };

/** Read at request time — this page must never be baked into a build. */
export const dynamic = "force-dynamic";

type Step = { title: string; code: string; detail: string };

/** Running locally: the app reads .env from disk. */
const LOCAL_STEPS: Step[] = [
  {
    title: "Create a Supabase project",
    code: "supabase.com/dashboard \u2192 New project",
    detail:
      "One signup covers both things this app needs: the Postgres database and the auth keys.",
  },
  {
    title: "Fill in .env",
    code: 'cp .env.example .env',
    detail:
      "Paste in DATABASE_URL and DIRECT_URL (Project Settings \u2192 Database) and NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (Project Settings \u2192 API). Four values.",
  },
  {
    title: "Set up the database",
    code: "npm run setup",
    detail:
      "Applies the migrations and loads the demo organization \u2014 90 days of analytics, 29 posts, campaigns, ideas and a brand voice.",
  },
  {
    title: "Start the app and sign up",
    code: "npm run dev",
    detail:
      "Create an account with any email. You'll land straight in the demo organization with data already in it.",
  },
];

/**
 * Running on Vercel: there is no .env to copy and no dev server to restart, and
 * `migrate dev` is the wrong command against a hosted database.
 */
const DEPLOYED_STEPS: Step[] = [
  {
    title: "Create a Supabase project",
    code: "supabase.com/dashboard \u2192 New project",
    detail:
      "One signup covers both things this app needs: the Postgres database and the auth keys.",
  },
  {
    title: "Add four variables in Vercel",
    code: "Project Settings \u2192 Environment Variables",
    detail:
      "DATABASE_URL and DIRECT_URL (Project Settings \u2192 Database), NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (Project Settings \u2192 API).",
  },
  {
    title: "Redeploy",
    code: "Deployments \u2192 \u22ef \u2192 Redeploy",
    detail:
      "Environment variables are read at build and at boot, so a deployment that was built without them keeps behaving as if they're missing until it is replaced.",
  },
  {
    title: "Sign up",
    code: "/signup",
    detail:
      "The redeploy applies the migrations and, into an empty database, loads the demo organization. Then create an account with any email \u2014 you'll land in it with data already there.",
  },
];

const REQUIRED_VARS = [
  "DATABASE_URL",
  "DIRECT_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
] as const;

/** Ignore case, underscores and hyphens — DATABASE-url and databaseUrl both hit. */
function normalizeName(name: string) {
  return name.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * Variables whose name is *nearly* one we expect.
 *
 * "It's set but the app says it isn't" almost always means the name is wrong —
 * a typo, a stray space, the wrong case — and the Vercel dashboard masks values
 * but shows names in a list too long to proofread. Naming the near-miss turns
 * that into a one-line fix. Names only; a value is never read here.
 */
function nearMisses(): { found: string; expected: string }[] {
  const expected = new Map(REQUIRED_VARS.map((n) => [normalizeName(n), n]));
  const out: { found: string; expected: string }[] = [];

  for (const found of Object.keys(process.env)) {
    if ((REQUIRED_VARS as readonly string[]).includes(found)) continue;
    const match = expected.get(normalizeName(found));
    if (match) out.push({ found, expected: match });
  }
  return out;
}

/** Which deployment is answering, so a stale one is obvious at a glance. */
function deploymentFacts(): { label: string; value: string }[] {
  const facts: [string, string | undefined][] = [
    ["Environment", process.env.VERCEL_ENV],
    ["Branch", process.env.VERCEL_GIT_COMMIT_REF],
    ["Commit", process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7)],
    ["Host", process.env.VERCEL_URL],
  ];
  return facts
    .filter((f): f is [string, string] => Boolean(f[1]))
    .map(([label, value]) => ({ label, value }));
}

/**
 * Shown when the app can't run yet — no Supabase configuration, or a database
 * that is missing, unreachable, or un-migrated. Without this a cold clone, or a
 * deploy whose migrations didn't run, gets an opaque crash instead of a
 * statement of what's wrong.
 */
export default async function SetupPage() {
  const supabaseReady = isSupabaseConfigured();
  const database = await getDatabaseHealth();

  // Only leave once both halves actually work. Redirecting on Supabase config
  // alone would bounce straight back here from requireSession when the database
  // is the broken half — a loop.
  if (supabaseReady && database.status === "ok") redirect("/dashboard");

  const deployed = Boolean(process.env.VERCEL);
  const steps = deployed ? DEPLOYED_STEPS : LOCAL_STEPS;
  const missing = REQUIRED_VARS.filter((name) => !process.env[name]);
  const misnamed = nearMisses();
  const facts = deploymentFacts();

  return (
    <div className="min-h-screen bg-canvas px-6 py-16">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-10">
        <div className="flex flex-col gap-4">
          <Logo />
          <div className="flex flex-col gap-2">
            <h1 className="font-display text-2xl font-semibold tracking-tight text-primary">
              Almost there
            </h1>
            <p className="text-balance text-secondary">
              {deployed ? (
                <>
                  This deployment built and is running — it just isn&rsquo;t
                  connected to a working database and Supabase project yet, so it
                  can&rsquo;t sign anyone in. Four steps:
                </>
              ) : (
                <>
                  SocialOS needs a Postgres database and a Supabase project
                  before it can sign anyone in. Four steps:
                </>
              )}
            </p>
          </div>

          <DatabaseNotice health={database} deployed={deployed} />

          {/* Every expected variable, present or not. Listing the ones it *can*
              see is what distinguishes "I never saved it" from "I saved it on
              the wrong project, environment, or under the wrong name". */}
          <div className="flex flex-col gap-2 rounded-md border border-border bg-surface px-4 py-3">
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted">
              Environment variables this deployment can see
            </p>
            <ul className="flex flex-col gap-1">
              {REQUIRED_VARS.map((name) => {
                const present = Boolean(process.env[name]);
                return (
                  <li key={name} className="flex items-center gap-2 text-xs">
                    <span
                      aria-hidden
                      className={`font-mono ${present ? "text-success" : "text-warning"}`}
                    >
                      {present ? "✓" : "✗"}
                    </span>
                    <code className="font-mono text-[11px] text-secondary">
                      {name}
                    </code>
                    <span className="text-muted">
                      {present ? "set" : "not set"}
                    </span>
                  </li>
                );
              })}
            </ul>

            {missing.length > 0 && (
              <p className="text-xs text-muted">
                Values are read at build and at boot. If you added these after
                the current deployment was built, redeploy — editing a variable
                does not rebuild anything on its own.
              </p>
            )}
          </div>

          {misnamed.length > 0 && (
            <div className="flex flex-col gap-1.5 rounded-md border border-warning/30 bg-warning/5 px-4 py-3">
              <p className="font-mono text-[10px] uppercase tracking-wider text-warning">
                Nearly right
              </p>
              {misnamed.map((m) => (
                <p key={m.found} className="text-xs text-secondary">
                  <code className="font-mono text-[11px]">{m.found}</code> is
                  set, but the app reads{" "}
                  <code className="font-mono text-[11px]">{m.expected}</code>.
                  Rename it and redeploy.
                </p>
              ))}
            </div>
          )}

          {facts.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-border bg-surface px-4 py-2.5">
              <span className="font-mono text-[10px] uppercase tracking-wider text-muted">
                Serving
              </span>
              {facts.map((fact) => (
                <span key={fact.label} className="text-xs text-muted">
                  {fact.label}{" "}
                  <code className="font-mono text-[11px] text-secondary">
                    {fact.value}
                  </code>
                </span>
              ))}
            </div>
          )}
        </div>

        <ol className="flex flex-col gap-5">
          {steps.map((step, i) => (
            <li
              key={step.title}
              className="flex gap-4 rounded-lg border border-border bg-surface p-5"
            >
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-accent/40 bg-accent/10 font-mono text-xs text-accent">
                {i + 1}
              </span>
              <div className="flex min-w-0 flex-col gap-2">
                <h2 className="font-display text-sm font-medium text-primary">
                  {step.title}
                </h2>
                <pre className="overflow-x-auto rounded-sm border border-border bg-surface-raised px-3 py-2 font-mono text-xs leading-relaxed text-secondary">
                  {step.code}
                </pre>
                <p className="text-sm text-muted">{step.detail}</p>
              </div>
            </li>
          ))}
        </ol>

        <p className="text-xs text-muted">
          {deployed
            ? "This screen disappears once the Supabase variables are set and the deployment is replaced."
            : "This screen disappears once the Supabase variables are set and the dev server is restarted."}
        </p>
      </div>
    </div>
  );
}

/**
 * The specific database failure, stated plainly, with the error the database
 * itself returned. The status word alone ("unreachable") covers a wrong
 * password, a paused project and a malformed URL — three different fixes — so
 * the detail line below is the part that actually ends the guessing.
 */
function DatabaseNotice({
  health,
  deployed,
}: {
  health: DatabaseHealth;
  deployed: boolean;
}) {
  const { status, detail, code, hints } = health;
  if (status === "ok") return null;

  const critical = status !== "unconfigured";
  const target = databaseTarget();

  return (
    <div
      className={`flex flex-col gap-2 rounded-md border px-4 py-3 ${
        critical
          ? "border-danger/30 bg-danger/5"
          : "border-warning/30 bg-warning/5"
      }`}
    >
      <p
        className={`font-mono text-[10px] uppercase tracking-wider ${
          critical ? "text-danger" : "text-warning"
        }`}
      >
        Database &mdash; {status.replace("-", " ")}
        {code ? ` · ${code}` : ""}
      </p>
      <p className="text-sm text-secondary">{DATABASE_STATUS_MESSAGE[status]}</p>

      {detail && (
        <p className="overflow-x-auto rounded-sm border border-border bg-surface-raised px-3 py-2 font-mono text-[11px] leading-relaxed text-secondary">
          {detail}
        </p>
      )}

      {hints.length > 0 && (
        <ul className="flex list-disc flex-col gap-1 pl-4 text-xs text-muted">
          {hints.map((hint) => (
            <li key={hint}>{hint}</li>
          ))}
        </ul>
      )}

      {/* Confirms which database this deployment is actually pointed at, which
          is the fastest way to notice the variable was set on another project
          or in another environment. Host and port only — never credentials. */}
      {target && (
        <p className="text-xs text-muted">
          Pointing at{" "}
          <code className="font-mono text-[11px] text-secondary">{target}</code>
        </p>
      )}

      {health.pendingMigrations && health.pendingMigrations.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="font-mono text-[10px] uppercase tracking-wider text-muted">
            Not applied
          </p>
          <ul className="flex flex-col gap-0.5">
            {health.pendingMigrations.map((name) => (
              <li
                key={name}
                className="font-mono text-[11px] text-secondary"
              >
                {name}
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted">
            A production deploy applies these automatically. Preview deployments
            never do — they share production&rsquo;s environment variables, so
            migrating from one would alter the production database. If this is a
            preview, use the production URL or merge the branch.
          </p>
        </div>
      )}

      {status === "not-migrated" && deployed && (
        <p className="text-xs text-muted">
          Check the last build log for a line beginning{" "}
          <code className="font-mono text-[11px] text-secondary">
            ⚠ Migrations did not run
          </code>{" "}
          &mdash; it carries the error the database returned.
        </p>
      )}
    </div>
  );
}

/** Host and port of DATABASE_URL, or null if it isn't set or isn't parseable. */
function databaseTarget(): string | null {
  const value = process.env.DATABASE_URL?.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    return `${url.hostname}:${url.port || "5432"}`;
  } catch {
    return null;
  }
}
