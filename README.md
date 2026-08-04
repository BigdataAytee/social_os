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

The build itself doesn't need any of them — `postinstall` runs `prisma generate`,
which reads the schema, not the database, and every authenticated route is
dynamic so nothing is prerendered against live data. A deploy with no env vars
builds fine and serves `/setup`. Migrations are not run automatically; apply them
once from your machine with `npm run setup` pointed at the Supabase database,
then redeploy and sign up.

## Scripts

| Command | Does |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run build` | Production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run setup` | Migrations + demo data, in one command |
| `npm run db:migrate` | `prisma migrate dev` |
| `npm run db:seed` | Re-seed the demo org |
| `npm run db:reset` | Drop, re-migrate and re-seed |
| `npm run db:studio` | Prisma Studio |

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
