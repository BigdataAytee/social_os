# SocialOS — Build Progress

Tracks phase completion against `ARCHITECTURE.md` §13. Each new Claude Code session should:

1. Read `ARCHITECTURE.md` in full.
2. Read this file to see what's already done.
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
- [ ] Sidebar with Studio Switcher (signature element, §7)
- [ ] Topbar
- [ ] Resizable AI panel (stub content is fine for now)
- [ ] Command palette (⌘K) functional: navigate + basic actions
- [ ] Dashboard wired to real seeded data: scheduled posts, campaigns, performance overview, AI recommendations, trending topics, notifications, tasks, connected accounts, publishing queue, quick actions, activity feed

**Done when:** Dashboard numbers/lists visibly change if you edit rows in the seeded DB.

---

## Phase 2 — X Studio (reference implementation — build this one right)
- [ ] AI Tweet Writer · Thread Builder · Hook Generator
- [ ] Viral Tweet Library · Swipe File · Saved Ideas
- [ ] Trending Topics · Competitor Tracking
- [ ] Quote Tweet Generator · Reply Generator
- [ ] Scheduling · Content Queue
- [ ] Analytics · Best Posting Times · Engagement Predictions
- [ ] Templates

**Done when:** every feature above reads/writes real DB rows and every AI feature calls the real orchestrator (§9). This becomes the literal template Phase 3 copies — worth getting right before moving on.

---

## Phase 3 — Remaining Studios
- [ ] TikTok Studio — Trend Discovery, Trending Sounds, Trending Hashtags, Competitor Analysis, Creator Discovery, Hook Generator, AI Video Script Generator, Caption Generator, Idea Generator, Trend Alerts, Analytics, Content Calendar, Performance Tracking
- [ ] Instagram Studio — Reel Planner, Carousel Builder, Story Planner, Caption Generator, Hashtag Research, AI Post Generator, Brand Voice, Competitor Analysis, Scheduler, Analytics, Engagement Tracker
- [ ] Facebook Studio — AI Post Writer, Long-form Content Generator, Community Management, Group Content Planner, Business Page Manager, Event Promotion, Comment Assistant, Messenger Templates, Analytics, Scheduler, Campaign Planner
- [ ] YouTube Studio — Topic Research, Keyword Explorer, Video SEO, AI Script Writer, Title Generator, Description Generator, Thumbnail Ideas, Shorts Generator, Competitor Analysis, Analytics, Trend Explorer

**Done when:** all 5 Studios are reachable from the switcher, each visually distinct via its accent color, structurally consistent via `StudioShell`.

---

## Phase 4 — Universal AI Assistant
- [ ] Global chat panel wired to `/api/ai/chat`
- [ ] Tool-calling: `createPost`, `scheduleContent`, `repurposeContent` map to real service-layer calls (not a separate mock path)
- [ ] "Repurpose this into everything" flow: one input → multi-platform draft bundle → review UI before saving

**Done when:** a single prompt produces real, editable drafts across more than one Studio.

---

## Phase 5 — Content Calendar
- [ ] Unified calendar: drafts / scheduled / published / campaigns
- [ ] Drag-and-drop rescheduling (optimistic update via React Query)
- [ ] Platform filters, status filters, approvals view

**Done when:** dragging a post to a new day persists via a real mutation, not local state only.

---

## Phase 6 — Asset Library, Brand Voice, Team
- [ ] Asset upload (Supabase Storage), folders, tags, search
- [ ] Brand Voice form → visibly changes AI Assistant output
- [ ] Team invite flow, roles enforced (§5), task assignment, activity log

**Done when:** changing Brand Voice tone and regenerating the same prompt produces a noticeably different result.

---

## Phase 7 — Analytics
- [ ] Per-studio analytics screens: follower growth, reach, engagement, impressions, clicks, conversions, audience insights, best posting times, competitor comparison, growth trends
- [ ] Unified cross-platform analytics dashboard
- [ ] AI performance recommendations

**Done when:** every chart reads from `AnalyticsSnapshot`, none are hardcoded.

---

## Phase 8 — Polish
- [ ] Animation pass (page transitions, dashboard stagger, drawer/modal motion) per §7 motion tokens
- [ ] Skeleton loaders + empty states everywhere (no bare spinners, no dead ends)
- [ ] Accessibility: keyboard nav, visible focus states, reduced-motion respected
- [ ] Responsive pass down to a reasonable minimum width
- [ ] Onboarding flow for a brand-new org (no seeded data)

**Done when:** you can hand this to someone cold and nothing feels unfinished.

---

## Session log
*(append a line here at the end of each session — phase worked on, what shipped, what was deferred)*

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
