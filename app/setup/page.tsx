import { redirect } from "next/navigation";
import type { Metadata } from "next";

import { Logo } from "@/components/shell/logo";
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
    title: "Set up the database",
    code: 'DATABASE_URL="\u2026" DIRECT_URL="\u2026" npm run setup',
    detail:
      "Run this once from your machine against the Supabase database. Deploys do not migrate automatically.",
  },
  {
    title: "Redeploy, then sign up",
    code: "Deployments \u2192 \u22ef \u2192 Redeploy",
    detail:
      "Environment variables are read at build and boot. Then create an account with any email \u2014 you'll land in the demo organization with data already in it.",
  },
];

const REQUIRED_VARS = [
  "DATABASE_URL",
  "DIRECT_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
] as const;

/**
 * Shown when the app has no Supabase configuration. Without this, a cold clone
 * — or a first deploy — gets an opaque SDK crash instead of instructions.
 */
export default function SetupPage() {
  if (isSupabaseConfigured()) redirect("/dashboard");

  const deployed = Boolean(process.env.VERCEL);
  const steps = deployed ? DEPLOYED_STEPS : LOCAL_STEPS;
  const missing = REQUIRED_VARS.filter((name) => !process.env[name]);

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
                  This deployment built successfully, but it has no database or
                  Supabase project yet, so it can&rsquo;t sign anyone in. Four
                  steps:
                </>
              ) : (
                <>
                  SocialOS needs a Postgres database and a Supabase project
                  before it can sign anyone in. Four steps:
                </>
              )}
            </p>
          </div>

          {missing.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface px-4 py-3">
              <span className="font-mono text-[10px] uppercase tracking-wider text-muted">
                Not set
              </span>
              {missing.map((name) => (
                <code
                  key={name}
                  className="rounded-sm border border-warning/30 bg-warning/10 px-1.5 py-0.5 font-mono text-[11px] text-warning"
                >
                  {name}
                </code>
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
