"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { PanelRight } from "lucide-react";

import { AssistantChat } from "@/components/assistant/assistant-chat";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The global AI panel (ARCHITECTURE.md §9).
 *
 * It lives in the shell rather than on a page because the assistant is global
 * by design: it can act on whichever Studio you're in. The chat inside is the
 * same component the /assistant route renders, wired to the same orchestrator —
 * there is no separate panel-only code path.
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

const MIN_WIDTH = 300;
const MAX_WIDTH = 640;

export function AIPanel({ modelConfigured }: { modelConfigured: boolean }) {
  const { open } = useAIPanel();
  const [width, setWidth] = useState(380);
  const dragging = useRef(false);

  // Drag-to-resize (Phase 1). Listeners live on window so the pointer can leave
  // the 4px handle mid-drag without the resize stopping.
  const onPointerDown = useCallback(() => {
    dragging.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  useEffect(() => {
    function onMove(event: PointerEvent) {
      if (!dragging.current) return;
      const next = window.innerWidth - event.clientX;
      setWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, next)));
    }
    function onUp() {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, []);

  return (
    <aside
      aria-label="AI assistant"
      aria-hidden={!open}
      style={{ width: open ? width : 0 }}
      className={cn(
        "relative hidden shrink-0 flex-col border-l border-border bg-surface xl:flex",
        !open && "overflow-hidden border-l-0"
      )}
    >
      {open && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize AI panel"
          onPointerDown={onPointerDown}
          className="absolute inset-y-0 left-0 z-10 w-1 cursor-col-resize bg-transparent transition-colors hover:bg-accent/40"
        />
      )}
      {open && <AssistantChat modelConfigured={modelConfigured} compact />}
    </aside>
  );
}
