import { redirect } from "next/navigation";
import type { Metadata } from "next";

import { Logo } from "@/components/shell/logo";
import { isSupabaseConfigured } from "@/lib/supabase/env";

export const metadata: Metadata = { title: "Setup · SocialOS" };

const STEPS = [
  {
    title: "Copy the env template",
    code: "cp .env.example .env",
    detail: "Everything the app needs is listed there — see ARCHITECTURE.md §11.",
  },
  {
    title: "Point it at Postgres",
    code: 'DATABASE_URL="postgresql://…"\nDIRECT_URL="postgresql://…"',
    detail:
      "On Supabase these are the pooled and direct connection strings. Locally, set both to the same value.",
  },
  {
    title: "Add your Supabase Auth keys",
    code: 'NEXT_PUBLIC_SUPABASE_URL="https://…supabase.co"\nNEXT_PUBLIC_SUPABASE_ANON_KEY="…"\nSUPABASE_SERVICE_ROLE_KEY="…"',
    detail:
      "Project Settings → API. The service role key is optional but lets the seed create demo logins for each role.",
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
 * Shown when Supabase env vars are missing. Without this, a cold clone gets an
 * opaque SDK crash instead of instructions.
 */
export default function SetupPage() {
  if (isSupabaseConfigured()) redirect("/dashboard");

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
              SocialOS needs a Postgres database and a Supabase project before it
              can sign anyone in. Five steps:
            </p>
          </div>
        </div>

        <ol className="flex flex-col gap-5">
          {STEPS.map((step, i) => (
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
      </div>
    </div>
  );
}
