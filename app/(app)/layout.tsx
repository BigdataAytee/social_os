import { AIPanel, AIPanelProvider } from "@/components/shell/ai-panel";
import { Sidebar } from "@/components/shell/sidebar";
import { StudioTheme } from "@/components/shell/studio-theme";
import { Topbar } from "@/components/shell/topbar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { requireSession } from "@/lib/auth/session";
import { db } from "@/lib/db";

/**
 * The authenticated shell (ARCHITECTURE.md §6).
 *
 * Every route in this group renders inside it, so navigation never remounts the
 * sidebar or the AI panel.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireSession();

  const unreadCount = await db.notification.count({
    where: { orgId: session.orgId, userId: session.userId, read: false },
  });

  return (
    <TooltipProvider delayDuration={200}>
      <AIPanelProvider>
        <StudioTheme className="flex h-screen overflow-hidden bg-canvas">
          <Sidebar orgName={session.orgName} />

          <div className="flex min-w-0 flex-1 flex-col">
            <Topbar session={session} unreadCount={unreadCount} />
            <main className="flex-1 overflow-y-auto">{children}</main>
          </div>

          <AIPanel />
        </StudioTheme>
      </AIPanelProvider>
    </TooltipProvider>
  );
}
