import type { Metadata } from "next";

import { AssistantChat } from "@/components/assistant/assistant-chat";
import { PageHeader } from "@/components/shell/page-placeholder";
import { requireSession } from "@/lib/auth/session";
import { isModelConfigured, listGenerations } from "@/modules/ai/orchestrator";

export const metadata: Metadata = { title: "AI Assistant · SocialOS" };

/**
 * The full-page assistant (Phase 4). Same component as the side panel, same
 * orchestrator, same tools — there is no separate page-only path.
 */
export default async function AssistantPage() {
  const session = await requireSession();
  const history = await listGenerations(session, { take: 12 });

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-8 animate-fade-in">
      <PageHeader
        eyebrow="Workspace"
        title="AI Assistant"
        description="Works across every Studio and acts on your content — drafts, scheduling and repurposing write real rows."
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="h-[32rem] overflow-hidden rounded-lg border border-border bg-surface lg:col-span-2">
          <AssistantChat modelConfigured={isModelConfigured()} />
        </div>

        <div className="flex flex-col gap-3">
          <h2 className="font-display text-sm font-medium text-primary">
            Recent generations
          </h2>
          {history.length === 0 ? (
            <p className="text-sm text-muted">
              Nothing generated yet. Every generation is logged here.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {history.map((row) => (
                <li
                  key={row.id}
                  className="flex flex-col gap-1.5 rounded-md border border-border bg-surface px-3 py-2.5"
                >
                  <span className="flex items-center gap-2">
                    <span className="font-mono text-[10px] uppercase tracking-wider text-accent">
                      {row.type}
                    </span>
                    <span className="font-mono text-[10px] uppercase tracking-wider text-muted">
                      {row.studio}
                    </span>
                  </span>
                  <span className="line-clamp-2 text-xs text-secondary">
                    {row.output}
                  </span>
                  <span className="font-mono text-[10px] text-muted">
                    {row.user.name ?? row.user.email}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
