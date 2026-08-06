# SocialOS — Platform-Native Studio Environments (addendum to ARCHITECTURE.md)

Read alongside `ARCHITECTURE.md`. This addendum answers a specific gap: the base architecture gives every Studio the same shape (StudioShell + feature panels). This document makes each Studio's **composer and AI output actually match what people do natively on that platform**, rather than five reskins of one generic "write a post" tool — plus a shared pipeline for turning a trending topic into a platform-native draft on all five at once.

Nothing here changes §1–§14 of ARCHITECTURE.md. It specializes `Post.platformData` (already a flexible JSON field by design, see §4) and adds one new pair of models for trend handling.

---

## 1. Per-platform content model

For each Studio: what the platform actually rewards, the native `platformData` shape, the composer UI that should replace a generic textarea, and the structure the AI prompt template should enforce.

### X Studio
- **What actually works:** speed, text-first, threads with a scroll-stopping first line, quote-tweeting to add a take on top of something already moving, screenshots + commentary.
- **`platformData` shape:**
  ```json
  {
    "kind": "thread",
    "tweets": ["hook tweet...", "payoff tweet...", "close tweet..."],
    "quoteOf": null,
    "mediaCard": { "type": "stat-card", "assetId": null }
  }
  ```
- **Composer:** a stack of tweet cards, not one textarea — live 280-char counter per card, reorderable, quote-tweet target picker.
- **Prompt scaffold:** hook (must stop the scroll, no throat-clearing) → one idea per tweet → explicit close/CTA tweet.

### TikTok Studio
- **What actually works:** hook inside 0–3 seconds, trending sound tied to discovery, on-screen text as a core element (not optional), duet/stitch/reaction formats.
- **`platformData` shape:**
  ```json
  {
    "kind": "script",
    "hookLine": "...",
    "beats": [{ "t": "0-3s", "action": "...", "onScreenText": "..." }],
    "soundId": null,
    "durationTargetSec": 30
  }
  ```
- **Composer:** vertical 9:16 storyboard timeline, one card per beat, trending-sound picker docked in the same panel (matched by pace/mood, not just popularity).
- **Prompt scaffold:** hook beat (earns the next 3 seconds) → body beats (one idea each) → CTA beat.

### Instagram Studio
- **What actually works:** two distinct native shapes — Reels (polished, sound-driven, close cousin of TikTok) and **carousels**, which are the platform's real "explainer" format: swipeable, one point per slide, cover slide decides whether anyone swipes at all.
- **`platformData` shape:**
  ```json
  {
    "kind": "carousel",
    "coverHook": "...",
    "slides": [{ "headline": "...", "body": "...", "template": "list-item" }]
  }
  ```
  (Reels reuse the TikTok `script` shape with `kind: "reel"`.)
- **Composer:** slide-deck grid, drag to reorder, cover-hook pulled into its own field since it does different work than the rest of the deck.
- **Prompt scaffold:** cover hook → one clear point per slide → save-worthy close slide ("save this for later").

### Facebook Studio
- **What actually works:** longer, conversational posts; shares and comments matter more than likes; explicit discussion prompts outperform passive statements; groups are where the real engagement lives.
- **`platformData` shape:**
  ```json
  {
    "kind": "post",
    "body": "...",
    "linkCard": { "url": null, "title": null },
    "discussionPrompt": "What's your take?"
  }
  ```
- **Composer:** plain longer-form editor, group/page target picker, `discussionPrompt` as its own first-class field — not buried at the end of the body text.
- **Prompt scaffold:** conversational tone → context/explanation → an explicit question, since the algorithm rewards comments specifically.

### YouTube Studio
- **What actually works:** title and thumbnail are designed as one unit and iterated together; long-form is SEO/retention-driven; Shorts behave like TikTok but are keyword-tagged for YouTube search.
- **`platformData` shape:**
  ```json
  {
    "kind": "long-form",
    "titleOptions": ["...", "..."],
    "thumbnailConcepts": ["concept description..."],
    "chapters": [{ "time": "0:00", "label": "Intro" }]
  }
  ```
  (Shorts reuse the TikTok `script` shape plus a `keywords` array.)
- **Composer:** title/thumbnail workshop showing 2–3 paired concepts side by side (never generated separately), script editor with chapter markers.
- **Prompt scaffold:** retention-hook cold open → promise → chaptered body → CTA. Shorts variant borrows TikTok's beat structure.

---

## 2. Trend → platform-native format pipeline

The creative core of "if it's trending, show it the way that platform actually shows things": one detected trend, fanned out through five prompt templates that each already know their platform's native shape from §1.

**Flow:**
1. A `TrendEvent` is detected (mock trend adapter for now, per ARCHITECTURE.md §10 — real trend sources later) and classified by `velocity` (breaking / rising / steady) and `depth` (quick-hit vs. explainer-worthy).
2. `modules/trends/pipeline.ts` fans the event out to each Studio's own `modules/ai/prompts/<studio>/trend-response.ts` template — this is the same orchestrator from §9, just triggered by trend velocity instead of a manual prompt.
3. Each Studio returns a draft in its native `platformData` shape (thread + stat card for X, reaction script + sound match for TikTok, carousel for Instagram, community post + discussion prompt for Facebook, Shorts-or-long-form depending on `depth` for YouTube).
4. All five drafts land in one **Trend Response review screen** — reusing the same review-before-save pattern as the Universal AI Assistant's repurpose flow (§9 / Phase 4) — so nothing auto-publishes; it auto-*drafts*.

**New models** (append to `prisma/schema.prisma`; add `trendEvents TrendEvent[]` to `Organization`):
```prisma
model TrendEvent {
  id         String   @id @default(cuid())
  orgId      String
  topic      String
  summary    String
  sourceUrl  String?
  velocity   String   // "breaking" | "rising" | "steady"
  depth      String   // "quick-hit" | "explainer-worthy"
  detectedAt DateTime @default(now())

  org       Organization    @relation(fields: [orgId], references: [id], onDelete: Cascade)
  responses TrendResponse[]

  @@index([orgId, detectedAt])
  @@map("trend_events")
}

model TrendResponse {
  id           String   @id @default(cuid())
  trendEventId String
  platform     Platform
  draftPostId  String?  // set once the draft is reviewed and saved as a real Post
  createdAt    DateTime @default(now())

  trendEvent TrendEvent @relation(fields: [trendEventId], references: [id], onDelete: Cascade)

  @@map("trend_responses")
}
```

**New route:** `POST /api/trends/respond` — takes a `trendEventId`, runs the fan-out, returns all five drafts for the review screen.

---

## 3. What's realistic now vs. a bigger lift later

- **Template-rendered image cards** (X stat cards, Instagram cover slides, YouTube thumbnail concepts): build now. These render from a template (SVG/HTML → image) styled by the org's Brand Voice and Asset Library — no video-generation dependency, no new external service.
- **Full automated video** (assembled b-roll, voiceover, burned-in captions): a genuinely separate, harder capability — it needs a video-generation or stock-footage API, TTS, and an editing/rendering pipeline, none of which are in the current stack. Recommend shipping script + shot-list + trending-sound-match for TikTok/Reels/Shorts (already in scope per the original brief) rather than assuming rendered video comes with it. Worth its own architecture pass if/when it's actually prioritized.

---

## 4. Checklist deltas (fold into `PROGRESS.md`)

- **Phase 2 (X Studio):** composer is a tweet-card stack, not a textarea; Thread Builder enforces hook → payoff → close.
- **Phase 3 (remaining Studios):** each gets its native composer — TikTok storyboard timeline, Instagram slide-deck grid, Facebook post+discussion-prompt layout, YouTube title/thumbnail workshop — instead of one shared generic form.
- **New, extends Phase 4:** Trend Response pipeline (`TrendEvent`/`TrendResponse` models, `/api/trends/respond`, the five-draft review screen).
