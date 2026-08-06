# SocialOS — Build Progress

Tracks phase completion against `ARCHITECTURE.md` §13 **and the three addendums**
(`Platform-Native-Studios.md`, `Growth-Strategist-Engine.md`,
`Platform-Connections.md`), whose checklist deltas are folded into the phases below.
Each new Claude Code session should:

1. Read `ARCHITECTURE.md` in full, then the three addendums.
2. Read this file to see what's already done — and check it against the code before
   trusting it. A checkbox is a claim, not evidence.
3. Work **only** within the next unchecked phase — don't get ahead of the checklist.
4. Check items off (and note any deviations) before ending the session.

---

## Phase 0 — Foundation
- [x] Next.js 14 (App Router) + TypeScript strict + Tailwind + shadcn/ui initialized
- [x] Design tokens from ARCHITECTURE.md §7 wired into `tokens.css` / `tailwind.config`
- [ ] Supabase project connected; Supabase Auth wired (email/password minimum)
      → **Code is complete and unexercised.** `@supabase/ssr` clients, cookie-based
      session refresh in `middleware.ts`, route gating, `/login`, `/signup`,
      `/auth/sign-out` and `lib/auth/session.ts` are all written. No Supabase
      project was reachable from the build environment, so nothing has run
      against a live Supabase instance. **Add credentials to `.env` and sign in
      once to close this box.**
- [x] `prisma/schema.prisma` in place, migration run against Postgres
      (`prisma/migrations/20260804010021_init`, verified against Postgres 16)
- [x] `prisma/seed.ts` written and run — demo org + data exist in the DB
- [x] Empty (but real, routed) pages exist for every sidebar destination
- [ ] `npm run dev` shows: login → authenticated shell with working nav
      → Authenticated shell and nav are **verified** (all 13 routes 200, unknown
      Studio 404s, Studio accent re-themes the chrome). The login *step* is
      blocked on the same missing Supabase project.

**Done when:** a fresh clone + `npm install` + `npx prisma migrate dev` + `npx prisma db seed` + `npm run dev` gets you a logged-in, navigable (empty) app.

**Status:** that sequence was run end to end from a wiped `node_modules` and a
dropped database and completes cleanly. With no Supabase credentials in `.env`,
`npm run dev` lands on `/setup`, which explains what to fill in.

---

## Phase 1 — App Shell + Dashboard
- [x] Sidebar with Studio Switcher (signature element, §7)
- [x] Topbar
- [x] Resizable AI panel — drag handle, 300–640px, and it holds the real assistant
- [x] Command palette (⌘K) functional: navigate + basic actions
- [x] Dashboard wired to real seeded data: scheduled posts, campaigns, performance overview, trending topics, notifications, tasks, connected accounts, publishing queue, quick actions, activity feed
- [x] **AI recommendations** — *corrected 2026-08-06, replaced 2026-08-06.* This was checked off and the
      status note claimed rule-based recommendations over the org's own counts. **No
      such section exists.** The dashboard renders Performance, Publishing queue,
      Needs approval, Campaigns, Activity, Connected accounts, Notifications, Tasks,
      Trending and Saved ideas — and nothing else. Nothing in `app/(app)/dashboard`
      or `modules/` computes a recommendation. The claim was wrong, not merely
      generous. Superseded by the delta below.
- [x] **"This Week's Strategy" card** (Growth-Strategist-Engine.md §6, §7) — top
      3–5 recommendations across all platforms, reading `StrategyRecommendation`.
      Blocked on the engine (Phase 7 delta).

**Done when:** Dashboard numbers/lists visibly change if you edit rows in the seeded DB.
**Status:** met for everything still checked above — every figure is a service-layer read.

---

## Phase 2 — X Studio (reference implementation — build this one right)
- [x] AI Tweet Writer · Thread Builder · Hook Generator
- [x] Viral Tweet Library · Swipe File · Saved Ideas
- [x] Trending Topics · Competitor Tracking
- [x] Quote Tweet Generator · Reply Generator
- [x] Scheduling · Content Queue
- [x] Analytics · Best Posting Times
- [x] **Engagement Predictions** — *corrected 2026-08-06, built 2026-08-06.* Previously checked with a
      status note explaining it was really the Best Posting Times panel. A panel that
      reports what already happened is not a prediction; unchecking rather than
      re-explaining. Superseded by the two deltas below.
- [x] **Native composer: tweet-card stack** (Platform-Native-Studios.md §1, §4) —
      per-card 280 counter, reorderable, quote-tweet target picker; Thread Builder
      enforces hook → payoff → close. `platformData` takes the `kind: "thread"` shape.
- [x] **Inline engagement-prediction badge** in the schedule modal
      (Growth-Strategist-Engine.md §3, §7) — band plus reasoning, never a fabricated
      precise percentage.
- [x] Templates

**Done when:** every feature above reads/writes real DB rows and every AI feature calls the real orchestrator (§9). This becomes the literal template Phase 3 copies — worth getting right before moving on.
**Status:** mostly met, with two shape deviations worth knowing. Rather than 16 bespoke screens,
X Studio is `StudioShell` — six tabs (Create / Queue / Ideas / Trends / Analytics /
Templates) where each named AI feature is a `type` string in the shared generate box, per
§9's "prompt template plus a type string, never a separate endpoint". Every feature is
reachable and functional. Two features are narrower than their name suggests: **Viral
Tweet Library / Swipe File** are served by the Ideas list with a `source` of `swipe-file`
rather than a separate curated browser, and **Engagement Predictions** was never built
(see above).

*Second deviation, recorded 2026-08-06:* the composer is **one generic component**
(`components/studio/composer.tsx`) shared by all five Studios — a textarea, a campaign
select and a schedule control, with no per-platform branching whatsoever. It always
writes `platformData: {}`; nothing in the app produces a structured per-platform shape.
So `Post.platformData` exists in the schema and is threaded through the service layer,
but is empty for every row the UI creates. Phase 2 and 3 were marked met on the basis of
`StudioShell` being consumed unchanged, which is true and was the stated done-condition —
but "each Studio feels native" is not something the composer currently delivers.

---

## Phase 3 — Remaining Studios
- [x] TikTok Studio — Trend Discovery, Trending Sounds, Trending Hashtags, Competitor Analysis, Creator Discovery, Hook Generator, AI Video Script Generator, Caption Generator, Idea Generator, Trend Alerts, Analytics, Content Calendar, Performance Tracking
- [x] Instagram Studio — Reel Planner, Carousel Builder, Story Planner, Caption Generator, Hashtag Research, AI Post Generator, Brand Voice, Competitor Analysis, Scheduler, Analytics, Engagement Tracker
- [x] Facebook Studio — AI Post Writer, Long-form Content Generator, Community Management, Group Content Planner, Business Page Manager, Event Promotion, Comment Assistant, Messenger Templates, Analytics, Scheduler, Campaign Planner
- [x] YouTube Studio — Topic Research, Keyword Explorer, Video SEO, AI Script Writer, Title Generator, Description Generator, Thumbnail Ideas, Shorts Generator, Competitor Analysis, Analytics, Trend Explorer

- [x] **Native composers per Studio** (Platform-Native-Studios.md §1, §4) — TikTok
      vertical 9:16 storyboard timeline with a trending-sound picker; Instagram
      slide-deck grid with the cover hook as its own field; Facebook longer-form
      editor with `discussionPrompt` first-class; YouTube paired title/thumbnail
      workshop (2–3 concepts side by side, never generated separately) plus chapter
      markers. Each writes its own `platformData` shape.
- [x] **Inline engagement-prediction badge** in every Studio's schedule modal

**Done when:** all 5 Studios are reachable from the switcher, each visually distinct via its accent color, structurally consistent via `StudioShell`.
**Status:** met — all five consume `StudioShell` unchanged; they differ only by registry
entry and loaded data. Same caveat as Phase 2: per-platform discovery features
(Trending Sounds/Hashtags, Creator Discovery, Keyword Explorer, Hashtag Research) are
served by the Trends tab off the mock adapter's `fetchTrends()`, not as separate
screens — real per-feature endpoints arrive with real adapters (§10).

---

## Phase 4 — Universal AI Assistant
- [x] Global chat panel wired to the orchestrator
- [x] Tool-calling: `createPost`, `scheduleContent`, `repurposeContent`, `saveIdea`, `listIdeas` map to real service-layer calls (not a separate mock path)
- [x] "Repurpose this into everything" flow: one input → multi-platform draft bundle → review before saving

- [x] **Trend Response pipeline** (Platform-Native-Studios.md §2) — `modules/trends/pipeline.ts`,
      `POST /api/trends/respond`, and the five-draft review screen reusing the
      repurpose review pattern rather than a second one. Auto-drafts, never auto-publishes.

**Done when:** a single prompt produces real, editable drafts across more than one Studio.
**Status:** met — verified: one repurpose click created 5 drafts, one per Studio, as
ordinary `Post` rows visible in each queue and on the calendar.
**Known limit:** tool-calling needs `ANTHROPIC_API_KEY`. Without one, the offline writer
has no tool protocol, so the assistant converses but won't call tools; the Repurpose
button still works offline because it calls the service directly rather than via a tool.

---

## Phase 5 — Content Calendar
- [x] Unified calendar: drafts / scheduled / published / campaigns
- [x] Drag-and-drop rescheduling (optimistic update via React Query)
- [x] Platform filters, status filters, approvals view

**Done when:** dragging a post to a new day persists via a real mutation, not local state only.
**Status:** met — verified by dragging a card across days in a browser and confirming the
new `scheduledAt` survived a reload. Rolls back on refusal (a published post can't move).

---

## Phase 6 — Asset Library, Brand Voice, Team
- [x] Asset library: folders, tags, search, add/delete
- [x] Brand Voice form → feeds the orchestrator's system prompt on every generation
- [x] Team roles enforced (§5), task assignment, activity log

**Done when:** changing Brand Voice tone and regenerating the same prompt produces a noticeably different result.
**Status:** wiring complete and the mechanism is real — `getBrandVoice` → `systemPrompt`
runs on every generation. **The done-condition itself is only demonstrable with an API
key**, since the offline writer ignores tone. Two deviations: assets are recorded by URL
because Supabase Storage upload needs a live bucket, and there is no email invite flow —
roles are assigned to existing members.

---

## Phase 7 — Analytics
- [x] Per-studio analytics: follower growth, reach, engagement, impressions, clicks, best posting times, competitor comparison
- [x] Unified cross-platform analytics dashboard
- [x] AI performance recommendations

- [x] **Growth Strategist engine** (Growth-Strategist-Engine.md §5, §7) —
      `modules/strategy/engine.ts` (best-time + content-type-ranking aggregation),
      `briefing.ts` (the one LLM synthesis step), `predict.ts` (on-demand, not
      persisted), `benchmarks.json` cold-start fallback with `confidence: "low"`,
      and the nightly recompute job. `GET /api/strategy/:platform`,
      `POST /api/strategy/predict`.

**Done when:** every chart reads from `AnalyticsSnapshot`, none are hardcoded.
**Status:** met — every chart and tile goes through `modules/analytics/service.ts`. Best
posting times are derived from engagement on days you actually published, not a generic
table. Follower-growth charts are indexed to 100 at window start: platforms differ by an
order of magnitude, and a shared absolute axis rendered five flat lines that hid the
growth. Audience insights are limited to share-of-following — the schema holds no
demographic data.

---

## Phase 8 — Polish
- [x] Animation pass (page/tab transitions, drawer + dialog motion) per §7 motion tokens
- [x] Empty states everywhere (one shared `EmptyState`, no dead ends)
- [x] Accessibility: keyboard nav, visible gold focus ring, `prefers-reduced-motion` respected
- [x] Responsive pass — sidebar collapses to a drawer, grids reflow, wide tables scroll
- [x] Onboarding flow for a brand-new org (no seeded data)

**Done when:** you can hand this to someone cold and nothing feels unfinished.
**Status:** met. Onboarding provisions a workspace on the first authenticated request
(`modules/org/service.ts`). With `SOCIALOS_JOIN_ORG_SLUG` set, a new sign-up joins that
organization — so signing up on the demo lands you in a workspace that already has data.
Unset, each new user gets their own organization, owned by them, with a starter brand
voice so AI generations aren't toneless on day one. `/no-organization` survives as a
safety net but is no longer the normal path.

---

## Session log
*(append a line here at the end of each session — phase worked on, what shipped, what was deferred)*

- **OS evolution — stage 3: workspaces and roles.** The tenancy change, done
  third on purpose: it touches how `orgId` is derived on every service call, and
  only gets worse the longer it waits.

  **The design changed on contact with the code, and the new one is better.**
  `OS-ARCHITECTURE.md` §5 sketched a `Workspace` table inside `Organization`.
  But the Organization already *was* the workspace — it carries every business
  row, isolation is enforced in the service layer and already covered by the
  smoke suite, and `@@unique([userId, orgId])` already permitted several
  memberships per user. A nested table would have duplicated a working boundary
  and required backfilling `workspaceId` onto sixteen tables, each a fresh
  chance to get isolation wrong. What was missing was switching, an
  agency→client link, and two roles. Recorded in the architecture doc.

  Shipped: `OrgKind` (BRAND | CLIENT), `Organization.parentOrgId` and
  `branding`, `CREATOR` and `CLIENT` roles, `modules/workspaces`, an
  active-workspace cookie **re-verified against the membership on every
  request** so a hand-edited cookie names a workspace the user isn't in and is
  ignored, and a sidebar switcher that only appears when there's a choice.

  Two deliberate refusals. An agency admin does **not** implicitly get their
  clients' workspaces — reaching one requires an explicit membership, because
  "I can see it because I own the parent" is the implicit grant that leaks one
  client's data to another. And `CLIENT` is an explicit allow-list rather than
  an extension of VIEWER: it can approve and comment, and cannot even switch
  workspaces.

  Verified: `smoke:workspaces` 30/30, including the case that matters — one
  client's draft invisible from another client's workspace *and* from the
  agency's own, while visible in its own. Plus 45/45, 51/51, 23/23, 38/38,
  30/30 unchanged; typecheck, lint, build.

  **Stages 4–11 remain**: Brand Brain + Memory, unified inbox, listening,
  campaign OS, analytics forecasting, automation, reports, Mission Control and
  the design system. Stage 12 (LinkedIn) is independent and can slot in
  anywhere.

- **OS evolution — stages 1-2: job runner and publishing queue.** The first two
  roadmap stages, together because the queue and the thing it exists to fix are
  one unit.

  Shipped: `modules/jobs` (enqueue with optional idempotency, lease-based claim,
  exponential backoff to a 16-minute ceiling, dead-letter that keeps failures,
  manual retry, queue stats), handlers for publish/sync/recompute, and three
  cron routes behind one shared auth guard. Migration `job_queue`, additive.

  **This closes the gap the audit found: `SCHEDULED` posts now actually fire.**
  `/api/cron/publish` finds what's due, moves it to `QUEUED` — a status that
  existed in the enum and had never been set by anything — and enqueues a job;
  `/api/cron/jobs` drains. A post that fell due over an hour ago is deliberately
  left `SCHEDULED` and reported rather than published late.

  Three decisions worth knowing. Handlers run as a **system session** carrying
  OWNER, because the authorisation happened when the human scheduled the post;
  re-checking an editor's role at publish time would refuse work already
  approved through the gate. The publish idempotency key includes the scheduled
  timestamp, so re-running the scheduler can't double-publish but *rescheduling*
  genuinely re-queues. And attempts are charged on failure rather than on claim,
  so a worker that crashes before trying anything doesn't burn a retry.

  One fix made after the suite passed: the dedupe path checked the unique
  constraint by hitting it, which logged a Prisma error on every ordinary
  scheduler tick — exactly how a team learns to ignore its error log. It looks
  first now, and keeps the catch for the genuine race.

  Verified: `smoke:jobs` 30/30 (new), plus 45/45, 51/51, 23/23, 38/38 unchanged;
  typecheck, lint, production build with all three cron routes present.

  Next: stage 3, workspaces and roles.

- **OS evolution — Phase 1 audit and Phase 2 architecture. No code written.**
  The brief asks for the architecture before implementation, which is the right
  order: four of its requirements collide with decisions already shipped here.
  Written up in `OS-ARCHITECTURE.md` — audit, nine systems, new modules, data
  model, API and frontend structure, AI/permission/integration architecture, and
  a 12-stage roadmap.

  **Four collisions surfaced rather than silently resolved.** (1) The brief lists
  LinkedIn and drops Facebook, while its own rule 5 forbids removing
  functionality — recommendation is six Studios, not five. (2) "Predict expected
  reach, engagement, saves, CTR" contradicts `Growth-Strategist-Engine.md` §3,
  implemented last session as band-plus-reasoning-never-a-percentage;
  recommendation is to keep the band and add real interquartile ranges where the
  sample supports them. (3) "The AI gets smarter" reads as training —
  recommendation is retrieval and recompute over the org's own data, as §0
  already settled, with copy that never implies fine-tuning. (4) Particles and
  glow versus the §7 token system and the Phase 8 reduced-motion work —
  recommendation is to extend the tokens rather than bypass them.

  **The audit found three things worth knowing before anything is built:** the
  session takes the first `Membership` and cannot switch, so agencies are
  impossible until tenancy changes; there is no job runner, so nothing
  continuous can exist; and **`SCHEDULED` posts never actually fire** — publish
  is synchronous and called by hand. The roadmap puts those three first
  deliberately, ahead of Mission Control, which would otherwise be built twice.

  Deferred: all implementation, pending a decision on the four collisions and on
  where to start.

- **Addendum retrofit, session 4 — steps 3 through 7, in one pass.** The
  one-step-per-session rule was explicitly overridden ("finish the remaining
  steps all together"). Every step still got its own verification rather than
  one pass at the end.

  **Step 3.** Three-way Mock/Unified/Direct selector on each connection card.
  Switching an already-connected account's mode deletes the credential and
  requires an explicit reconnect — §4 is clear that this changes who holds the
  credential and the org should know. Carrying it across would leave an account
  that looks connected and fails on first use, since a platform token means
  nothing to the provider and vice versa.

  **Step 4.** The generic composer is gone. Five native ones: tweet-card stack
  with a per-card counter, 9:16 storyboard timeline with on-screen text as a
  real field, slide-deck grid with the cover hook lifted out, discussion-first
  Facebook layout, paired title/thumbnail workshop. Each writes its own
  `platformData`; Reels and Shorts reuse the TikTok beat shape as §1 specifies.

  **Steps 5–6.** `modules/strategy/` — engine (best-time and content-type
  aggregation), predict (band plus reasoning, never a percentage), briefing (the
  one LLM step), `benchmarks.json` cold start, nightly recompute at
  `/api/cron/recompute`. The Dashboard card replaces the "AI recommendations"
  widget the audit found had never existed.

  **Step 7.** `modules/trends/pipeline.ts` fans one `TrendEvent` to five native
  drafts, `/api/trends/respond`, and a review screen reusing the repurpose
  pattern. `TrendResponse` rows are written *before* review, so a trend whose
  five drafts were all rejected is distinguishable from one never run.

  **One real bug, found by the fan-out.** An X thread's rendered body is its
  tweets joined, and `createPostSchema` measured that against X's 280 — so
  threads could not be saved at all, from the new composer either. The limit is
  now shape-aware: multi-part kinds are capped generously overall while each
  unit is enforced individually in the composer. Before the native shapes
  existed every post was one unit and this couldn't arise.

  Verified: `smoke` 45/45, `smoke:oauth` 51/51, `smoke:unified` 23/23,
  `smoke:strategy` 38/38 (new), typecheck, lint, production build, all twelve
  authenticated routes and the three new API routes answering, and the composer
  and connection selector confirmed in a browser.

  **Deferred, deliberately:** template-rendered image cards
  (Platform-Native-Studios.md §3) — the shapes carry `mediaCard` and
  `thumbnailConcepts` but nothing renders an image yet. Trend sources are still
  the mock adapter (§2 step 1 says real sources come later). The unified
  provider's endpoint shapes remain unexercised against Ayrshare itself.

- **Addendum retrofit, session 3 — step 2 (registry + unified adapter).**
  Shipped: `getAdapter(platform, mode)` per §4, with `modeAvailability()` for step
  3's selector; `modules/integrations/unified/` (provider config, one shared
  client, the adapter); every call site moved off the platform-keyed lookup.
  Trend panels now go through a separate `getPlatformAdapter()` — they read a
  platform-wide feed, not an org's data, and letting the account-scoped call take
  an optional mode would let a caller silently omit it.

  Unified publishes for real, unlike direct: the provider's whole proposition is
  that it holds write approval, so delegating publish to the mock would discard
  the reason to be on it. Trends still delegate to the mock on both — no provider
  exposes trend discovery, because the underlying platforms don't on these tiers.

  Two real bugs caught by the new suite rather than by reading:
  **(1)** `publishPost` resolved the *oldest* account for a platform, which in any
  org that connected an account is still the seeded MOCK row — so publishing
  reported success while nothing left the building. It now prefers a
  CONNECTED account with a credential and a mode, falling back to any account.
  **(2)** a 33-byte test key was silently wrong; every downstream availability
  check correctly refused it, which is how it was found.

  Deferred: steps 3–7. Step 3 (Settings selector) is next and `modeAvailability()`
  already supplies exactly what it needs. **Open question for step 3:** `DIRECT`
  is read-only today — publish and trends fall back to the mock because the OAuth
  scopes requested are read-only — so "a direct adapter exists" is true for
  reading and false for writing. Whether Direct is selectable on that basis, and
  what the tooltip says, is a product call.

- **Addendum retrofit, session 2 — step 1 (schema) only.** The three addendum
  documents arrived and are now in the repo root. Their checklist deltas are folded
  into the phases above.

  Shipped: migration `20260806024315_integration_mode_trends_strategy` —
  `IntegrationMode` (DIRECT | UNIFIED) plus a nullable `integrationMode` on
  `ConnectedAccount`, `TrendEvent`/`TrendResponse`, and `StrategyRecommendation`,
  with the two new `Organization` relations. Additive only: the existing org, 29
  posts, 394 snapshots and 5 connected accounts are untouched. Verified after the
  migration — typecheck, lint, production build, `npm run smoke` (45/45),
  `npm run smoke:oauth` (51/51), and the app boots with every route answering.

  **One deviation, deliberate.** `Platform-Connections.md` §3 sketches
  `PlatformCredential` with separate `accessTokenEnc`/`refreshTokenEnc` columns. That
  table already existed here from the connected-accounts work, storing one AES-256-GCM
  envelope over both tokens with its IV and auth tag. It was kept rather than
  rewritten: GCM needs a unique IV and an authentication tag per encryption, and the
  §3 sketch has nowhere to put either — dropping the tag would let a tampered row
  decrypt to plausible garbage that then gets sent to a platform API as a bearer
  credential. Every requirement §3 actually states is met. Documented in the schema at
  the model.

  Deferred: steps 2–7, in order, one per session as the brief asks. Step 2 (registry +
  unified adapter) is next, and note that `modules/integrations/registry.ts` already
  exists with a `getAdapter(platform)` signature — it needs the `mode` parameter and
  per-account resolution, not a rewrite.

- **Baseline audit (addendum retrofit, session 1).** Asked to integrate three
  addendum documents — `Platform-Native-Studios.md`, `Growth-Strategist-Engine.md`,
  `Platform-Connections.md` — which are **not in the repo**, not in the working tree
  and not anywhere in git history. Every numbered step of that brief cites a section
  of one of them (`Platform-Connections.md` §3 and §4, `Platform-Native-Studios.md`
  §1 and §2, `Growth-Strategist-Engine.md` §4 and §5), so none of it can be built
  without inventing the specification. Nothing was written. The brief also assumed
  this file already had the addendums' requirements folded into its phases; it did
  not, and still doesn't.

  What *was* done, because it was the one step independent of those documents:
  audited every checkbox here against the code. Three corrections, above —
  dashboard "AI recommendations" (claimed, never built), "Engagement Predictions"
  (was the Best Posting Times panel wearing a forecast's name), and a new note that
  all five Studios share one generic composer that always writes an empty
  `platformData`. Also recorded the schema-drift detection, error boundaries and two
  smoke suites that shipped but were never logged here.

  Confirmed present, contrary to the brief's "build this" framing:
  `modules/integrations/registry.ts` and `PlatformCredential` already exist, though
  the existing credential table was designed against the connected-accounts work in
  this repo and may not match `Platform-Connections.md` §3.
  Confirmed absent: `IntegrationMode`, `TrendEvent`, `TrendResponse`,
  `StrategyRecommendation`, `modules/integrations/unified/`, `modules/strategy/`,
  `modules/trends/`.
  **Deferred, blocked:** all seven numbered steps, pending the three documents.

- **Setup simplification.** Cut the path from clone to working app. First
  authenticated request now provisions a workspace instead of dead-ending on
  `/no-organization`, which both closes Phase 8's onboarding item and removes the need
  for `SUPABASE_SERVICE_ROLE_KEY` just to get in — sign up with any email and, with
  `SOCIALOS_JOIN_ORG_SLUG=northwind`, you land in the seeded demo org. `npm run setup`
  replaces the separate migrate and seed commands, and `/setup` is four steps instead of
  five. Verified against the database across five paths: joining an existing org, creating
  a fresh one, repeat calls, five concurrent first requests, and a configured slug that
  doesn't exist. That testing caught a real bug — the first version derived the new org's
  slug through a uniqueness loop that appended `-2`, so two concurrent first requests each
  created their own organization. The slug is now derived from the user id, so concurrent
  creates collide on the unique constraint and exactly one org wins.

- **Phases 1–8 — build to a usable stage.** The one-phase-per-session rule was
  explicitly overridden by the user ("build the whole thing to the usable stage"), so this
  session ran Phases 1 through 8 in one pass. Shipped: a service layer
  (`modules/*/service.ts`) that every write goes through with §5 roles enforced server-side;
  the AI orchestrator (§9) with tool-calling into that service layer; mock platform adapters
  (§10); `StudioShell` consumed unchanged by all five Studios; a dashboard, calendar,
  assistant, asset library, team, settings and analytics screen all reading real rows.
  Verified in a browser against the seeded DB, not just by reading the code: generate →
  compose → save round trip, repurpose creating 5 drafts across 5 Studios, calendar
  drag-to-reschedule persisting, ⌘K palette, and all 12 authenticated routes rendering.
  Two things found and fixed by that testing: the offline writer produced a 307-character
  draft for X's 280 limit (the composer correctly refused it — generation now respects the
  per-platform limit and the result box shows the count), and the multi-platform follower
  chart rendered five flat lines because a shared absolute axis spanning 12K–100K hides
  a 3% monthly rise (now indexed to 100 at window start).
  Deferred deliberately: **onboarding for a brand-new org** (Phase 8) — signing up outside
  the seeded org lands on an explanatory `/no-organization` page rather than a create-org
  flow. Still blocked on credentials: **live Supabase auth** and **model-backed AI**; both
  code paths are complete but neither has run against a real service. Per-phase status
  notes above say exactly which done-conditions are met versus wired-but-undemonstrable.

- **Phase 0 — Foundation.** Shipped: Next.js 14 App Router + TS strict + Tailwind;
  §7 tokens in `styles/tokens.css` wired through `tailwind.config.ts`
  (`bg-canvas`, `bg-surface`, `text-primary`, `text-secondary` and the five
  `studio-*` accents are live utilities); Prisma schema + initial migration
  against Postgres; a deterministic `prisma/seed.ts` producing the full §12 demo
  org (5 mock accounts, 394 analytics snapshots across 64–90 days each, 29 posts
  covering all six `PostStatus` values, 3 campaigns, 14 ideas, brand voice, 7
  competitors, 9 assets in 3 folders, tasks/comments/notifications/activity);
  Supabase Auth wiring end to end; and the authenticated shell — sidebar with all
  9 destinations, Studio Switcher (the §7 signature element, and it really does
  re-theme the chrome per route), topbar, AI panel slot, plus real routes for
  every destination.
  Deviations, all three worth reading before Phase 1:
  **(1) `ARCHITECTURE.md` was not in the handoff** — it was reconstructed this
  session from the schema's section references, `PROGRESS.md` and the Phase 0
  brief. The §7 color table and type pairing are therefore *chosen*, not given.
  They are isolated in two files; swap them if the original turns up.
  **(2) No Supabase project was reachable**, so auth is written but has never run
  against live Supabase, and the seed created profile rows with generated UUIDs
  instead of real `auth.uid()`s. Set `SUPABASE_SERVICE_ROLE_KEY` and re-run
  `npx prisma db seed` to get working demo logins for each role.
  **(3) `ui.shadcn.com` is blocked by this environment's egress policy**, so
  `shadcn init` wrote `components.json` but could not fetch components. The 11
  primitives in `components/ui/` were vendored by hand in new-york style over the
  same Radix packages. `npx shadcn@2 add <component>` works normally elsewhere.
  Not started, deliberately: everything in Phase 1 and beyond. Dashboard and all
  other pages are placeholders that name what belongs there and which phase owns it.


---

## Connected accounts (post-Phase 8)

Not one of the original §13 phases — added after the checklist, on request.

- [x] OAuth 2.0 connect flow for X, TikTok, Instagram, Facebook and YouTube
      (PKCE where the platform requires it, signed state + httpOnly nonce cookie)
- [x] Tokens encrypted at rest (AES-256-GCM) in `platform_credentials`,
      refreshed ahead of expiry, deleted on disconnect
- [x] `LiveAdapter` pulls recent posts and engagement per platform;
      registry falls back to `MockAdapter` for any platform without credentials
- [x] `ExternalPost` stores pulled posts, upserted so re-syncs update rather than duplicate
- [x] `modules/insights` derives format, timing, length and topic performance
      plus top posts, in engagement rate, with a minimum sample per bucket
- [x] `generateIdeasFromAccount` in the orchestrator, exposed as an assistant tool
- [x] Account row and "Analyze my account" panel in every Studio
- [x] Schema-drift detection: `lib/db-health.ts` compares the migration folders
      shipped in the build against `_prisma_migrations` and reports `schema-outdated`,
      naming the pending migrations on `/setup`. Added after a preview deployment
      running new code against an un-migrated database surfaced as an opaque digest
- [x] Error boundaries (`app/(app)/error.tsx`, `app/global-error.tsx`) — the digest
      plus the failures worth checking first, instead of Next's bare message
- [x] Two verification suites: `npm run smoke` (45 checks, service layer against a
      seeded database) and `npm run smoke:oauth` (51 checks, the whole connect flow
      against `scripts/fake-platform.ts`)
- [x] **Step 1 — schema (Platform-Connections.md §3, Platform-Native-Studios.md §2,
      Growth-Strategist-Engine.md §4).** `IntegrationMode` enum + nullable
      `ConnectedAccount.integrationMode`; `TrendEvent`/`TrendResponse`;
      `StrategyRecommendation`. Migration `20260806024315_integration_mode_trends_strategy`,
      additive only — the seeded org, its 29 posts, 394 snapshots and 5 accounts all
      survived it. `PlatformCredential` already existed; kept, with the deviation from
      §3 documented in the schema (§3's two-column sketch has nowhere to put AES-GCM's
      IV and auth tag).
- [x] **Step 2 — adapter registry + unified adapter** (Platform-Connections.md §4).
      `getAdapter(platform, mode)` with mock / unified / direct; `modeAvailability()`
      supplies the Settings selector's three states and the reason each is blocked.
      Every service-layer call resolves per `ConnectedAccount`. `UnifiedAdapter`
      pulls posts + analytics and **publishes for real** through the provider,
      over one shared client that scopes every call to the connected account.
      Verified by `npm run smoke:unified` (23 checks) against `scripts/fake-unified.ts`.
- [x] **Step 3 — connection-type selector** in Settings (Mock / Unified / Direct),
      Direct shown greyed with a tooltip until that platform's adapter exists.
- [x] **Step 4 — native composers** (see Phase 2/3 deltas above)
- [x] **Step 5 — engagement-prediction badge** (see Phase 2/3 deltas above)
- [x] **Step 6 — Growth Strategist engine** (see Phase 7 delta above)
- [x] **Step 7 — Trend Response pipeline** (see Phase 4 delta above)
- [ ] **Unexercised against the real platform APIs.** The full flow is verified
      end to end against `scripts/fake-platform.ts` (51 checks), but no request
      has been made to X, TikTok, Meta or Google — the build environment has no
      egress to them and no developer app exists. Register the apps, set the
      credentials, connect one account, and close this box.
