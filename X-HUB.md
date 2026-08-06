# X Hub Intelligence Engine — audit and architecture

Companion to `OS-ARCHITECTURE.md`. Read that first for the layering rules this
follows: service layer owns Prisma, `orgId` always from session, adapters behind
one interface, nothing above the registry knows which implementation answered.

This document exists because the brief has one dependency that decides whether
each module is buildable, and it is worth stating once, precisely, rather than
discovering it eight screens in.

---

## 1. The dependency every module shares

Seven of the eight modules need **other people's public X content**:

| Module | Needs | Reachable today |
| --- | --- | --- |
| Savage Replies | replies to arbitrary tweets | ✗ needs search |
| News | tweets and videos about a topic | ✗ needs search |
| Gists | trending conversations | ✗ needs search |
| Trends | trending topics | ✗ endpoint retired on free tier |
| Viral Videos | trending creator videos | ✗ needs search |
| Creator Spotlight | arbitrary creators' recent posts | ~ by handle, not by discovery |
| Saved / Scheduled | our own rows | ✓ |
| Analytics | our own account | ✓ already built |

This app currently holds `tweet.read`, `users.read`, `offline.access` on X. Those
scopes are real and sufficient for reading *specified* content — a user timeline
by id, a tweet by id, mentions of the connected account. **They do not include
search**, because search is not a scope, it is an access tier: recent search
(`/2/tweets/search/recent`) and the trends endpoints sit behind X's paid tiers.
The free tier is write-oriented and grants no read search at all.

So "scan recent X posts, analyse replies, rank by humour" is not blocked by
missing code. It is blocked by an account decision.

**The Unified provider does not solve this.** Ayrshare reads and writes *your
own* connected accounts. It has no discovery surface — no search, no arbitrary
conversation reads. Nothing in this hub can be sourced through it.

### What this means for the build

Not "stop". It means the content source is a **seam**, not an assumption, and
everything above it gets built for real:

- All AI work — ranking replies, writing the story, explaining a trend,
  generating captions/memes/reels/threads/carousels — operates on
  `XPost[]` regardless of where those came from. That is the entire
  differentiator and none of it is blocked.
- All persistence, grouping, deduplication, infinite scroll, one-click actions
  and scheduling are ours.
- The source has one interface with three implementations: a mock that is
  deliberately rich enough to develop and demo against, a live X implementation
  that is honest about which calls its tier supports, and room for a third-party
  aggregator without touching anything above it.

The mock is not a placeholder for the UI's sake — it is the same shape the live
source returns, so switching is a registry entry.

### The decision this leaves with you

To make the discovery modules real, one of:

1. **X API paid tier.** Recent search plus trends. Highest fidelity, direct
   relationship, per-call cost. This is what the code is written against.
2. **A third-party X data provider.** Cheaper at volume, no tier negotiation,
   another party in the chain. Slots in as a second `XHubSource`.
3. **Ship the hub over your own account and the creators you name.** No search:
   Creator Spotlight works from handles you supply, and Savage Replies works over
   replies to *your* posts. Genuinely useful, and available on current scopes.

Option 3 works today with no spend, so the build targets it as the floor and
options 1–2 as the same code with a different source.

---

## 2. Data model

Three tables, added — nothing existing is changed.

```
XPost      one public X post, cached. Author, text, media, metrics, permalink,
           conversationId, replyToId. The evidence store; every module reads it.

XStory     a grouped narrative: NEWS | GIST | SAVAGE | TREND | VIDEO | CREATOR.
           Carries the AI-written summary, cover, topics, score, saved flag.
           This is what a card on the hub renders.

XStoryPost join, with a role (ORIGINAL | REPLY | EVIDENCE) and the per-reply
           scores. Grouping and dedupe live here.
```

Deliberately **not** added: a saved table, a scheduled table, an actions table.
Saving is a flag on `XStory`. Scheduling and every generate-action route through
the existing `createPost` / `generate` — the brief's one-click actions are new
buttons on old machinery, which is what keeps "the AI path is the real path"
true rather than forking a second content pipeline.

---

## 3. Ranking

`humour`, `roast`, `virality`, `engagement`, each 0–100, combined into one score.

**Engagement and virality are arithmetic**, from the metrics X reports: absolute
interactions, and interactions relative to the parent post's reach. Cheap,
exact, no model call.

**Humour and roast are a model call**, batched — one call scores up to twenty
replies, not one call each. They are genuinely judgements about language and
there is no lexicon that does them honestly; a rules-based "funny score" would
be a word count wearing a costume.

The fallback matters: with no model configured, humour and roast are null and
the ranking runs on the two arithmetic signals alone, labelled as such. A hub
that silently ranks by engagement while claiming to rank by humour is the
failure worth designing against.

---

## 4. Modules, in build order

1. **Foundation** — schema, `XHubSource` interface, mock source, ranking, hub
   shell with navigation. Nothing user-visible is claimed to work yet.
2. **Savage Replies** — the module that proves the whole spine: fetch, group,
   score, rank, render, act.
3. **Trends** — smallest new surface, reuses the existing trend adapter.
4. **Gists** — grouping plus AI captions, polls, hashtags.
5. **News** — cover, evidence, AI story, timeline, reactions. The most layout.
6. **Viral Videos + Creator Spotlight** — discovery over named handles.
7. **Saved / Scheduled / Analytics** — mostly wiring to what exists.

---

## 5. What "preserve the existing architecture" means here

The brief is explicit and it matches this codebase's standing rules:

- The hub is a route group under the existing shell, using the existing theme
  tokens, `Section`, `Badge`, `Button`, `EmptyState`. No new design system.
- Auth, session, roles and `orgId` scoping are untouched; every service call
  takes a `Session` like every other module.
- AI goes through `modules/ai/orchestrator`, so brand voice, the measured brand
  profile and history retrieval apply to a generated caption here exactly as
  they do in a Studio.
- Background work goes through the stage-1 job queue, not a new scheduler.
- The X Studio keeps its composer, insights and strategy panels. The hub is a
  sibling surface, not a replacement.
