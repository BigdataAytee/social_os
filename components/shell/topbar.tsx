import { Bell, Search } from "lucide-react";

import { MobileNav } from "@/components/shell/mobile-nav";
import { UserMenu } from "@/components/shell/user-menu";
import { AIPanelToggle } from "@/components/shell/ai-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Session } from "@/lib/auth/session";

/**
 * Topbar. The ⌘K trigger is present but inert until Phase 1 builds the command
 * palette — it's here so the shell's proportions are settled now.
 */
export function Topbar({
  session,
  unreadCount,
}: {
  session: Session;
  unreadCount: number;
}) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-surface px-3 sm:px-4">
      <MobileNav />

      <button
        type="button"
        disabled
        className="group flex h-8 max-w-xs flex-1 items-center gap-2 rounded-md border border-border bg-surface-raised px-3 text-left text-sm text-muted transition-colors disabled:cursor-default"
      >
        <Search className="h-3.5 w-3.5" />
        <span className="flex-1 truncate">Search or jump to…</span>
        <kbd className="hidden rounded-sm border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted sm:inline">
          ⌘K
        </kbd>
      </button>

      <div className="flex flex-1 items-center justify-end gap-1.5">
        <Badge variant="default" className="hidden md:inline-flex">
          {session.role}
        </Badge>

        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ""}`}
        >
          <Bell />
          {unreadCount > 0 && (
            <span className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 font-mono text-[9px] font-medium text-accent-contrast">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </Button>

        <AIPanelToggle />
        <UserMenu session={session} />
      </div>
    </header>
  );
}
