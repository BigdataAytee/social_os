"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { IntegrationMode, type Platform } from "@prisma/client";
import { Check, Info, Link2, Loader2, Unlink } from "lucide-react";
import { toast } from "sonner";

import {
  connectUnifiedAction,
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

  function connectUnified() {
    startTransition(async () => {
      const result = await connectUnifiedAction({
        accountId: account.id,
        platform: account.platform,
        accountReference: reference,
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
                {!option.available && option.reason && (
                  <span className="flex items-start gap-1 text-[10px] leading-snug text-warning">
                    <Info className="mt-0.5 h-2.5 w-2.5 shrink-0" />
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
                Connect through the provider&rsquo;s own hosted flow, then paste
                the account reference it gives you back.
              </p>
              <div className="flex gap-2">
                <Input
                  value={reference}
                  onChange={(event) => setReference(event.target.value)}
                  placeholder="Provider account reference"
                  className="font-mono text-xs"
                />
                <Button
                  size="sm"
                  disabled={pending || reference.trim().length === 0}
                  onClick={connectUnified}
                >
                  {pending ? <Loader2 className="animate-spin" /> : <Link2 />}
                  Connect
                </Button>
              </div>
            </>
          )}
        </div>
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
