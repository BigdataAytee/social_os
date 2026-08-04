import { Bell } from "lucide-react";

import { MobileNav } from "@/components/shell/mobile-nav";
import { SearchTrigger } from "@/components/shell/search-trigger";
import { UserMenu } from "@/components/shell/user-menu";
import { AIPanelToggle } from "@/components/shell/ai-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Session } from "@/lib/auth/session";

/** Topbar: search/⌘K, role, notifications, AI panel toggle and the user menu. */
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

      <SearchTrigger />

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
