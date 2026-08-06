# SocialOS — Growth Strategist Engine (addendum to ARCHITECTURE.md)

Read alongside `ARCHITECTURE.md` and `Platform-Native-Studios.md`. This gives real mechanism to features the original brief already named but didn't specify — "Best Posting Times," "Engagement Predictions," "AI Performance Recommendations," Dashboard "AI recommendations" — by turning them into one engine that actually reasons over the org's own data and updates as that data grows.

**Design stance, stated plainly:** this is a statistics-plus-LLM system, not a custom-trained model. A new org has no proprietary training data on day one, and standing up model-training infrastructure for that is disproportionate to the problem. Real numbers from the org's own `AnalyticsSnapshot`/`Post` history, recomputed as they grow, combined with the existing AI orchestrator for narrative synthesis, gets the "gets smarter over time" behavior honestly and cheaply. Don't build a training pipeline for this — build a recompute pipeline.

---

## 1. What it produces

Four outputs, all derived from data the app already has:

1. **Best posting times** — per connected account, computed from historical `AnalyticsSnapshot` + `Post.publishedAt`/engagement outcomes. Statistical, not AI-generated: literally "which past posting times correlated with above-average engagement for this account."
2. **Content-type ranking** — groups past posts by their native `platformData.kind` (thread vs. single tweet, carousel vs. reel, etc. — see `Platform-Native-Studios.md` §1) and compares average performance, so the Studio can say "carousels out-save your reels 3:1 this month."
3. **Weekly strategy briefing** — the one LLM-synthesis step in this system: takes (1) and (2), plus current `TrendEvent`s (from the trend pipeline addendum) and the org's `BrandVoice`, and produces a plain-language weekly plan: what to post, roughly when, and why.
4. **Engagement prediction on a draft** — before scheduling, score the specific draft against the account's own historical distribution. Output is a **band + reasoning**, never a fabricated precise percentage — see §3.

## 2. Data freshness & the "update accordingly" mechanism

- Every `StrategyRecommendation` row records `basedOnDataThrough` — the timestamp of the freshest data point it used — so the UI can honestly show "based on data through [date]" instead of implying real-time omniscience.
- **v1 trigger:** a nightly job recomputes recommendations for every org with new `AnalyticsSnapshot` or newly-`PUBLISHED` posts since the last run.
- **Later optimization:** replace blind nightly recompute with a staleness flag set whenever new relevant data lands, recomputed lazily the next time the org opens that Studio's strategy panel — cheaper once there are enough inactive orgs that nightly-for-everyone wastes compute. Not needed for v1.
- Recompute is deterministic and cheap for (1) and (2) — plain aggregation queries. Only (3) hits the LLM, and only once per org/platform/refresh, not per page view.

## 3. Cold start (no data yet)

New orgs and freshly-connected accounts have nothing to compute from. Don't show an empty panel or a fabricated recommendation — fall back to a static, hand-authored `platform-benchmarks.json` of general best practices per platform (e.g., "TikTok: near-daily posting outperforms bursty posting for new accounts; lead with the hook, not a logo intro"), and mark every recommendation's `confidence` as `"low"` with copy that says so plainly: *"Based on general best practices — this gets specific to your account after your first ~10 posts."* Confidence graduates to `"medium"`/`"high"` as real data accumulates (a straightforward sample-size threshold per platform is enough — no need to overengineer this).

**Engagement prediction shape** (returned by the API, not stored per-draft unless you want an audit trail):
```json
{
  "band": "above-average" | "typical" | "below-average" | "not-enough-data",
  "confidence": "low" | "medium" | "high",
  "reasoning": [
    "Threads outperform single tweets by ~40% on this account",
    "Similar hook style to your top 3 posts this month"
  ],
  "suggestions": [
    "Consider leading with a number in the hook",
    "Your Tue/Thu 8am slot gets 2x the replies of other times"
  ]
}
```

## 4. Data model

```prisma
model StrategyRecommendation {
  id                 String   @id @default(cuid())
  orgId              String
  platform           Platform
  type               String   // "best-time" | "content-type-ranking" | "weekly-briefing"
  payload            Json
  confidence         String   // "low" | "medium" | "high" — driven by sample size, not vibes
  basedOnDataThrough DateTime
  generatedAt        DateTime @default(now())

  org Organization @relation(fields: [orgId], references: [id], onDelete: Cascade)

  @@index([orgId, platform, type])
  @@map("strategy_recommendations")
}
```
(Add `strategyRecommendations StrategyRecommendation[]` to `Organization` in the base schema.)

Engagement prediction is computed on demand (`modules/strategy/predict.ts`) rather than persisted — it's cheap to recompute and a draft changes between predictions, so a stored copy would just go stale.

## 5. Service layer

```
modules/strategy/
  engine.ts        // recomputeBestTimes(accountId), recomputeContentTypeRanking(orgId, platform)
  briefing.ts       // generateWeeklyBriefing(orgId, platform) — the one LLM call, uses modules/ai/orchestrator.ts
  predict.ts         // predictEngagement(orgId, platform, draftPost) — on-demand, statistical + reasoning
  benchmarks.json     // static cold-start fallback content per platform
```

New routes:
- `GET /api/strategy/:platform` — current recommendations for a Studio (best times, content-type ranking, latest briefing)
- `POST /api/strategy/predict` — engagement prediction for a specific draft, called from the schedule modal before confirming

## 6. Where this shows up in the UI

- **Dashboard:** a "This Week's Strategy" card — top 3–5 recommendations across all platforms, replacing the placeholder "AI recommendations" widget from the base Dashboard spec with something backed by this engine.
- **Every Studio:** the "Best Posting Times" and "Engagement Predictions" panels (already named in the original brief, previously unspecified) now read from `StrategyRecommendation`; add a "Growth Briefing" panel showing the weekly narrative.
- **Composer / schedule modal, every Studio:** an inline prediction badge (§3 shape) shown before the user confirms scheduling — this is the "chosen given suggestion" moment: feedback on the specific draft, not just general advice.

## 7. Checklist deltas

- **Phase 2/3 (each Studio's composer):** add the inline engagement-prediction badge to the schedule modal.
- **Phase 7 (Analytics):** add `StrategyRecommendation` computation — best-time and content-type-ranking aggregation queries, cold-start benchmark fallback, nightly recompute job.
- **Phase 1 (Dashboard):** swap the placeholder "AI recommendations" widget for the real "This Week's Strategy" card once Phase 7's engine exists (can ship as a stub earlier, wired up properly once the engine lands).
