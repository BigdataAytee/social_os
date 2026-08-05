"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Platform } from "@prisma/client";
import { ArrowUp, Loader2, Sparkles, Wrench } from "lucide-react";
import { toast } from "sonner";

import { chatAction, repurposeAction } from "@/app/actions/ai";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { getStudio, STUDIOS } from "@/lib/studios";
import { cn } from "@/lib/utils";

/**
 * The assistant (ARCHITECTURE.md §9), rendered both in the side panel and on
 * /assistant. Tool calls run in the orchestrator against the service layer, so
 * "create a draft" here produces the same row the composer would.
 */

type Message = {
  role: "user" | "assistant";
  content: string;
  effects?: { name: string; summary: string; postIds: string[] }[];
  source?: "anthropic" | "local";
};

const SUGGESTIONS = [
  "Draft a post about our approval workflow for X",
  "What ideas do I have saved for TikTok?",
  "Turn our launch note into drafts for every Studio",
];

export function AssistantChat({
  modelConfigured,
  canGenerate,
  compact = false,
}: {
  modelConfigured: boolean;
  /** False for a VIEWER — the orchestrator refuses every call from them. */
  canGenerate: boolean;
  compact?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [pending, startTransition] = useTransition();
  const scrollRef = useRef<HTMLDivElement>(null);

  // The assistant knows which Studio you're looking at, so "write a post"
  // doesn't need you to name the platform.
  const studio = pathname.startsWith("/studio/")
    ? (getStudio(pathname.split("/")[2])?.platform ?? null)
    : null;

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, pending]);

  function send(text: string) {
    const content = text.trim();
    if (!content || pending) return;

    const next: Message[] = [...messages, { role: "user", content }];
    setMessages(next);
    setInput("");

    startTransition(async () => {
      const result = await chatAction({
        messages: next.map((m) => ({ role: m.role, content: m.content })),
        studio,
      });

      if (!result.ok) {
        toast.error(result.error);
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: `I couldn't do that: ${result.error}`,
          },
        ]);
        return;
      }

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: result.data.text || "Done.",
          effects: result.data.effects,
          source: result.data.source,
        },
      ]);

      // Tool calls wrote real rows — refresh so the queue and calendar catch up.
      if (result.data.effects.length > 0) router.refresh();
    });
  }

  function repurposeEverywhere() {
    const source = input.trim() || messages.at(-1)?.content;
    if (!source) {
      toast.error("Give me something to repurpose first");
      return;
    }

    startTransition(async () => {
      const result = await repurposeAction({
        input: source,
        platforms: STUDIOS.map((s) => s.platform as Platform),
      });

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      setMessages((prev) => [
        ...prev,
        { role: "user", content: `Repurpose this into every Studio:\n\n${source}` },
        {
          role: "assistant",
          content: result.data
            .map((r) => `**${r.platform}**\n${r.body}`)
            .join("\n\n"),
          effects: [
            {
              name: "repurposeContent",
              summary: `created ${result.data.length} drafts`,
              postIds: result.data.map((r) => r.postId),
            },
          ],
          source: result.data[0]?.source as "anthropic" | "local",
        },
      ]);
      setInput("");
      router.refresh();
      toast.success(`${result.data.length} drafts created — review them in each Studio`);
    });
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4">
        <Sparkles className="h-4 w-4 text-accent" />
        <span className="font-display text-sm font-medium text-primary">
          Assistant
        </span>
        {studio && (
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted">
            {getStudio(studio.toLowerCase())?.label ?? studio}
          </span>
        )}
        {!modelConfigured && (
          <span className="ml-auto rounded-sm border border-warning/30 bg-warning/10 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-warning">
            Offline
          </span>
        )}
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-secondary">
              I work across every Studio and can act on your content, not just
              talk about it — drafts, scheduling and repurposing all write real
              rows.
            </p>
            <div className="flex flex-col gap-2">
              {canGenerate && SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => send(s)}
                  className="rounded-md border border-border bg-surface-raised px-3 py-2 text-left text-sm text-secondary transition-colors hover:border-border-strong hover:text-primary"
                >
                  {s}
                </button>
              ))}
            </div>
            {!modelConfigured && (
              <p className="text-xs text-muted">
                No{" "}
                <code className="font-mono text-[11px] text-secondary">
                  ANTHROPIC_API_KEY
                </code>{" "}
                is set, so replies come from the offline writer. Tool calls still
                run for real.
              </p>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {messages.map((message, i) => (
              <div
                key={i}
                className={cn(
                  "flex flex-col gap-2",
                  message.role === "user" && "items-end"
                )}
              >
                <div
                  className={cn(
                    "max-w-[92%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm leading-relaxed",
                    message.role === "user"
                      ? "bg-accent/10 text-primary"
                      : "border border-border bg-surface-raised text-secondary"
                  )}
                >
                  {message.content}
                </div>

                {message.effects && message.effects.length > 0 && (
                  <div className="flex flex-col gap-1">
                    {message.effects.map((effect, j) => (
                      <span
                        key={j}
                        className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-accent"
                      >
                        <Wrench className="h-3 w-3" />
                        {effect.name} — {effect.summary}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {pending && (
              <Loader2 className="h-4 w-4 animate-spin text-muted" />
            )}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-border p-3">
        {!canGenerate ? (
          <p className="text-xs text-muted">
            Your role is read-only, so the assistant can&rsquo;t generate or act
            on content for you. Past generations are still visible.
          </p>
        ) : (
        <>
        <div className="flex items-end gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            rows={compact ? 2 : 3}
            placeholder="Ask for a draft, a schedule change, or an idea…"
            className="min-h-0 resize-none"
          />
          <Button
            size="icon"
            aria-label="Send"
            disabled={pending}
            onClick={() => send(input)}
          >
            {pending ? <Loader2 className="animate-spin" /> : <ArrowUp />}
          </Button>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="mt-2 w-full"
          disabled={pending}
          onClick={repurposeEverywhere}
        >
          <Sparkles />
          Repurpose into everything
        </Button>
        </>
        )}
      </div>
    </div>
  );
}
