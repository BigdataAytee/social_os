# SocialOS

SocialOS is an AI operating system for social media managers. Instead of five separate tools, get one app with dedicated Studios for X, TikTok, Instagram, Facebook, and YouTube — unified by an AI assistant, shared calendar, and a brand voice that keeps every post consistent.

**Status:** Phase 0 (Foundation) complete. See [`PROGRESS.md`](./PROGRESS.md) for the
phase checklist and [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the standing spec —
read the latter in full before contributing.

## Getting started

Requires Node 20+, a Postgres database, and a Supabase project (for Auth).

```bash
cp .env.example .env      # then fill in DATABASE_URL, DIRECT_URL and the Supabase keys
npm install
npx prisma migrate dev    # creates the schema
npx prisma db seed        # creates the demo organization
npm run dev
```

Open http://localhost:3000. Without Supabase credentials the app redirects to
`/setup`, which lists exactly what's missing.

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

## Scripts

| Command | Does |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run build` | Production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
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
