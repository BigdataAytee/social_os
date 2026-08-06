"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { IntegrationMode, type Platform } from "@prisma/client";
import { Check, Info, Link2, Loader2, Unlink } from "lucide-react";
import { toast } from "sonner";

import {
  connectUnifiedAction,
  setAccountLocaleAction,
  setConnectionModeAction,
} from "@/app/actions/connections";
import { disconnectAccountAction } from "@/app/actions/integrations";
import { PlatformDot } from "@/components/content/platform-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * One platform's connection card, with the three-way mode selector
 * (Platform-Connections.md §4).
 *
 * Every option is *shown*, including ones that can't be picked — §4 is explicit
 * that Direct should be greyed out with an explanation rather than hidden, so
 * it's clear the option exists and what's blocking it. That reasoning applies
 * equally to Unified, so both carry their reason.
 */

export type ConnectionCardData = {
  id: string;
  platform: Platform;
  label: string;
  handle: string;
  status: string;
  integrationMode: IntegrationMode | null;
  connected: boolean;
  lastSyncAt: string | null;
  lastSyncError: string | null;
  timezone: string | null;
  region: string | null;
  language: string | null;
  /** Reading the provider's primary profile rather than a per-workspace one. */
  unifiedPrimary: boolean;
};

export type ModeOption = {
  mode: IntegrationMode | null;
  available: boolean;
  reason: string | null;
};

const COPY: Record<string, { label: string; blurb: string }> = {
  MOCK: {
    label: "Mock",
    blurb: "Seeded demo data. No real account needed — good for demoing or testing before going live.",
  },
  UNIFIED: {
    label: "Unified",
    blurb:
      "Connect through a provider that already holds each platform's approval. Skips TikTok's audit queue and Meta's app review, and publishes for real.",
  },
  DIRECT: {
    label: "Direct",
    blurb:
      "This app's own OAuth app for the platform. Full control and no third party holding your tokens — but you carry that platform's cost and its own review.",
  },
};

function keyOf(mode: IntegrationMode | null) {
  return mode ?? "MOCK";
}

export function ConnectionCard({
  account,
  options,
  canManage,
  directIsReadOnly,
  studioSlug,
}: {
  account: ConnectionCardData;
  options: ModeOption[];
  canManage: boolean;
  /**
   * Direct reads real data but can't publish — its OAuth scopes are read-only.
   * Stated on the card rather than hidden, because picking it expecting to
   * publish is the surprise worth preventing.
   */
  directIsReadOnly: boolean;
  studioSlug: string;
}) {
  const router = useRouter();
  const [reference, setReference] = useState("");
  const [pending, startTransition] = useTransition();

  const current = account.integrationMode;

  // Only hoisted when *one* reason blocks *every* real mode. Two different
  // reasons — no TikTok app and no provider key — are two separate things to
  // fix, and collapsing them would hide one of them.
  const blocked = options.filter(
    (option) => option.mode !== null && !option.available
  );
  const realModes = options.filter((option) => option.mode !== null).length;
  const blockedReason =
    blocked.length === realModes &&
    blocked.length > 0 &&
    blocked.every((option) => option.reason === blocked[0]!.reason)
      ? blocked[0]!.reason
      : null;

  function choose(mode: IntegrationMode | null) {
    if (mode === current) return;
    startTransition(async () => {
      const result = await setConnectionModeAction({
        accountId: account.id,
        platform: account.platform,
        mode,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      if (result.data.kind === "reconnect-required") {
        toast.message(
          `Disconnected from ${COPY[result.data.previous]!.label}. Connect again to finish switching.`
        );
      } else {
        toast.success(`Set to ${COPY[keyOf(mode)]!.label}`);
      }
      router.refresh();
    });
  }

  /**
   * One click when a reference isn't needed, which is the common case.
   *
   * The provider's API key alone answers for its primary profile, so a single
   * brand doesn't need to know what a profile key is. Passing an empty
   * reference is the signal; the server decides whether that's safe and refuses
   * with a reason if another workspace already holds the primary profile.
   */
  function connectUnified() {
    startTransition(async () => {
      const result = await connectUnifiedAction({
        accountId: account.id,
        platform: account.platform,
        accountReference: reference.trim() || undefined,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setReference("");
      toast.success(
        result.data.synced > 0
          ? `Connected — pulled ${result.data.synced} posts`
          : "Connected"
      );
      router.refresh();
    });
  }

  function disconnect() {
    startTransition(async () => {
      const result = await disconnectAccountAction({
        accountId: account.id,
        platform: account.platform,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`Disconnected ${result.data.handle}`);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center gap-3">
        <PlatformDot platform={account.platform} />
        <span className="w-20 shrink-0 text-sm text-primary">{account.label}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted">
          {account.handle}
        </span>
        <Badge
          variant={
            account.status === "ERROR"
              ? "danger"
              : account.connected
                ? "accent"
                : "default"
          }
        >
          {account.status === "ERROR" ? "Needs attention" : account.status}
        </Badge>
        {account.connected && canManage && (
          <Button size="sm" variant="ghost" disabled={pending} onClick={disconnect}>
            <Unlink />
            Disconnect
          </Button>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted">
          Connection type
        </span>

        {/*
          When one missing thing blocks every real option — almost always
          SOCIALOS_ENCRYPTION_KEY, which gates both modes on every platform —
          the same sentence appeared three times in 10px warning text inside
          three greyed-out buttons. That reads as decoration, not as an
          instruction, and the reported symptom was "the selection is not
          working": the card looked broken rather than unconfigured. Said once,
          at full size, above the thing it disables.
        */}
        {blockedReason && (
          <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 p-3">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden />
            <div className="flex min-w-0 flex-col gap-1">
              <p className="text-xs text-primary">
                Real connections are switched off. {blockedReason}
              </p>
              <p className="text-[11px] text-muted">
                Add it under Vercel → Settings → Environment Variables, then
                redeploy. Until then Mock is the only option, and it works
                normally with seeded data.
              </p>
            </div>
          </div>
        )}

        <div className="grid gap-2 sm:grid-cols-3">
          {options.map((option) => {
            const key = keyOf(option.mode);
            const copy = COPY[key]!;
            const active = option.mode === current;
            const disabled = !canManage || pending || !option.available;

            return (
              <button
                key={key}
                type="button"
                disabled={disabled}
                onClick={() => choose(option.mode)}
                // A disabled option still has to explain itself, so `title`
                // carries the reason rather than the option disappearing.
                title={option.reason ?? copy.blurb}
                className={cn(
                  "flex flex-col gap-1 rounded-md border px-3 py-2.5 text-left transition-colors",
                  active
                    ? "border-accent/50 bg-accent/10"
                    : "border-border bg-surface-raised",
                  disabled
                    ? "cursor-not-allowed opacity-50"
                    : "hover:border-border-strong"
                )}
              >
                <span className="flex items-center gap-1.5 text-sm text-primary">
                  {active && <Check className="h-3.5 w-3.5 text-accent" />}
                  {copy.label}
                </span>
                <span className="text-[11px] leading-snug text-muted">
                  {copy.blurb}
                </span>
                {/* Suppressed when the notice above already said it once. */}
                {!option.available && option.reason && !blockedReason && (
                  <span className="flex items-start gap-1 text-[11px] leading-snug text-warning">
                    <Info className="mt-0.5 h-3 w-3 shrink-0" />
                    {option.reason}
                  </span>
                )}
                {option.mode === IntegrationMode.DIRECT &&
                  option.available &&
                  directIsReadOnly && (
                    <span className="flex items-start gap-1 text-[10px] leading-snug text-warning">
                      <Info className="mt-0.5 h-2.5 w-2.5 shrink-0" />
                      Read-only: pulls posts and analytics for real, but
                      publishing still routes through the mock.
                    </span>
                  )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Connect affordance, shaped by the chosen mode. */}
      {canManage && current !== null && !account.connected && (
        <div className="flex flex-col gap-2 rounded-md border border-border bg-surface-raised px-3 py-2.5">
          {current === IntegrationMode.DIRECT ? (
            <>
              <p className="text-xs text-muted">
                Approve on {account.label}&rsquo;s own consent screen. Never
                inside SocialOS — every platform&rsquo;s terms require their own
                unmodified UI.
              </p>
              <Button asChild size="sm" className="self-start">
                <a href={`/api/oauth/${studioSlug}/start`}>
                  <Link2 />
                  Connect {account.label}
                </a>
              </Button>
            </>
          ) : (
            <>
              <p className="text-xs text-muted">
                Your provider key already covers {account.label}. Turn it on and
                SocialOS reads the account it holds — no OAuth round-trip, no
                platform review.
              </p>
              <Button
                size="sm"
                className="self-start"
                disabled={pending}
                onClick={connectUnified}
              >
                {pending ? <Loader2 className="animate-spin" /> : <Link2 />}
                Turn on {account.label}
              </Button>

              {/*
                Only for deployments running several workspaces off one provider
                account. Folded away because the one-click path is right for
                almost everyone, and a mandatory field nobody understands is how
                the previous version made this feel broken.
              */}
              <details className="mt-1">
                <summary className="cursor-pointer text-[11px] text-muted transition-colors hover:text-secondary">
                  Connecting a specific provider profile?
                </summary>
                <div className="mt-2 flex flex-col gap-1.5">
                  <p className="text-[11px] leading-snug text-muted">
                    Needed when more than one workspace shares this deployment —
                    without a profile key each would read the provider&rsquo;s
                    primary account and believe it was their own.
                  </p>
                  <div className="flex gap-2">
                    <Input
                      value={reference}
                      onChange={(event) => setReference(event.target.value)}
                      placeholder="Provider profile key"
                      className="font-mono text-xs"
                    />
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={pending || reference.trim().length === 0}
                      onClick={connectUnified}
                    >
                      Use this profile
                    </Button>
                  </div>
                </div>
              </details>
            </>
          )}
        </div>
      )}

      {canManage && account.connected && (
        <LocaleRow account={account} pending={pending} onSaved={() => router.refresh()} />
      )}

      {account.lastSyncError && (
        <p className="text-xs text-danger">{account.lastSyncError}</p>
      )}
      {account.connected && account.lastSyncAt && (
        <p className="font-mono text-[10px] text-muted">
          Last synced {new Date(account.lastSyncAt).toLocaleString()}
        </p>
      )}
      {!canManage && (
        <p className="text-xs text-muted">
          An admin or owner manages connections.
        </p>
      )}
    </div>
  );
}


/**
 * Where this account's audience is, and when.
 *
 * These three are not preferences — each one changes a number the app reports:
 *
 *   - **Timezone** decides what "best time to post: 14:00" means. Both the
 *     Studio panel and the Growth Strategist bucketed published posts by UTC
 *     hour and rendered the number bare, so that advice was wrong by the
 *     account's offset for everyone not on Greenwich.
 *   - **Region** scopes trend discovery. A trending topic is a local fact.
 *   - **Language** reaches the generation prompt, so drafts come back in the
 *     audience's language rather than the interface's.
 *
 * Per account rather than per workspace: an agency running a client's US TikTok
 * and UK Instagram needs a different answer for each.
 */
function LocaleRow({
  account,
  pending,
  onSaved,
}: {
  account: ConnectionCardData;
  pending: boolean;
  onSaved: () => void;
}) {
  const [timezone, setTimezone] = useState(account.timezone ?? "");
  const [region, setRegion] = useState(account.region ?? "");
  const [language, setLanguage] = useState(account.language ?? "");
  const [saving, startSaving] = useTransition();

  const dirty =
    timezone !== (account.timezone ?? "") ||
    region !== (account.region ?? "") ||
    language !== (account.language ?? "");

  function save() {
    startSaving(async () => {
      const result = await setAccountLocaleAction({
        accountId: account.id,
        timezone: timezone || null,
        region: region || null,
        language: language || null,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(
        result.data.timezone
          ? `Times now read in ${result.data.timezone}`
          : "Saved — times read in UTC"
      );
      onSaved();
    });
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-surface-raised px-3 py-2.5">
      <span className="font-mono text-[10px] uppercase tracking-wider text-muted">
        Audience
      </span>
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-muted">Timezone</span>
          <select
            value={timezone}
            onChange={(event) => setTimezone(event.target.value)}
            className="rounded-md border border-border bg-surface px-2 py-1.5 text-xs text-primary"
          >
            <option value="">UTC (default)</option>
            {TIMEZONES.map((zone) => (
              <option key={zone} value={zone}>
                {zone.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-muted">Region</span>
          <select
            value={region}
            onChange={(event) => setRegion(event.target.value)}
            className="rounded-md border border-border bg-surface px-2 py-1.5 text-xs text-primary"
          >
            <option value="">Worldwide</option>
            {REGIONS.map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-muted">Language</span>
          <select
            value={language}
            onChange={(event) => setLanguage(event.target.value)}
            className="rounded-md border border-border bg-surface px-2 py-1.5 text-xs text-primary"
          >
            <option value="">Brand voice decides</option>
            {LANGUAGES.map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          disabled={!dirty || saving || pending}
          onClick={save}
        >
          {saving && <Loader2 className="animate-spin" />}
          Save
        </Button>
        <span className="text-[11px] text-muted">
          Timezone decides what &ldquo;best time to post&rdquo; means. Region
          scopes trends. Language reaches the writer.
        </span>
      </div>
    </div>
  );
}

/**
 * A short list rather than the full IANA set.
 *
 * `Intl.supportedValuesOf("timeZone")` returns several hundred entries, which
 * is a worse control than thirty covering the zones a social team actually
 * works in. Anything missing can still be stored — the server validates against
 * the real database, so this list constrains the picker, not the field.
 */
const TIMEZONES = [
  "Africa/Lagos",
  "Africa/Nairobi",
  "Africa/Johannesburg",
  "Africa/Cairo",
  "Africa/Accra",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Toronto",
  "America/Mexico_City",
  "America/Sao_Paulo",
  "America/Bogota",
  "Europe/London",
  "Europe/Dublin",
  "Europe/Lisbon",
  "Europe/Madrid",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Amsterdam",
  "Europe/Warsaw",
  "Europe/Istanbul",
  "Europe/Moscow",
  "Asia/Dubai",
  "Asia/Karachi",
  "Asia/Kolkata",
  "Asia/Dhaka",
  "Asia/Bangkok",
  "Asia/Jakarta",
  "Asia/Singapore",
  "Asia/Hong_Kong",
  "Asia/Shanghai",
  "Asia/Tokyo",
  "Asia/Seoul",
  "Australia/Perth",
  "Australia/Sydney",
  "Pacific/Auckland",
];

const REGIONS: [string, string][] = [
  ["NG", "Nigeria"],
  ["GH", "Ghana"],
  ["KE", "Kenya"],
  ["ZA", "South Africa"],
  ["EG", "Egypt"],
  ["US", "United States"],
  ["CA", "Canada"],
  ["MX", "Mexico"],
  ["BR", "Brazil"],
  ["GB", "United Kingdom"],
  ["IE", "Ireland"],
  ["FR", "France"],
  ["DE", "Germany"],
  ["ES", "Spain"],
  ["IT", "Italy"],
  ["NL", "Netherlands"],
  ["PL", "Poland"],
  ["TR", "Turkey"],
  ["AE", "United Arab Emirates"],
  ["SA", "Saudi Arabia"],
  ["IN", "India"],
  ["PK", "Pakistan"],
  ["BD", "Bangladesh"],
  ["ID", "Indonesia"],
  ["SG", "Singapore"],
  ["PH", "Philippines"],
  ["JP", "Japan"],
  ["KR", "South Korea"],
  ["CN", "China"],
  ["AU", "Australia"],
  ["NZ", "New Zealand"],
];

const LANGUAGES: [string, string][] = [
  ["en-GB", "English (UK)"],
  ["en-US", "English (US)"],
  ["en-NG", "English (Nigeria)"],
  ["fr", "French"],
  ["es", "Spanish"],
  ["pt-BR", "Portuguese (Brazil)"],
  ["de", "German"],
  ["it", "Italian"],
  ["nl", "Dutch"],
  ["ar", "Arabic"],
  ["sw", "Swahili"],
  ["ha", "Hausa"],
  ["yo", "Yoruba"],
  ["ig", "Igbo"],
  ["hi", "Hindi"],
  ["id", "Indonesian"],
  ["ja", "Japanese"],
  ["ko", "Korean"],
  ["zh", "Chinese"],
];
