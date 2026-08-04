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
    title: "Copy the env template",
    code: "cp .env.example .env",
    detail: "Everything the app needs is listed there — see ARCHITECTURE.md §11.",
  },
  {
    title: "Point it at Postgres",
    code: 'DATABASE_URL="postgresql://…"\nDIRECT_URL="postgresql://…"',
    detail:
      "On Supabase these are the pooled and direct connection strings. For a local Postgres, set both to the same value.",
  },
  {
    title: "Add your Supabase Auth keys",
    code: 'NEXT_PUBLIC_SUPABASE_URL="https://…supabase.co"\nNEXT_PUBLIC_SUPABASE_ANON_KEY="…"\nSUPABASE_SERVICE_ROLE_KEY="…"',
    detail:
      "Supabase → Project Settings → API. The service role key is optional but lets the seed create demo logins for each role.",
  },
  {
    title: "Migrate and seed",
    code: "npx prisma migrate dev\nnpx prisma db seed",
    detail: "Creates the schema and a fully populated demo organization.",
  },
  {
    title: "Restart the dev server",
    code: "npm run dev",
    detail: "Next.js reads .env at boot, so a restart is required.",
  },
];

/**
 * Running on Vercel: there is no .env to copy and no dev server to restart, and
 * `migrate dev` is the wrong command against a hosted database.
 */
const DEPLOYED_STEPS: Step[] = [
  {
    title: "Create a Supabase project",
    code: "supabase.com/dashboard → New project",
    detail:
      "You need two things from it: the API keys (Project Settings → API) and both connection strings (Project Settings → Database).",
  },
  {
    title: "Add the environment variables in Vercel",
    code: "Project Settings → Environment Variables",
    detail:
      "DATABASE_URL (pooled, port 6543), DIRECT_URL (direct, port 5432), NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, and optionally SUPABASE_SERVICE_ROLE_KEY.",
  },
  {
    title: "Apply the migrations",
    code: 'DIRECT_URL="postgresql://…" npx prisma migrate deploy',
    detail:
      "Run this from your machine against the Supabase database. Deploys do not migrate automatically — `migrate deploy` applies existing migrations without trying to author new ones.",
  },
  {
    title: "Seed the demo organization (optional)",
    code: "npx prisma db seed",
    detail:
      "With SUPABASE_SERVICE_ROLE_KEY set, this also creates a demo login for each of the four roles. Skip it if you'd rather sign up fresh.",
  },
  {
    title: "Redeploy",
    code: "Deployments → ⋯ → Redeploy",
    detail:
      "Environment variables are read at build and boot, so the running deployment won't pick them up until it is replaced.",
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
                  Supabase project yet, so it can&rsquo;t sign anyone in. Five
                  steps:
                </>
              ) : (
                <>
                  SocialOS needs a Postgres database and a Supabase project
                  before it can sign anyone in. Five steps:
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
