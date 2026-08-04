"use client";

import { createContext, useContext, useMemo, useState } from "react";
import { PanelRight, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The global AI panel.
 *
 * Phase 0 ships the slot and the toggle only — Phase 1 makes it resizable and
 * Phase 4 wires it to /api/ai/chat (ARCHITECTURE.md §9). It lives in the shell
 * rather than per-page because the assistant is global by design: it can act on
 * whatever Studio you're in.
 */

type AIPanelContext = { open: boolean; toggle: () => void };

const Context = createContext<AIPanelContext | null>(null);

function useAIPanel() {
  const ctx = useContext(Context);
  if (!ctx) throw new Error("useAIPanel must be used inside <AIPanelProvider>");
  return ctx;
}

export function AIPanelProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const value = useMemo(
    () => ({ open, toggle: () => setOpen((v) => !v) }),
    [open]
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function AIPanelToggle() {
  const { open, toggle } = useAIPanel();
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggle}
      aria-pressed={open}
      aria-label={open ? "Hide AI panel" : "Show AI panel"}
      className={cn(open && "bg-surface-raised text-primary")}
    >
      <PanelRight />
    </Button>
  );
}

const CAPABILITIES = [
  "Draft a post in your brand voice",
  "Repurpose one idea into all five Studios",
  "Schedule to the next open calendar slot",
  "Explain what moved this week's numbers",
];

export function AIPanel() {
  const { open } = useAIPanel();

  return (
    <aside
      aria-label="AI assistant"
      aria-hidden={!open}
      className={cn(
        "hidden shrink-0 flex-col border-l border-border bg-surface transition-[width] duration-base ease-emphasized xl:flex",
        open ? "w-80" : "w-0 overflow-hidden border-l-0"
      )}
    >
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4">
        <Sparkles className="h-4 w-4 text-accent" />
        <span className="font-display text-sm font-medium text-primary">
          Assistant
        </span>
      </div>

      <div className="flex flex-1 flex-col justify-between gap-6 p-4">
        <div className="flex flex-col gap-3">
          <p className="text-sm text-secondary">
            The assistant works across every Studio and can act on your content,
            not just talk about it.
          </p>
          <ul className="flex flex-col gap-2">
            {CAPABILITIES.map((item) => (
              <li
                key={item}
                className="rounded-md border border-border bg-surface-raised px-3 py-2 text-sm text-secondary"
              >
                {item}
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-md border border-dashed border-border px-3 py-2.5">
          <p className="font-mono text-[10px] uppercase tracking-wider text-muted">
            Phase 4
          </p>
          <p className="text-xs text-muted">
            Chat and tool-calling land here. See PROGRESS.md.
          </p>
        </div>
      </div>
    </aside>
  );
}
