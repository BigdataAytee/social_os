import type { Metadata } from "next";
import type { Platform } from "@prisma/client";

import {
  CapabilityPanel,
  type Capability,
} from "@/components/settings/capability-panel";
import { ConnectionCard } from "@/components/settings/connection-card";
import { PageHeader } from "@/components/shell/page-placeholder";
import { BrandBrainPanel } from "@/components/workspace/brand-brain-panel";
import { BrandVoiceForm } from "@/components/workspace/brand-voice-form";
import { Section } from "@/components/ui/section";
import { can } from "@/lib/auth/permissions";
import { requireSession } from "@/lib/auth/session";
import { studioForPlatform } from "@/lib/studios";
import { isEncryptionConfigured } from "@/lib/crypto";
import { isModelConfigured } from "@/modules/ai/orchestrator";
import {
  OAUTH_PROVIDERS,
  isPlatformConfigured,
} from "@/modules/integrations/oauth/providers";
import { isUnifiedConfigured } from "@/modules/integrations/unified/provider";
import { listAccounts } from "@/modules/integrations/oauth/service";
import {
  isDirectAvailable,
  modeAvailability,
} from "@/modules/integrations/registry";
import { getBrandProfile } from "@/modules/brandbrain/service";
import { getBrandVoice } from "@/modules/brandvoice/service";
import { memoryStats } from "@/modules/memory/service";

export const metadata: Metadata = { title: "Settings · SocialOS" };

export default async function SettingsPage() {
  const session = await requireSession();
  const [voice, accounts, profile, memory] = await Promise.all([
    getBrandVoice(session),
    listAccounts(session),
    getBrandProfile(session),
    memoryStats(session.orgId),
  ]);
  const canManage = can(session.role, "integration.manage");

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-6 py-8 animate-fade-in">
      <PageHeader
        eyebrow="Organization"
        title="Settings"
        description="Organization profile, connected accounts, and the brand voice that shapes every AI generation."
      />

      <Section title="Organization">
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-5">
          <Field label="Name" value={session.orgName} />
          <Field label="Slug" value={session.orgSlug} mono />
          <Field label="Your role" value={session.role} mono />
          <Field
            label="AI provider"
            value={
              isModelConfigured()
                ? "Claude (claude-opus-5)"
                : "Offline writer — set ANTHROPIC_API_KEY to use Claude"
            }
          />
        </div>
      </Section>

      <CapabilityPanel capabilities={capabilities(accounts.map((a) => a.platform))} />

      <Section
        title="Connected accounts"
        description="Pick a connection type per platform — the choice is stored per account, not globally"
      >
        <div className="flex flex-col gap-3">
          {accounts.map((account) => {
            const studio = studioForPlatform(account.platform);
            return (
              <ConnectionCard
                key={account.id}
                canManage={canManage}
                studioSlug={studio.slug}
                // Direct pulls real data but its scopes are read-only, so
                // publishing still falls back. Said on the card rather than
                // discovered after picking it.
                directIsReadOnly={isDirectAvailable(account.platform)}
                options={modeAvailability(account.platform)}
                account={{
                  id: account.id,
                  platform: account.platform,
                  label: studio.label,
                  handle: account.handle,
                  status: account.status,
                  integrationMode: account.integrationMode,
                  connected: account.connected,
                  lastSyncAt: account.lastSyncAt?.toISOString() ?? null,
                  lastSyncError: account.lastSyncError,
                  timezone: account.timezone,
                  region: account.region,
                  language: account.language,
                  unifiedPrimary: account.unifiedPrimary,
                }}
              />
            );
          })}
        </div>
      </Section>

      <BrandBrainPanel
        profile={profile}
        memory={memory}
        canEdit={can(session.role, "brandVoice.edit")}
      />

      <BrandVoiceForm
        canEdit={can(session.role, "brandVoice.edit")}
        initial={
          voice
            ? {
                tone: voice.tone,
                audience: voice.audience,
                emojiUsage: voice.emojiUsage as "none" | "light" | "heavy",
                ctaStyle: voice.ctaStyle,
                readingLevel: voice.readingLevel,
                avoidWords: voice.avoidWords,
              }
            : null
        }
      />
    </div>
  );
}

/**
 * Every capability that depends on configuration, and what its absence costs.
 *
 * Derived from the same helpers the registry and orchestrator use, so this
 * panel cannot claim a capability is live while the code paths behind it are
 * falling back. Only booleans reach the client — no values, and the names are
 * public documentation already.
 */
function capabilities(platforms: Platform[]): Capability[] {
  const list: Capability[] = [
    {
      name: "Encrypted credentials",
      configured: isEncryptionConfigured(),
      effect:
        "Gates every real connection on every platform. Without it, Mock is the only connection type that can be selected.",
      vars: ["SOCIALOS_ENCRYPTION_KEY"],
    },
    {
      name: "Unified connections",
      configured: isUnifiedConfigured(),
      effect:
        "Connect through a provider that already holds each platform's approval — and the only mode that can publish and reply for real.",
      vars: ["AYRSHARE_API_KEY"],
    },
    {
      name: "Claude",
      configured: isModelConfigured(),
      effect:
        "Real generation. Without it the app writes with a deterministic local fallback, labelled as such.",
      vars: ["ANTHROPIC_API_KEY"],
    },
    {
      name: "Scheduled background work",
      configured: Boolean(process.env.CRON_SECRET),
      effect:
        "Publishing scheduled posts, inbox pulls and the nightly relearn. Without a secret the cron endpoints refuse to run.",
      vars: ["CRON_SECRET"],
    },
  ];

  // One row per platform rather than a single "Direct" row: each needs its own
  // developer app, and a combined row would say "partly configured", which is
  // not something anyone can act on.
  for (const platform of [...new Set(platforms)]) {
    const provider = OAUTH_PROVIDERS[platform];
    list.push({
      name: `Direct — ${provider.label}`,
      configured: isPlatformConfigured(platform),
      effect: `Your own OAuth app for ${provider.label}. Reads real posts and analytics; publishing needs write scopes and that platform's review.`,
      vars: [provider.clientIdEnv, provider.clientSecretEnv],
    });
  }

  return list;
}

function Field({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="w-28 shrink-0 font-mono text-[10px] uppercase tracking-wider text-muted">
        {label}
      </span>
      <span
        className={`min-w-0 flex-1 text-sm text-primary ${mono ? "font-mono text-xs" : ""}`}
      >
        {value}
      </span>
    </div>
  );
}
