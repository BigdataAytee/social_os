# SocialOS

SocialOS is an AI operating system for social media managers. Instead of five separate tools, get one app with dedicated Studios for X, TikTok, Instagram, Facebook, and YouTube — unified by an AI assistant, shared calendar, and a brand voice that keeps every post consistent.

**Status:** Phases 0–8 built. Five Studios, a unified calendar with drag-to-reschedule,
an AI assistant with tool-calling into the service layer, asset library, brand voice,
team roles and cross-platform analytics — all reading and writing real rows. See
[`PROGRESS.md`](./PROGRESS.md) for per-phase status including what is wired but not yet
demonstrable, and [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the standing spec — read
the latter in full before contributing.

### Two things need credentials

The app runs and is fully navigable without them, but:

| Missing | Effect |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_*` | No sign-in. The app redirects to `/setup`, which lists what to fill in. |
| `ANTHROPIC_API_KEY` | AI features fall back to a deterministic offline writer, clearly labelled "Local draft" in the UI. Generation, saving, history and brand-voice plumbing all still work; **assistant tool-calling does not**, since the fallback has no tool protocol. |

## Getting started

Requires Node 20+, a Postgres database, and a Supabase project (for Auth).

```bash
cp .env.example .env      # fill in 4 values: DATABASE_URL, DIRECT_URL, and the 2 Supabase keys
npm install
npm run setup             # migrations + demo data
npm run dev
```

Open http://localhost:3000 and **sign up with any email**. Because `.env.example`
sets `SOCIALOS_JOIN_ORG_SLUG="northwind"`, you land straight in the seeded demo
organization with 90 days of analytics and 29 posts already in it.

A Supabase project gives you both things the app needs — the Postgres database
and the auth keys — so it's one signup, not two. Without those credentials the
app redirects to `/setup`, which lists exactly what's missing.

Clear `SOCIALOS_JOIN_ORG_SLUG` and each new sign-up instead gets their own empty
workspace, owned by them, with a starter brand voice. That's the real onboarding
path; the join setting exists to make the demo immediate.

### Demo logins

`prisma/seed.ts` seeds one organization ("Northwind Studio") with users across all
four roles. If `SUPABASE_SERVICE_ROLE_KEY` is set, it also creates matching
Supabase auth users so you can sign in as each:

| Role | Email |
| --- | --- |
| `OWNER` | maya@northwind.studio |
| `ADMIN` | devin@northwind.studio |
| `EDITOR` | rosa@northwind.studio |
| `EDITOR` | sam@northwind.studio |
| `VIEWER` | nina@northwind.studio |

Password comes from `SEED_DEMO_PASSWORD` (default `socialos-demo-1234`).

The seed is idempotent and deterministic — re-running rebuilds the demo org with
the same numbers rather than duplicating it.

## Deploying to Vercel

`vercel.json` pins the framework preset to `nextjs`. This matters: if a Vercel
project was created against this repo *before* the app existed, framework
detection found nothing, defaulted to the "Other" preset, and the deploy fails
with `No Output Directory named "public" found`. The pin overrides that. If a
deploy still fails that way, also set **Project Settings → Build & Development
Settings → Framework Preset → Next.js**.

Set these in **Project Settings → Environment Variables** before deploying:

| Var | Notes |
| --- | --- |
| `DATABASE_URL` | Supabase **pooled** connection string (port 6543) |
| `DIRECT_URL` | Supabase **direct** connection string (port 5432) |
| `NEXT_PUBLIC_SUPABASE_URL` | |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | |
| `SOCIALOS_JOIN_ORG_SLUG` | Set to `northwind` so sign-ups land in the seeded demo org. Clear it for real onboarding. |
| `SUPABASE_SERVICE_ROLE_KEY` | Optional — only to create the five demo logins |

### The database sets itself up on deploy

`vercel-build` runs `scripts/prepare-database.ts` before `next build`, so a
production deploy applies migrations and — the first time only — loads the demo
data. You don't run anything by hand.

Three guards make that safe to leave on:

| Situation | What happens |
| --- | --- |
| Preview deployment | **Skipped.** Vercel gives previews the same env vars as production, so migrating from a preview build would hit the production database. Override with `SOCIALOS_DB_SETUP_ON_PREVIEW=1` only if a preview has its own database. |
| `DATABASE_URL` not set | Skipped, build succeeds, app serves `/setup`. |
| Database already has an organization | Migrations still apply; **the seed is skipped.** `prisma/seed.ts` deletes and rebuilds the demo org, so re-running it on a redeploy would erase anything published since. |
| Database unreachable, or a migration fails | **Build still succeeds.** The problem is reported in the build log, and the running app sends you to `/setup`, which names the specific failure. A failed deploy just yields a Vercel 404 with nothing to act on. |

Set `SOCIALOS_SKIP_SEED=1` to migrate without ever loading demo data.

The app never renders pages against a database it can't use: `lib/db-health.ts`
checks the connection on each authenticated request and redirects to `/setup`
when the database is missing, unreachable, or un-migrated — so a bad
`DIRECT_URL` shows you which of those it is instead of a 500.

`/setup` shows the error the database actually returned (password redacted),
the host and port it tried, and anything wrong it can see in the connection
strings without connecting — surrounding quotes pasted into Vercel, an
unencoded `@` in the password, `DIRECT_URL` on the pooled port 6543, a pooled
`DATABASE_URL` missing `?pgbouncer=true`. "Unreachable" otherwise covers a
wrong password, a paused Supabase project and a malformed URL with one word.

`npm run build` deliberately stays database-free, so local builds and CI need no
credentials. Only `vercel-build` touches the database.

The build needs no environment variables to succeed — `postinstall` runs
`prisma generate`, which reads the schema rather than the database, and every
authenticated route is dynamic so nothing is prerendered against live data.

### Setting the database up by hand instead

If you'd rather not have deploys touch the database, set `SOCIALOS_SKIP_SEED=1`
(or just run this before the first deploy):

```bash
DATABASE_URL="postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres" \
DIRECT_URL="postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres" \
npm run setup
```

Both point at the **direct** connection (port 5432) for this one-off. The pooled
connection on 6543 is transaction-mode pgbouncer, which is right for the running
app but an unnecessary hazard for migrations and a write-heavy seed. In Vercel,
`DATABASE_URL` should still be the pooled 6543 string.

## Scripts

| Command | Does |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run build` | Production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run setup` | Migrations + demo data, in one command (manual path) |
| `npm run vercel-build` | What Vercel runs: prepare the database, then build |
| `npm run db:migrate` | `prisma migrate dev` |
| `npm run db:seed` | Re-seed the demo org |
| `npm run db:reset` | Drop, re-migrate and re-seed |
| `npm run db:studio` | Prisma Studio |
| `npm run smoke` | Service-layer suite against a seeded throwaway database |
| `npm run smoke:oauth` | Connect flow, token refresh, sync and insights against a fake platform |

## Layout

```
app/(auth)      login / signup
app/(app)       authenticated shell — sidebar, topbar, AI panel
app/setup       shown when Supabase env vars are missing
components/ui   shadcn/ui primitives (new-york)
components/shell  sidebar, topbar, Studio Switcher, AI panel
lib/studios.ts  the Studio registry — single source of truth for the five Studios
lib/auth        session, role permissions
prisma/         schema, migrations, seed
styles/tokens.css  design tokens (ARCHITECTURE.md §7)
```

Design tokens live in `styles/tokens.css` and are exposed through
`tailwind.config.ts` as `bg-canvas`, `bg-surface`, `text-primary`,
`text-secondary`, `text-accent` and the per-Studio accents (`bg-studio-tiktok`,
`text-studio-youtube`, …). No component hardcodes a color.

## Connecting real accounts

Each Studio has an **Account** row at the top. Connect there and SocialOS pulls
that account's recent posts and their engagement, then the **Ideas** tab can
analyse them: which formats, posting slots, lengths and topics actually
outperform, with the ideas written from those patterns rather than from a blank
page. The assistant gets the same capability as a `generateIdeasFromAccount`
tool, so "what should I post on TikTok?" works in chat too.

Two things must be configured before any platform can be connected:

```bash
# 1. A key to encrypt stored tokens with (AES-256-GCM).
openssl rand -base64 32   # → SOCIALOS_ENCRYPTION_KEY

# 2. An OAuth app per platform, with this callback URL registered:
#    <SOCIALOS_PUBLIC_URL>/api/oauth/<x|tiktok|instagram|facebook|youtube>/callback
```

| Platform | Variables | Console |
| --- | --- | --- |
| X | `X_CLIENT_ID` / `X_CLIENT_SECRET` | developer.x.com |
| TikTok | `TIKTOK_CLIENT_KEY` / `TIKTOK_CLIENT_SECRET` | developers.tiktok.com |
| YouTube | `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | console.cloud.google.com |
| Instagram + Facebook | `META_CLIENT_ID` / `META_CLIENT_SECRET` | developers.facebook.com |

A platform with no credentials keeps the mock adapter — its Studio works
normally and simply reports "not connected", naming the variables it needs.
Instagram and Facebook share one Meta app; Instagram needs a Business account
linked to a Facebook Page, because that's the only way its insights are exposed.

Scopes are **read-only**. This pulls data; it does not post. Publishing still
goes through the mock adapter, unchanged.

Tokens are encrypted at rest in `platform_credentials` and never leave the
service layer — `withAccessToken()` hands one to a callback and never returns
it. Disconnecting deletes the credential and keeps the pulled history.

## Checking the app

`scripts/smoke.ts` drives the service layer against a real seeded database —
every read the pages make, the approval gate, the publish and reschedule rules,
and cross-org isolation. The pages are thin, so a bug that would break a page
breaks this first, without needing Supabase Auth or a browser.

```bash
createdb socialos
export DATABASE_URL="postgresql://postgres@127.0.0.1:5432/socialos"
export DIRECT_URL="$DATABASE_URL"
npx prisma migrate deploy && npx tsx prisma/seed.ts
npm run smoke
```

It writes — creating, rescheduling, publishing and deleting posts — so point it
at a throwaway database, never one whose contents matter.

`npm run smoke:oauth` covers the connected-account feature the same way, against
a fake platform server (`scripts/fake-platform.ts`) that stands in for X's OAuth
and API endpoints. It is deliberately strict — it rejects a mismatched PKCE
verifier, a reused code, a mismatched redirect URI and a missing Basic auth
header — so the flow is exercised rather than merely executed. No developer app
or network access needed:

```bash
npm run smoke:oauth
```
