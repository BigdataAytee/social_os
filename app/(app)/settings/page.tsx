import type { Metadata } from "next";

import { ConnectionCard } from "@/components/settings/connection-card";
import { PageHeader } from "@/components/shell/page-placeholder";
import { BrandVoiceForm } from "@/components/workspace/brand-voice-form";
import { Section } from "@/components/ui/section";
import { can } from "@/lib/auth/permissions";
import { requireSession } from "@/lib/auth/session";
import { studioForPlatform } from "@/lib/studios";
import { isModelConfigured } from "@/modules/ai/orchestrator";
import { listAccounts } from "@/modules/integrations/oauth/service";
import {
  isDirectAvailable,
  modeAvailability,
} from "@/modules/integrations/registry";
import { getBrandVoice } from "@/modules/brandvoice/service";

export const metadata: Metadata = { title: "Settings · SocialOS" };

export default async function SettingsPage() {
  const session = await requireSession();
  const [voice, accounts] = await Promise.all([
    getBrandVoice(session),
    listAccounts(session),
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
                }}
              />
            );
          })}
        </div>
      </Section>

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
