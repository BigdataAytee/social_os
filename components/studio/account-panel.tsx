"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Platform } from "@prisma/client";
import { Link2, Loader2, PlugZap, RefreshCw, Unlink } from "lucide-react";
import { toast } from "sonner";

import {
  disconnectAccountAction,
  syncAccountAction,
} from "@/app/actions/integrations";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Connection state for one Studio's platform.
 *
 * Deliberately compact and always present — an account that is connected should
 * cost one line, not a card. The expanded explanation only appears when
 * something needs doing.
 */

export type StudioAccount = {
  id: string;
  handle: string;
  status: string;
  connected: boolean;
  lastSyncAt: string | null;
  lastSyncError: string | null;
};

export function AccountPanel({
  platform,
  slug,
  accounts,
  canManage,
  connectAvailable,
  unavailableReason,
}: {
  platform: Platform;
  slug: string;
  accounts: StudioAccount[];
  canManage: boolean;
  connectAvailable: boolean;
  unavailableReason: string | null;
}) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const live = accounts.filter((a) => a.connected);

  function sync(accountId: string) {
    setPendingId(accountId);
    startTransition(async () => {
      const result = await syncAccountAction({ accountId, platform });
      setPendingId(null);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(
        `Pulled ${result.data.posts} post${result.data.posts === 1 ? "" : "s"}`
      );
      router.refresh();
    });
  }

  function disconnect(accountId: string) {
    setPendingId(accountId);
    startTransition(async () => {
      const result = await disconnectAccountAction({ accountId, platform });
      setPendingId(null);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`Disconnected ${result.data.handle}`);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-surface px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted">
          Account
        </span>

        {live.length === 0 ? (
          <span className="text-sm text-secondary">Not connected</span>
        ) : (
          live.map((account) => (
            <span key={account.id} className="flex items-center gap-2">
              <span className="text-sm text-primary">{account.handle}</span>
              <Badge variant={account.status === "ERROR" ? "danger" : "accent"}>
                {account.status === "ERROR" ? "Needs attention" : "Connected"}
              </Badge>
              <span className="font-mono text-[10px] text-muted">
                {account.lastSyncAt
                  ? `synced ${new Date(account.lastSyncAt).toLocaleDateString()}`
                  : "never synced"}
              </span>
            </span>
          ))
        )}

        <div className="ml-auto flex items-center gap-2">
          {live.map((account) => (
            <span key={account.id} className="flex items-center gap-1">
              <Button
                size="sm"
                variant="ghost"
                disabled={!canManage || pending}
                onClick={() => sync(account.id)}
              >
                {pending && pendingId === account.id ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <RefreshCw />
                )}
                Sync
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={!canManage || pending}
                onClick={() => disconnect(account.id)}
              >
                <Unlink />
                Disconnect
              </Button>
            </span>
          ))}

          {canManage && connectAvailable && (
            <Button asChild size="sm" variant={live.length ? "secondary" : "default"}>
              {/* A plain link, not an action: the browser has to end up on the
                  platform's consent screen, and the route sets the PKCE and
                  CSRF cookies on the redirect that takes it there. */}
              <a href={`/api/oauth/${slug}/start`}>
                <Link2 />
                {live.length ? "Connect another" : "Connect"}
              </a>
            </Button>
          )}
        </div>
      </div>

      {accounts.some((a) => a.lastSyncError) && (
        <p className="text-xs text-danger">
          {accounts.find((a) => a.lastSyncError)?.lastSyncError}
        </p>
      )}

      {!connectAvailable && unavailableReason && canManage && (
        <p className={cn("flex items-start gap-1.5 text-xs text-muted")}>
          <PlugZap className="mt-0.5 h-3 w-3 shrink-0" />
          {unavailableReason}
        </p>
      )}

      {!canManage && live.length === 0 && (
        <p className="text-xs text-muted">
          An admin or owner connects accounts.
        </p>
      )}
    </div>
  );
}
