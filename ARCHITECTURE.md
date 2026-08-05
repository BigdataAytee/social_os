# SocialOS — Architecture

> **Standing spec.** Every Claude Code session on this repo reads this file in full
> before touching anything, then reads `PROGRESS.md` for the phase checklist.
> Section numbers are stable — other files (`prisma/schema.prisma`, `PROGRESS.md`,
> code comments) reference them by number. Don't renumber.

> **Provenance note (§7 especially).** This document was reconstructed during the
> Phase 0 session from `prisma/schema.prisma`, `PROGRESS.md`, and the Phase 0 brief,
> which referenced §4, §5, §7, §9, §10, §12 and §13 but was delivered without the
> file itself. The **design anchors in §7 are therefore a considered reconstruction,
> not the original table.** If the original exists, replace §7's color table and type
> pairing wholesale — they are isolated in `styles/tokens.css` and `tailwind.config.ts`
> precisely so that swap is a two-file change and nothing downstream has to move.

---

## §1 — What this is

SocialOS is an AI operating system for social media managers. Instead of five
separate tools, one app with dedicated **Studios** for X, TikTok, Instagram,
Facebook and YouTube — unified by an AI assistant, a shared content calendar,
and a brand voice profile that keeps every post consistent.

The product thesis is *consolidation*: the value is not any single Studio, it is
that all five sit on one data model, one calendar, one asset library, one voice.
Anything that fragments that (per-Studio data silos, per-Studio auth, a separate
"AI mode" path that doesn't touch the real service layer) is working against the
product and should be treated as a bug.

## §2 — Principles

1. **One data model, five surfaces.** Studios are presentation over shared tables.
   A post is a `Post` with a `platform`, not a `TweetPost` and a `ReelPost`.
2. **Mock-first integrations.** No real platform OAuth in v1. Every adapter is
   swappable behind one interface (§10) and the UI never branches on mock vs real.
3. **The AI path is the real path.** AI features call the same service layer the
   forms call. There is no shadow write path. (§9)
4. **Server-first.** React Server Components fetch and render. Client components
   exist for interaction, not data loading.
5. **Org-scoped by construction.** `orgId` is derived from the session in the
   service layer, never accepted from a client. (§5)
6. **Real routes early, real data early.** Placeholder pages are routed and
   navigable from Phase 0 so later phases fill in rather than scaffold. Nothing
   ships against hardcoded arrays once the seed exists.

### Non-goals for v1
Real platform publishing, billing, multi-org switching UI, mobile apps,
realtime collaboration, i18n.

## §3 — Stack

| Layer | Choice |
| --- | --- |
| Framework | Next.js 14, App Router, React Server Components |
| Language | TypeScript, `strict: true` |
| Styling | Tailwind CSS v3 + CSS custom properties (§7) |
| Components | shadcn/ui (new-york style) over Radix primitives |
| Database | Postgres (Supabase-hosted in deployment) |
| ORM | Prisma 5 |
| Auth | Supabase Auth (email/password in v1) via `@supabase/ssr` |
| Storage | Supabase Storage (Phase 6) |
| Server state | React Query (from Phase 1 — needed for optimistic calendar drags, §Phase 5) |
| Icons | lucide-react |
| Dates | date-fns |

## §4 — Data model

The authoritative definition is `prisma/schema.prisma`. Notes that the schema
itself can't express:

- **Every business table carries `orgId`** and is always queried scoped to the
  authenticated user's organization.
- **`User.id` is the Supabase `auth.uid()`**, not a generated cuid. The `users`
  table is a profile mirror of the auth user; a row is created on first
  authenticated request if absent (see `lib/auth/sync-user.ts`).
- **`Post.platformData` is a per-platform JSON payload** — thread arrays for X,
  slide lists for Instagram carousels, script beats and thumbnail ideas for
  YouTube. Shapes live in `lib/validators/platform-data.ts` as Zod schemas keyed
  by `Platform`; the column is deliberately `Json` so a new Studio doesn't need
  a migration.
- **`AIGeneration.type` is a string, not an enum**, on purpose: AI feature types
  churn every phase (`tweet`, `thread`, `hook`, `reply`, `caption`, `script`,
  `title`, `repurpose`, …) and an enum would mean a migration per feature.
  It is validated at the edge against `lib/validators/ai.ts`.
- **`Task.entityType`/`entityId` and `Comment.entityType`/`entityId` are a
  lightweight polymorphic link**, enforced at the app layer, not by FK.
  `Comment.postId` is a real FK because comments-on-posts is the common case
  (approvals) and deserves cascade + index.
- **`BrandVoice` shares a primary key with `Organization`** — strictly 1:1.
- **`AnalyticsSnapshot` is one row per account per day.** Every chart in the app
  reads from it; no chart may hardcode numbers.

## §5 — Tenancy, roles and permissions

Four roles on `Membership`:

| Role | Can |
| --- | --- |
| `OWNER` | Everything, including org settings, billing, deleting the org |
| `ADMIN` | Everything except destroying the org; manages members and integrations |
| `EDITOR` | Create/edit posts and ideas, use AI, upload assets; **cannot** publish or approve, cannot change org settings |
| `VIEWER` | Read-only across the app; can comment |

Rules:

- The session's org is resolved server-side from the user's `Membership`
  (`lib/auth/session.ts` → `requireSession()` returns `{ user, orgId, role }`).
- Permission checks live in `lib/auth/permissions.ts` as
  `can(role, action)` and are enforced **in the service layer**, not in the UI.
  UI hiding is a courtesy, never the control.
- Approval gate: a post moves `DRAFT → NEEDS_APPROVAL` by an `EDITOR`, and only
  `ADMIN`/`OWNER` may move it onward to `SCHEDULED`.

## §6 — Application structure

```
app/
  (auth)/login, /signup            unauthenticated
  (app)/                           authenticated shell — sidebar + topbar + AI panel
    dashboard
    studio/x | tiktok | instagram | facebook | youtube
    calendar
    assets
    assistant
    analytics
    team
    settings
  api/ai/chat                      AI orchestrator entry (§9)
components/
  ui/                              shadcn primitives — generated, don't hand-edit
  shell/                           sidebar, topbar, studio switcher, AI panel
  studio/                          StudioShell and shared Studio furniture
lib/
  auth/                            session, permissions, user sync
  supabase/                        client / server / middleware factories
  db.ts                            Prisma singleton
  studios.ts                       the Studio registry — single source of truth
modules/
  <domain>/service.ts              all DB writes go through here
  integrations/                    platform adapters (§10)
prisma/
  schema.prisma, seed.ts, migrations/
styles/
  tokens.css                       §7 design tokens
```

**The service layer rule:** route handlers, server actions and AI tools all call
`modules/*/service.ts`. Nothing else touches Prisma directly. This is what makes
§2.3 true.

**The Studio registry:** `lib/studios.ts` maps each `Platform` to its slug, label,
icon, accent token and feature list. Sidebar, switcher, route params and per-Studio
theming all read from it. Adding a Studio is a registry entry plus a route folder.

## §7 — Design system

The brief's explicit steer was to avoid generic AI-SaaS defaults — the
indigo-violet gradient on white, Inter for everything, a purple "AI sparkle".
The anchors below are chosen against that.

**Direction:** dark-first *instrument panel*. Warm near-black substrate, warm
off-white type, a single gold signal color that belongs to SocialOS itself, and
five Studio accents that are the only other saturated color in the product.
Color means "this is a Studio" or "this needs you" — never decoration.

### Color table

Base — dark (default):

| Token | Value | Use |
| --- | --- | --- |
| `--canvas` | `#0E0F11` | app background |
| `--surface` | `#16181B` | cards, sidebar, panels |
| `--surface-raised` | `#1E2126` | popovers, hover, inputs |
| `--border` | `#2A2E35` | hairlines, dividers |
| `--border-strong` | `#3A3F48` | focused/active edges |
| `--text-primary` | `#F0EEE9` | headings, body (warm, not pure white) |
| `--text-secondary` | `#9BA1A9` | labels, meta |
| `--text-muted` | `#6E747D` | disabled, timestamps |

Base — light:

| Token | Value |
| --- | --- |
| `--canvas` | `#FBFAF8` |
| `--surface` | `#FFFFFF` |
| `--surface-raised` | `#F4F2EE` |
| `--border` | `#E5E1DA` |
| `--border-strong` | `#CFC9BF` |
| `--text-primary` | `#1A1B1E` |
| `--text-secondary` | `#5F646B` |
| `--text-muted` | `#8A9098` |

Signal + status (same both themes unless noted):

| Token | Value | Use |
| --- | --- | --- |
| `--accent` | `#E3B341` | SocialOS's own accent — primary actions, AI affordances |
| `--accent-contrast` | `#1A1508` | text on `--accent` |
| `--success` | `#3FB950` | published, connected |
| `--warning` | `#D29922` | needs approval |
| `--danger` | `#F04B4B` | failed, destructive |

Studio accents — mid-luminance so they hold on both themes:

| Studio | Token | Value |
| --- | --- | --- |
| X | `--studio-x` | `#7D8590` (graphite — X's identity is monochrome; honest, and distinct from the other four) |
| TikTok | `--studio-tiktok` | `#17C8B8` |
| Instagram | `--studio-instagram` | `#D9558E` |
| Facebook | `--studio-facebook` | `#4A82E8` |
| YouTube | `--studio-youtube` | `#E24A32` |

Gold is deliberately not any platform's color, so "SocialOS is speaking" and
"you are in a Studio" never read the same.

### Type pairing

| Role | Family | Notes |
| --- | --- | --- |
| Display | **Space Grotesk** | page titles, Studio names, big numbers. Slight mechanical quirk — this is the character. |
| UI / body | **IBM Plex Sans** | all interface text. Warmer and more editorial than Inter. |
| Data / metrics | **IBM Plex Mono** | every metric, count, date and handle. Tabular numerals, so columns don't jitter. |

The pairing rule that carries the identity: **all numbers are mono, always.**
Follower counts, engagement, dates, character counters, queue positions.

### Scale, radius, motion

- Radius: `sm 6px`, `md 10px`, `lg 14px`, `xl 20px`. Cards `lg`, controls `md`.
- Spacing: Tailwind default 4px scale.
- Motion tokens: `--motion-fast 120ms`, `--motion-base 200ms`, `--motion-slow 320ms`;
  easing `--ease-standard cubic-bezier(0.2, 0, 0, 1)`,
  `--ease-emphasized cubic-bezier(0.3, 0, 0, 1)`.
  Everything animated respects `prefers-reduced-motion` (Phase 8 audits this).

### Signature element

**The Studio Switcher** at the top of the sidebar. It is the thing that makes
this feel like an OS rather than a dashboard: switching Studio re-themes the
accent across the whole shell (`--studio-accent` is set on the shell container,
and per-Studio chrome reads it), so you always know which surface you're on
without reading a label.

## §8 — Shared components

`components/ui/*` are shadcn/ui primitives — treat as generated; regenerate
rather than hand-edit. Cross-Studio furniture lives in `components/studio/` and
must be built once and reused by all five (Phase 2 builds these for real, Phase 3
consumes them unchanged):

`StudioShell`, `AIGenerateBox`, `ContentQueue`, `SchedulePicker`,
`AnalyticsChart`, `CompetitorTable`, `IdeaList`, `TemplatePicker`.

If Phase 3 finds itself forking one of these per platform, that's a signal the
component's props are wrong, not that the platform is special.

## §9 — AI orchestration

Single entry point: `POST /api/ai/chat`, backed by `modules/ai/orchestrator.ts`.

- One provider adapter (`modules/ai/provider.ts`) so the model is swappable.
- Every request assembles context: brand voice (§4), the active Studio, the
  target platform's constraints, and any explicitly attached entities.
- **Tool calling** maps to the service layer, never to Prisma:
  `createPost`, `scheduleContent`, `repurposeContent`, `listIdeas`, `saveIdea`,
  `generateIdeasFromAccount`.
- Every generation is persisted as an `AIGeneration` row (org, user, studio,
  type, input, output) — this is both the audit trail and the source for
  "recent generations" surfaces.
- Brand voice is applied in the system prompt, so changing tone in Settings
  visibly changes output with no code change (this is Phase 6's done-condition).
- Studio-specific features (Hook Generator, Script Writer, Title Generator…) are
  *prompt templates plus a `type` string*, not separate endpoints.

## §10 — Platform integrations (mock-first)

`modules/integrations/` exposes one interface per capability:

```ts
interface PlatformAdapter {
  platform: Platform
  publish(post: Post): Promise<PublishResult>
  fetchAnalytics(accountId: string, since: Date): Promise<Snapshot[]>
  fetchTrends(): Promise<Trend[]>
}
```

`MockAdapter` implements all five. `ConnectedAccount.status` defaults to `MOCK`.
The UI reads `status` for display only and must never branch its behaviour on it.
Raw tokens never go in `ConnectedAccount.meta`; that column is display fields only.

### Connected accounts (OAuth 2.0)

`LiveAdapter` reads the real APIs. `getAdapter()` returns it only when the
platform has OAuth client credentials **and** `SOCIALOS_ENCRYPTION_KEY` is set;
otherwise the mock, so an unconfigured platform is fully working rather than
broken. Selection is per call, not a module constant — the environment decides.

- **Tokens** live in `PlatformCredential`, one row per account, AES-256-GCM
  (`lib/crypto.ts`). Nothing outside `oauth/service.ts` sees a decrypted token:
  `withAccessToken(accountId, use)` hands it to a callback and never returns it,
  which is what keeps it out of logs, RSC payloads and error messages. It also
  refreshes ahead of expiry rather than reacting to a 401.
- **CSRF** is a signed `state` (HMAC over org, user, platform, nonce, 10-minute
  TTL) *plus* a nonce echoed in an httpOnly cookie. State alone proves we issued
  it; the cookie proves this browser started it. PKCE S256 for X and TikTok.
- **Connect starts at a route handler**, not a server action, because the
  browser must land on the platform's domain and the PKCE/CSRF cookies have to
  be set on that same redirect: `app/api/oauth/[platform]/{start,callback}`.
- **Scopes are read-only.** `publish` and `fetchTrends` therefore delegate to the
  mock — real publishing needs write scopes and platform review, and none of the
  five expose trends on these tiers.
- **Disconnect deletes the credential, not the account.** Deleting the account
  would cascade away every snapshot and pulled post with it.
- **`fetchPosts`** is the added capability: `AnalyticsSnapshot` says engagement
  rose, but not which post caused it or what format it was. Results land in
  `ExternalPost`, upserted on `(accountId, externalId)` so a re-sync updates
  metrics rather than duplicating rows.

`modules/insights/service.ts` turns those rows into patterns — format, timing,
length and topic performance, plus top posts — measured in **engagement rate**,
not raw engagement, so a growing account doesn't score every recent post highest.
Every bucket needs a minimum sample or it is omitted: a "best time to post" drawn
from two posts is worse than no answer, because it will be believed.
`generateIdeasFromAccount` hands the model that finished report rather than raw
rows, and is exposed to the assistant as a tool like everything else in §9.

## §11 — Auth and environment

Supabase Auth, email/password in v1, via `@supabase/ssr` (cookie-based, so RSCs
and route handlers share the session). `middleware.ts` refreshes the session and
gates `/(app)` routes; unauthenticated hits redirect to `/login`.

On first authenticated request, `syncUser()` upserts the Supabase user into the
`users` table and, if they have no `Membership`, no org is assumed — the app
sends them to onboarding (Phase 8). Seeded demo users already have both.

Environment (`.env.example` is the contract):

| Var | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres, pooled — Prisma client at runtime |
| `DIRECT_URL` | Postgres, direct — Prisma migrations |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | server-only; used by the seed to create demo auth users |
| `ANTHROPIC_API_KEY` | AI orchestrator (Phase 2+) |
| `SOCIALOS_ENCRYPTION_KEY` | server-only; AES-256-GCM key for stored platform tokens |
| `SOCIALOS_PUBLIC_URL` | origin used to build OAuth callback URLs |
| `X_CLIENT_ID` / `X_CLIENT_SECRET` | X OAuth app |
| `TIKTOK_CLIENT_KEY` / `TIKTOK_CLIENT_SECRET` | TikTok OAuth app |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | YouTube OAuth app |
| `META_CLIENT_ID` / `META_CLIENT_SECRET` | Instagram + Facebook share one Meta app |

## §12 — Seed data

`prisma/seed.ts` must produce a demo org that makes every screen look alive.
It is idempotent — re-running resets the demo org rather than duplicating it.

- **1 organization** — "Northwind Studio" (`northwind`).
- **Users across all four roles** — at least one `OWNER`, `ADMIN`, `EDITOR`,
  `VIEWER`. If `SUPABASE_SERVICE_ROLE_KEY` is present, matching Supabase auth
  users are created with a known dev password so you can actually log in;
  otherwise profile rows are seeded and the console prints how to link them.
- **All 5 platforms as `ConnectedAccount`s**, status `MOCK`.
- **60–90 days of `AnalyticsSnapshot` per account** — realistic, meaning *noisy*:
  an underlying growth trend plus day-of-week seasonality plus random walk plus
  the occasional spike day. Straight lines look fake and make Phase 7's charts
  useless for judging the work.
- **20–30 posts spread across every `PostStatus`**, with plausible
  `platformData` per platform, real timestamps (published in the past,
  scheduled in the future).
- **2+ campaigns** with posts attached.
- **A populated idea list** across platforms and sources.
- **1 brand voice profile**, fully filled in.
- **A few tracked competitors** per platform.
- **A small asset library** — folders + assets with tags.
- Plus the workspace furniture the Dashboard needs: tasks, comments,
  notifications, activity log entries.

## §13 — Build phases

The checklist lives in `PROGRESS.md` and is authoritative for status. Phases:

0. Foundation · 1. App Shell + Dashboard · 2. X Studio (reference implementation)
· 3. Remaining Studios · 4. Universal AI Assistant · 5. Content Calendar
· 6. Asset Library / Brand Voice / Team · 7. Analytics · 8. Polish

Sessions work **only** within the next unchecked phase. Phase 2 is deliberately
one Studio built properly, because Phase 3 copies it four times — a shortcut
there is a shortcut taken five times.
