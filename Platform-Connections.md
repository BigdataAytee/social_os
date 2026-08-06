# SocialOS — Platform Connections: OAuth, Token Storage & Integration Path (addendum to ARCHITECTURE.md)

Read alongside `ARCHITECTURE.md` §10 (`PlatformAdapter` interface) and `Growth-Strategist-Engine.md`. This is what "connect your account" actually has to do once it's not a mock anymore — the login flow, where the resulting tokens live, and the decision between building five direct integrations or one unified one.

**Facts below are current as of August 2026 and move fast** — X changed its entire pricing model in February 2026, three times in three years. Re-verify against each platform's official docs (`developer.x.com`, `developers.tiktok.com`, `developers.facebook.com`, `developers.google.com/youtube`) before finalizing scope or budget, rather than trusting this file as a permanent source of truth.

---

## 1. Platform reality, in one table

| Platform | Cost | Gate before it works for real users | Token lifetime |
|---|---|---|---|
| X | Pay-per-use by default: ~$0.015/post written, ~$0.005/post read, capped at 2M reads/mo. No meaningful free tier for new developers. | Developer account + app, billing attached. No audit, but real ongoing cost per read/write. | OAuth 2.0, access tokens expire; refresh required |
| TikTok | Free (no per-call fee) | Manual app audit before public posting — commonly weeks, not days. Unaudited apps can only post privately. | Access token 24h, refresh token 365 days — refresh job is mandatory, not optional |
| Instagram | Free | Account must be Business/Creator, linked to a Facebook Page. Meta App Review + Business Verification + screencast demo required for real users. | Long-lived tokens (~60 days), refreshed before expiry |
| Facebook | Free | Same Meta App Review path as Instagram, via a linked Page. | Same as Instagram |
| YouTube | Free (quota-based, not per-call) | Google Cloud project + OAuth consent screen verification. No manual "audit" in the TikTok/Meta sense, but quota (10,000 units/day default) caps daily volume — uploads are the expensive operation. | Refresh tokens are long-lived once granted |

**Read the table as:** X costs money from the first call but has the lightest process gate; TikTok and Meta cost nothing but gate you behind a review queue before it works for anyone but your own test accounts; YouTube sits in between — free, but volume-capped by quota rather than money or a review.

---

## 2. The connect flow (same shape regardless of which integration path you pick)

1. User clicks "Connect X / TikTok / Instagram / Facebook / YouTube" from Settings or a Studio, having picked (or defaulted into) a mode — see §4.
2. Branch on `integrationMode`:
   - **`direct`:** server builds that platform's own OAuth authorization URL (client ID, requested scopes, a signed `state` parameter for CSRF protection, redirect URI) and redirects the user to the platform's own consent screen.
   - **`unified`:** server redirects into the provider's own hosted connect flow for that platform instead — the provider has already done the platform's OAuth dance on their end; you're just initiating their flow, not building the platform's auth URL yourself.
3. User approves on the platform's own site either way — **never inside an iframe or a screen that looks like SocialOS**, since every platform's terms require the consent screen to be their own, unmodified UI (true whether the platform's screen is reached directly or via the provider).
4. Callback returns to your app: `/api/auth/callback/:platform` with an authorization code (direct mode), or the provider calls back / redirects with its own account reference (unified mode).
5. Server does the exchange server-side only — never in the browser — resulting in either a real platform token pair (direct) or a provider-issued account reference (unified).
6. Result is encrypted and stored (§3), `ConnectedAccount.integrationMode` is set, and `status` flips from `MOCK` to `CONNECTED`.
7. A background job immediately does a first `fetchAnalytics()` pull through whichever adapter is now active, so the account isn't sitting empty until the next scheduled sync.

---

## 3. Where the tokens actually live

The base schema deliberately kept `ConnectedAccount.meta` as display-only fields and said not to put raw tokens there — here's the actual answer.

**Add a dedicated, tightly-scoped table, encrypted at the column level:**
```prisma
model PlatformCredential {
  id                String   @id @default(cuid())
  connectedAccountId String  @unique
  accessTokenEnc    String   // encrypted, never selected in normal queries
  refreshTokenEnc   String?
  expiresAt         DateTime?
  updatedAt         DateTime @updatedAt

  connectedAccount ConnectedAccount @relation(fields: [connectedAccountId], references: [id], onDelete: Cascade)

  @@map("platform_credentials")
}
```
- Encrypt `accessTokenEnc`/`refreshTokenEnc` with a key held outside the database (Supabase Vault, or a KMS-backed encryption key in an env var never checked into the repo) — the DB should never hold a usable token even if it leaks.
- This table is queried from exactly one place: the adapter layer (`modules/integrations/*`) when it needs to make an authenticated call. No route handler outside that layer should ever read it directly.
- A background job (`modules/integrations/refresh.ts`) runs on a schedule, refreshes any credential expiring soon, and flips `ConnectedAccount.status` to `ERROR` if a refresh fails — surfaced to the user as "reconnect this account," not a silent failure.
- **What actually sits in these columns differs by mode.** For `direct` accounts, it's the real platform access/refresh token pair, and your own refresh job is responsible for keeping it alive. For `unified` accounts, it's the provider's own account/profile reference key — still sensitive (it authorizes actions via the provider on the user's behalf, so it's encrypted the same way), but token refresh becomes the provider's problem, not yours.

**Add to the base schema**, on `ConnectedAccount`:
```prisma
enum IntegrationMode {
  DIRECT
  UNIFIED
}
```
```prisma
integrationMode IntegrationMode? // null while status is MOCK; set the moment a real connection is made
```

---

## 4. Both paths, coexisting — chosen per platform, not a one-time global decision

Direct and unified aren't mutually exclusive; they're two implementations of the same `PlatformAdapter` interface, and which one runs for a given account is just a stored field. Nothing above the adapter layer (Studios, native content shapes, the Growth Strategist) can tell the difference — they only ever see the `PlatformAdapter` interface, never which concrete class answered it.

**Direct integration** — build a platform's real `PlatformAdapter` against its native API, going through that platform's own review process (§1). Full control, no vendor, no per-account fee to a third party — but you carry X's per-call cost, TikTok's/Meta's review queues, and each platform's own quirks (chunked uploads, differing token lifetimes, differing rate-limit shapes) yourself.

**Unified provider** — several companies already hold the platform approvals and expose one API + one connect flow across all five networks (Ayrshare is the longest-established; newer entrants include Blotato, Zernio, and Postproxy). A user connecting an account goes through the provider's already-approved flow instead of waiting on your own app's audit. Real tradeoffs, not fine print: the provider holds your users' social tokens, not you — worth being explicit about in your own privacy policy — you pay per connected account or per month, and you inherit their rate limits and outages. Treat any single provider's own comparison claims about competitors skeptically, since that's exactly what most of what's written about them is.

**The registry that lets both live side by side:**
```ts
// modules/integrations/registry.ts
export function getAdapter(platform: Platform, mode: IntegrationMode | null): PlatformAdapter {
  if (!mode) return mockAdapters[platform];              // status still MOCK
  if (mode === 'UNIFIED') return unifiedAdapter;          // one instance, platform passed per call
  return directAdapters[platform];                        // only populated for platforms you've built
}
```
Every service-layer call resolves the adapter per `ConnectedAccount`, not globally — `getAdapter(account.platform, account.integrationMode)`. That's what makes mixing real: X on `direct` (worth it if X is central enough to your product to justify its per-call cost at volume) while TikTok, Instagram, Facebook, and YouTube stay on `unified` (fast to launch, no audit queue) is just four accounts with one field set differently, not a fork in the codebase.

**Where the choice lives — build this as a real, user-facing choice, not a hardcoded default.** Each platform's connection card in Settings shows a "Connection type" selector with three options, so the org picks per platform:
- **Mock** — instant, no real account needed. Good for demoing or testing before going live.
- **Unified** — connect immediately through the provider's already-approved flow.
- **Direct** — full control, but only selectable once that platform's own integration has been built and approved; shown greyed-out with a tooltip explaining why until then, not hidden entirely, so it's clear the option exists and what's blocking it.

Switching an already-connected account's mode is an explicit reconnect (disconnect, then connect again under the new mode), not a silent background migration — it changes who's holding the credential, and the org should always know that's happening.

**Recommendation either way:** default new connections to `unified` so the product posts and pulls real data from day one instead of blocking on TikTok/Meta review queues. Move a specific platform to `direct` when it earns it.

---

## 5. Where this closes the loop with what's already built

Once a real adapter's `fetchAnalytics()` returns real numbers instead of the mock adapter's seeded data, nothing else needs to change: `AnalyticsSnapshot` rows land the same way, `StrategyRecommendation` recomputes against them the same way (`Growth-Strategist-Engine.md` §2), and the composer's engagement-prediction badge starts reasoning over real history instead of demo data. The adapter boundary is exactly what makes this a data-source swap, not a rebuild.

## 6. Checklist deltas

- **New, before Phase 3 (or as a parallel track):** add `IntegrationMode` + the registry in §4, build the unified adapter first (fastest path to real data on all five), add direct adapters per platform opportunistically — this can happen alongside Phase 2/3 rather than blocking them, since the mock adapter keeps the UI fully functional either way.
- **Settings UI item:** per-platform connection card shows current mode and a reconnect action; whether the mode choice itself is user-facing or a fixed default is a product decision, not a technical one — the registry supports either.
- **Security review item, not a phase-gate:** confirm `PlatformCredential` encryption is in place and no token/provider-reference ever appears in logs, error messages, or client-side network responses before any real account gets connected.
