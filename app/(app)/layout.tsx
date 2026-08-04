import { AIPanel, AIPanelProvider } from "@/components/shell/ai-panel";
import { QueryProvider } from "@/components/providers/query-provider";
import { Sidebar } from "@/components/shell/sidebar";
import { StudioTheme } from "@/components/shell/studio-theme";
import { Topbar } from "@/components/shell/topbar";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { requireSession } from "@/lib/auth/session";
import { isModelConfigured } from "@/modules/ai/orchestrator";
import { countUnread } from "@/modules/notifications/service";

/**
 * The authenticated shell (ARCHITECTURE.md §6).
 *
 * Every route in this group renders inside it, so navigation never remounts the
 * sidebar or the AI panel.
 */

/**
 * Nothing in this group may be prerendered or cached: every page renders the
 * signed-in user's org, role and unread count. `requireSession()` reads cookies,
 * which already forces a dynamic render — this states the requirement outright
 * so it can't be lost to a future refactor that makes the layout look cacheable.
 */
export const dynamic = "force-dynamic";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireSession();
  const unreadCount = await countUnread(session);

  return (
    <QueryProvider>
      <TooltipProvider delayDuration={200}>
        <AIPanelProvider>
          <StudioTheme className="flex h-screen overflow-hidden bg-canvas">
            <Sidebar orgName={session.orgName} />

            <div className="flex min-w-0 flex-1 flex-col">
              <Topbar session={session} unreadCount={unreadCount} />
              <main className="flex-1 overflow-y-auto">{children}</main>
            </div>

            <AIPanel modelConfigured={isModelConfigured()} />
          </StudioTheme>
          <Toaster />
        </AIPanelProvider>
      </TooltipProvider>
    </QueryProvider>
  );
}
