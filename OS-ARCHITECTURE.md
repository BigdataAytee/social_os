# SocialOS — Operating System Architecture

Companion to `ARCHITECTURE.md` (the standing spec) and the three addendums. This
document is the **Phase 1 audit and Phase 2 architecture** for the OS evolution:
what exists today, what the OS brief asks for, where those two collide, and the
order in which the gap gets closed.

Nothing here has been built yet. `PROGRESS.md` remains the source of truth for
what is actually done.

---

## §1 — Phase 1: audit of what exists

Measured, not estimated: **18,384 lines** of TS/TSX across 21 routes, 56
components, 30 service modules, 22 Prisma models and 3 migrations.

### Frontend

Next.js 14 App Router, React Server Components by default. Two route groups:
`app/(auth)` for login/signup, `app/(app)` for the authenticated shell (sidebar
with Studio Switcher, topbar, resizable AI panel). Every authenticated route is
`force-dynamic` — nothing is prerendered against live data.

Client components are the exception, not the rule: composers, the calendar
board, the assistant, and the panels that mutate. State is local plus React
Query for the one optimistic surface (calendar drag). There is no global client
store, and nothing has needed one.

Design tokens live in `styles/tokens.css` as RGB channel triplets, exposed
through `tailwind.config.ts`. No component hardcodes a colour.

### Backend

There is no separate backend. Server Components read through the service layer;
mutations go through Server Actions returning a typed `ActionResult`
discriminated union. Route handlers exist only where the browser must land on a
URL — the OAuth start/callback pair, the strategy and trends APIs, the cron.

**The service layer is the architecture's load-bearing wall.** Every write goes
through `modules/*/service.ts`. `orgId` is derived from the session and never
accepted from a client. Roles are enforced there, not in the UI — the UI hides
affordances as a courtesy.

### Database

Postgres via Prisma. 22 models, all business tables carrying `orgId`. The ones
that matter for what follows:

| Model | Role |
| --- | --- |
| `Organization` / `Membership` / `User` | Tenancy. One org per membership; **the session takes the first membership and there is no switching.** |
| `ConnectedAccount` + `PlatformCredential` | Platform connections; tokens AES-256-GCM encrypted in a separate table |
| `Post` | Content authored *in* SocialOS, with `platformData` now carrying five native shapes |
| `ExternalPost` | Content pulled *from* platforms, with reported metrics |
| `AnalyticsSnapshot` | Daily rollups per account |
| `StrategyRecommendation` | Growth Strategist output, with `basedOnDataThrough` |
| `TrendEvent` / `TrendResponse` | Trend fan-out |
| `BrandVoice` | 1:1 with org — tone, audience, emoji, CTA style, avoid-words |
| `AIGeneration` | Every generation, as audit trail and history |
| `Campaign`, `Idea`, `Asset`, `Folder`, `Competitor`, `Task`, `Comment`, `Notification`, `ActivityLog` | Supporting objects |

### Integrations

`PlatformAdapter` is the seam: `publish`, `fetchPosts`, `fetchAnalytics`,
`fetchTrends`. Three implementations — `MockAdapter`, `LiveAdapter` (direct
platform APIs, read-only scopes), `UnifiedAdapter` (one provider across all
five, publishes for real). `getAdapter(platform, mode)` resolves per
`ConnectedAccount.integrationMode`. Nothing above that layer knows which
answered.

### AI

One orchestrator (`modules/ai/orchestrator.ts`), one provider adapter with a
deterministic offline fallback, prompt assembly that always includes brand voice.
Tool-calling maps to the service layer: `createPost`, `scheduleContent`,
`repurposeContent`, `saveIdea`, `listIdeas`, `generateIdeasFromAccount`.

### Current limitations — the honest list

1. **One org per session, no switching.** `getSessionResult` takes the first
   `Membership`. Agencies and client workspaces are impossible until this
   changes, and it touches every service call's `orgId`.
2. **No background job runner.** One nightly Vercel cron. Anything continuous —
   listening, inbox polling, scheduled publishing at the minute — has nowhere
   to run.
3. **Publishing has no queue.** `publishPost` is synchronous and called by hand.
   Nothing actually fires a `SCHEDULED` post when its time arrives.
4. **No versioning.** `Post` has no revision history; edits are destructive.
5. **Four roles, no Creator or Client.** The permission matrix is a static
   `Record<Role, Action[]>`, so adding roles is cheap; adding *per-resource*
   permissions is not.
6. **Assets are URLs.** No upload pipeline — Supabase Storage was never wired.
7. **No full-text search.** The "AI Second Brain" has nothing to retrieve over.
8. **`ExternalPost` is the only real-performance source**, and it only exists
   for connected accounts. Most orgs will have none on day one.
9. **Read-only platform scopes.** Direct adapters can't publish, can't read DMs,
   can't read mentions.

---

## §2 — Four collisions between this brief and what is already decided

These are not objections. They are places where doing what the brief says would
undo something built deliberately, and someone has to choose.

### 2.1 LinkedIn replaces Facebook in the brief's Studio list

The brief names X, TikTok, Instagram, LinkedIn and YouTube — and rule 5 says
*do not remove existing functionality*. Facebook Studio exists, is wired to a
real adapter, and has a native composer.

**Recommendation: add LinkedIn, keep Facebook — six Studios.** Costs a `Platform`
enum value, an OAuth provider entry, adapter branches, a native shape and a
composer. Everything else is registry-driven and follows for free.

### 2.2 "Predict expected reach, engagement, saves, shares, CTR"

This directly contradicts `Growth-Strategist-Engine.md` §3, implemented last
session: *"a band + reasoning, never a fabricated precise percentage."* An
account's history is a few dozen posts. That supports "this looks above average,
and here's why". It does not support "expected reach: 4,200".

**Recommendation: keep the band as the headline, and add per-metric *ranges*
only where the sample supports one** — an interquartile range from the account's
own distribution, shown as "posts like this have landed between 1.8K and 4.1K
views (n=23)". That is a real prediction with real error bars, and it degrades
honestly to "not enough data". A single confident number would be the fastest
way to make the whole feature untrustworthy.

### 2.3 "The longer users use SocialOS, the smarter the AI becomes"

Brand Brain and Growth Memory read as model training. They should not be.
`Growth-Strategist-Engine.md` §0 already settled this: **a recompute pipeline,
not a training pipeline.** A new org has no proprietary training data on day one,
and standing up training infrastructure is disproportionate.

**Recommendation: "smarter" means retrieval + recompute over the org's own data.**
Brand Brain is a learned *profile* (extracted from what they actually published
and what worked) fed into the system prompt. Growth Memory is a searchable,
embedded corpus of their own content and outcomes. Both genuinely improve with
use. Neither involves fine-tuning, and the copy should never imply it does.

### 2.4 The design direction versus §7 and the accessibility pass

"Animated gradients, subtle particles, glass surfaces, glowing AI elements"
against an existing token system and a Phase 8 pass that honours
`prefers-reduced-motion` and ships a visible focus ring.

**Recommendation: extend the token system rather than bypass it.** Add surface
treatments (glass, glow, gradient) as *tokens* and a motion layer that collapses
to nothing under `prefers-reduced-motion`. Particles are decoration on a tool
people use for six hours a day; they belong on marketing surfaces and the AI
"thinking" state, not behind a data table.

---

## §3 — The OS architecture

Nine systems, each a module, each reachable from the others through the service
layer. Existing modules are marked ✓.

```
                          ┌───────────────────────────┐
                          │   AI INTELLIGENCE CORE    │
                          │  orchestrator ✓           │
                          │  brand-brain  (profile)   │
                          │  memory       (retrieval) │
                          │  strategist ✓ (recompute) │
                          └────────────┬──────────────┘
                                       │ every system reads and writes here
   ┌───────────┬───────────┬───────────┼───────────┬───────────┬───────────┐
   │           │           │           │           │           │           │
┌──▼───┐  ┌────▼────┐  ┌───▼────┐  ┌───▼────┐  ┌───▼────┐  ┌───▼────┐  ┌───▼────┐
│CREATE│  │CAMPAIGN │  │PUBLISH │  │ ENGAGE │  │ LISTEN │  │ANALYSE │  │AUTOMATE│
│studios│ │campaigns✓│ │ queue  │  │ inbox  │  │mentions│  │insights✓│ │ rules  │
│remix ✓│ │ builder │  │workers │  │ triage │  │compete✓│  │reports │  │triggers│
│assets✓│ │approvals✓│ │retries │  │ replies│  │trends ✓│  │forecast│  │actions │
└──┬───┘  └────┬────┘  └───┬────┘  └───┬────┘  └───┬────┘  └───┬────┘  └───┬────┘
   └───────────┴───────────┴───────────┴───────────┴───────────┴───────────┘
                                       │
                          ┌────────────▼──────────────┐
                          │  PLATFORM ADAPTER LAYER ✓ │
                          │  mock │ direct │ unified  │
                          └───────────────────────────┘
```

Two things are load-bearing and already exist: **the adapter layer** (so every
new system reads real or mock data without knowing which) and **the service
layer** (so the AI path and the UI path are the same path).

Two things are missing and gate almost everything: **a job runner** and
**multi-workspace tenancy**.

---

## §4 — New modules

| Module | Purpose | Depends on |
| --- | --- | --- |
| `modules/jobs` | Durable queue: enqueue, claim, retry with backoff, dead-letter. Backs publishing, syncing, listening, automation. | — |
| `modules/workspaces` | Multiple orgs per user, an active workspace on the session, client isolation. | — |
| `modules/brandbrain` | Learned voice profile extracted from published content and outcomes; merges with the hand-authored `BrandVoice`. | jobs |
| `modules/memory` | Embedded corpus of the org's own posts, generations and outcomes; semantic search behind one `recall()` call. | jobs |
| `modules/engagement` | Unified inbox: conversations, messages, sentiment, assignment, AI-drafted replies. | jobs, adapters |
| `modules/listening` | Keyword/brand/competitor monitoring; feeds `TrendEvent` and the strategist. | jobs, adapters |
| `modules/automation` | Rules: trigger → condition → action, executed as jobs. | jobs |
| `modules/reports` | Composable report definitions, scheduled generation, export, white-label. | jobs, analytics |
| `modules/search` | Cross-entity search backing both the command palette and the Second Brain. | memory |

Extended, not replaced: `modules/strategy` gains forecasting and per-metric
ranges; `modules/posts` gains versioning; `modules/assets` gains real uploads;
`modules/integrations` gains LinkedIn and write scopes.

---

## §5 — Data model additions

All additive. No existing table is dropped or repurposed.

```prisma
// --- tenancy -------------------------------------------------------------
model Workspace {              // an agency's client, or a solo user's only one
  id, orgId, name, slug, kind (BRAND | CLIENT), brandingJson, archivedAt
}
// Membership gains workspaceIds; Session gains activeWorkspaceId.

// --- durable work --------------------------------------------------------
model Job {
  id, orgId, kind, payload Json, runAfter, attempts, maxAttempts,
  status (PENDING|CLAIMED|DONE|FAILED|DEAD), claimedAt, lastError
  @@index([status, runAfter])
}

// --- engagement ----------------------------------------------------------
model Conversation {
  id, orgId, accountId, platform, externalId, kind (COMMENT|DM|MENTION),
  subjectExcerpt, sentiment, priority, assigneeId, status, lastMessageAt
}
model Message {
  id, conversationId, externalId, authorHandle, body, direction (IN|OUT),
  sentAt, draftedByAi Boolean
}

// --- listening -----------------------------------------------------------
model ListeningQuery { id, orgId, term, kind (BRAND|KEYWORD|HASHTAG|COMPETITOR), platforms[] }
model ListeningHit   { id, queryId, platform, externalId, authorHandle, body, sentiment, engagement, seenAt }

// --- memory / brand brain ------------------------------------------------
model MemoryChunk {
  id, orgId, sourceType (POST|EXTERNAL_POST|GENERATION|ASSET|REPORT),
  sourceId, text, embedding Unsupported("vector(1536)")?, metadata Json
  @@index([orgId, sourceType])
}
model BrandProfile {           // learned; BrandVoice stays the hand-authored one
  orgId @id, vocabulary Json, sentenceStats Json, emojiRate, hookPatterns Json,
  contentPillars Json, winningFormats Json, basedOnPosts Int, updatedAt
}

// --- automation ----------------------------------------------------------
model AutomationRule { id, orgId, name, trigger Json, conditions Json, actions Json, enabled, lastFiredAt }
model AutomationRun  { id, ruleId, firedAt, outcome, detail Json }

// --- reporting & versioning ---------------------------------------------
model ReportDefinition { id, orgId, workspaceId, name, sections Json, schedule, recipients[] }
model ReportRun        { id, definitionId, generatedAt, payload Json, fileUrl }
model PostRevision     { id, postId, body, platformData Json, editedById, editedAt }
```

`MemoryChunk.embedding` uses pgvector — available on Supabase as an extension.
If it isn't enabled, memory degrades to Postgres full-text search, which is worse
but not broken.

---

## §6 — API structure

Existing routes stay. Additions follow the established rule: **Server Actions for
mutations, route handlers only where a URL is required.**

```
/api/oauth/[platform]/{start,callback}   ✓ browser must land on the platform
/api/strategy/[platform]                 ✓
/api/strategy/predict                    ✓
/api/trends/respond                      ✓
/api/cron/recompute                      ✓
/api/cron/jobs          NEW  drain the job queue (every minute)
/api/cron/publish       NEW  claim due SCHEDULED posts → enqueue publish jobs
/api/cron/listen        NEW  run listening queries
/api/cron/sync          NEW  refresh connected accounts
/api/webhooks/[platform] NEW inbound comments/DMs where a platform pushes
/api/reports/[id]/export NEW PDF/CSV download — needs a URL
/api/search              NEW command palette + Second Brain (streaming)
```

---

## §7 — Frontend structure

```
app/(app)/
  page.tsx            NEW  Mission Control — replaces the dashboard
  studio/[studio]     ✓    six Studios once LinkedIn lands
  calendar            ✓
  inbox               NEW  unified engagement
  listening           NEW  mentions, keywords, competitors
  campaigns           NEW  campaigns as first-class objects (today: a list)
  automations         NEW  rule builder
  reports             NEW  builder + scheduled runs
  analytics           ✓    gains forecasting and AI explanation per metric
  assets              ✓    gains real upload
  team                ✓    gains Creator and Client roles
  settings            ✓    gains workspace switching

components/
  ai/                 NEW  the AI surface that appears *inside* other surfaces
  motion/             NEW  shared transition primitives, reduced-motion aware
  surfaces/           NEW  glass / gradient / glow, as tokens not one-offs
```

**Mission Control** is the one genuinely new page: AI briefing, today's
schedule, opportunities, trends, inbox triage, campaign health — each a card
that links into the system that owns it.

**AI everywhere** means one `<AIAffordance>` primitive that any surface can host,
backed by the same orchestrator. Not a second chat.

---

## §8 — AI architecture

```
                    ┌──────────────────────────────┐
   any surface ───▶ │  orchestrator ✓              │
                    │   ├── context assembly       │
                    │   │    ├── BrandVoice ✓      │  hand-authored
                    │   │    ├── BrandProfile NEW  │  learned
                    │   │    ├── memory.recall NEW │  their own corpus
                    │   │    └── strategist ✓      │  their own numbers
                    │   ├── tools → service layer ✓│
                    │   └── provider ✓ (+ offline) │
                    └──────────────────────────────┘
```

Every AI answer is grounded in three things the org owns: what they said they
sound like, what they actually published, and how it performed. The model
synthesises; it does not supply the facts.

New tools, all mapping to services: `searchMemory`, `draftReply`,
`summariseConversation`, `buildCampaign`, `explainMetric`, `createAutomation`.

---

## §9 — Permission architecture

Six roles. `Creator` and `Client` are new; the existing four keep their meaning.

| | Owner | Admin | Editor | Creator | Viewer | Client |
| --- | --- | --- | --- | --- | --- | --- |
| Create content | ✓ | ✓ | ✓ | ✓ | | |
| Approve / publish | ✓ | ✓ | | | | |
| Review + comment | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Client approval | ✓ | ✓ | | | | ✓ |
| Manage integrations | ✓ | ✓ | | | | |
| See other workspaces | ✓ | ✓ | | | | |

Two changes to how permissions work, not just who has them:

1. **Workspace scoping.** Every check becomes `(role, action, workspaceId)`. A
   Client sees exactly one workspace; an agency Admin sees all of them.
2. **`Client` is deny-by-default.** It gets an explicit allow-list rather than
   inheriting Viewer, because a client seeing another client's data is the one
   failure an agency cannot survive.

---

## §10 — Integration architecture

The adapter pattern already generalises. Three new families sit beside it:

| Family | Interface | Members |
| --- | --- | --- |
| Platform ✓ | `PlatformAdapter` | mock, direct ×6, unified |
| Storage | `StorageAdapter` | Supabase Storage, Drive, Dropbox |
| Design | `DesignAdapter` | Canva, Figma, Adobe Express |
| Notify | `NotifyAdapter` | Slack, Teams, email, push |
| Outbound | `WebhookAdapter` | Zapier, Make, HubSpot, Salesforce |

Each is a registry with a mock default, exactly as platforms are — so a Studio
never branches on whether Canva is configured.

---

## §11 — Implementation roadmap

Ordered by what unblocks the most. Each stage ends usable and verified.

| # | Stage | Why here | Unblocks |
| --- | --- | --- | --- |
| **1** | **Job runner** (`modules/jobs` + `/api/cron/jobs`) | Nothing continuous can exist without it, and publishing is currently a lie — scheduled posts never fire | publishing, listening, inbox, automation, reports |
| **2** | **Publishing queue** | Turns `SCHEDULED` from a label into a promise. Retries, backoff, dead-letter, history | trust in everything else |
| **3** | **Workspaces + roles** | Touches every `orgId` in the service layer; cheapest now, brutal later | agencies, clients, white-label |
| **4** | **Brand Brain + Memory** | Makes every later AI surface better rather than each reinventing context | Second Brain, replies, campaigns, remix |
| **5** | **Unified inbox** | The largest single product gap; needs write scopes and app review | engagement, sentiment, triage |
| **6** | **Listening + competitor intel** | Feeds the strategist and trend pipeline with outside data | Mission Control, automation triggers |
| **7** | **Campaign OS + builder** | Campaigns become objects that own content, tasks, approvals, analytics | reporting, client review |
| **8** | **Analytics: explanation, forecasting, ranges** | Extends the strategist; resolves §2.2 honestly | Mission Control, reports |
| **9** | **Automation engine** | Only meaningful once triggers exist to fire on | — |
| **10** | **Reports + white-label export** | Last because it composes everything above | agency delivery |
| **11** | **Mission Control + design system** | Deliberately last: it is the surface *over* these systems, and building it first would mean building it twice | the product's face |
| **12** | **LinkedIn Studio** | Independent of all of it; can slot in anywhere | six Studios |

**Stages 1–3 are infrastructure and will not look like much.** They are also the
difference between a product that schedules posts and one that actually publishes
them, and between one workspace and an agency. Doing 11 first would be the
tempting mistake.

### What can't be finished here, and why

- **Inbox and listening need write/read scopes behind platform review** — Meta
  messaging permissions, X DM access on a paid tier. Buildable now against the
  mock adapter, real only after approval.
- **Nothing has been exercised against a real platform API.** That box is still
  open in `PROGRESS.md` and every stage above inherits it.
- **`pgvector`** must be enabled on the Supabase project, or memory falls back to
  full-text search.
- **A job runner on Vercel crons is minute-resolution.** Fine for publishing and
  sync; if sub-minute matters later, it wants a real queue service, and the
  `modules/jobs` interface is the seam that makes that swap cheap.
