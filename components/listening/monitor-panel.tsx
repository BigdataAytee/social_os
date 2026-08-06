"use client";

import { useState, useTransition } from "react";
import { MentionSource, MonitorKind, Sentiment } from "@prisma/client";
import { Loader2, Plus, RadioTower, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  createMonitorAction,
  deleteMonitorAction,
  scanMonitorsAction,
  setMonitorActiveAction,
} from "@/app/actions/listening";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Section } from "@/components/ui/section";
import { cn } from "@/lib/utils";

/**
 * Monitors and their mentions (OS-ARCHITECTURE.md §11 stage 6).
 *
 * The footnote about *what* is being watched is load-bearing, not decoration.
 * Every listening tool on the market implies it watches the whole platform;
 * this one watches three specific corpora, and a user who believes otherwise
 * will conclude the feature is broken when a mention they saw elsewhere doesn't
 * appear here.
 */

type MonitorRow = {
  id: string;
  term: string;
  kind: MonitorKind;
  active: boolean;
  mentions: number;
  recent: number;
  negative: number;
};

type MentionRow = {
  id: string;
  monitorTerm: string;
  source: MentionSource;
  platform: string;
  authorHandle: string;
  text: string;
  permalink: string | null;
  sentiment: Sentiment;
  reach: number;
  publishedAt: string;
};

const SOURCE_LABEL: Record<MentionSource, string> = {
  INBOX: "someone said to you",
  OWN_POST: "you said",
  COMPETITOR: "a competitor said",
};

export function MonitorPanel({
  monitors,
  mentions,
  sentiment,
  canManage,
}: {
  monitors: MonitorRow[];
  mentions: MentionRow[];
  sentiment: { positive: number; neutral: number; negative: number; total: number };
  canManage: boolean;
}) {
  const [term, setTerm] = useState("");
  const [kind, setKind] = useState<MonitorKind>(MonitorKind.KEYWORD);
  const [selected, setSelected] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const visible = selected
    ? mentions.filter(
        (mention) =>
          mention.monitorTerm ===
          monitors.find((monitor) => monitor.id === selected)?.term
      )
    : mentions;

  function add(event: React.FormEvent) {
    event.preventDefault();
    const value = term.trim();
    if (!value) return;
    start(async () => {
      const result = await createMonitorAction({ term: value, kind });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setTerm("");
      toast.success(`Watching "${value}" — ${result.data.matched} matches so far`);
    });
  }

  function rescan() {
    start(async () => {
      const result = await scanMonitorsAction();
      toast[result.ok ? "success" : "error"](
        result.ok
          ? `${result.data.scanned} monitors, ${result.data.matched} matches`
          : result.error
      );
    });
  }

  return (
    <Section
      title="Monitors"
      description="Terms watched across your inbox, your own posts, and tracked competitors"
      action={
        canManage ? (
          <Button variant="ghost" onClick={rescan} disabled={pending}>
            {pending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <RadioTower className="h-4 w-4" aria-hidden />
            )}
            Rescan
          </Button>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-5">
        {canManage && (
          <form onSubmit={add} className="flex flex-wrap gap-2">
            <Input
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              placeholder="A brand, product, phrase or handle"
              aria-label="Term to watch"
              className="min-w-[12rem] flex-1"
            />
            <select
              value={kind}
              onChange={(event) => setKind(event.target.value as MonitorKind)}
              aria-label="What kind of term"
              className="rounded-md border border-border bg-surface px-3 text-sm text-primary"
            >
              <option value={MonitorKind.KEYWORD}>Keyword</option>
              <option value={MonitorKind.BRAND}>Our brand</option>
              <option value={MonitorKind.COMPETITOR}>A competitor</option>
            </select>
            <Button type="submit" disabled={pending || !term.trim()}>
              <Plus className="h-4 w-4" aria-hidden />
              Watch
            </Button>
          </form>
        )}

        {monitors.length === 0 ? (
          <p className="text-sm text-muted">
            Nothing watched yet. Start with your own brand name.
          </p>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            <li>
              <Chip active={selected === null} onClick={() => setSelected(null)}>
                Everything {mentions.length}
              </Chip>
            </li>
            {monitors.map((monitor) => (
              <li key={monitor.id} className="flex items-center gap-1">
                <Chip
                  active={selected === monitor.id}
                  onClick={() =>
                    setSelected(selected === monitor.id ? null : monitor.id)
                  }
                  dimmed={!monitor.active}
                >
                  {monitor.term} {monitor.mentions}
                  {monitor.negative > 0 && (
                    <span className="ml-1 text-danger">
                      · {monitor.negative} negative
                    </span>
                  )}
                </Chip>
                {canManage && (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        start(async () => {
                          const result = await setMonitorActiveAction({
                            id: monitor.id,
                            active: !monitor.active,
                          });
                          if (!result.ok) toast.error(result.error);
                        })
                      }
                      className="text-[10px] uppercase tracking-wider text-muted transition-colors hover:text-primary"
                    >
                      {monitor.active ? "pause" : "resume"}
                    </button>
                    <button
                      type="button"
                      aria-label={`Stop watching ${monitor.term}`}
                      onClick={() =>
                        start(async () => {
                          const result = await deleteMonitorAction({
                            id: monitor.id,
                          });
                          if (!result.ok) toast.error(result.error);
                        })
                      }
                      className="text-muted transition-colors hover:text-danger"
                    >
                      <Trash2 className="h-3 w-3" aria-hidden />
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}

        {sentiment.total > 0 && (
          <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3 text-xs">
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted">
              Sentiment
            </span>
            <span className="text-success">{sentiment.positive} positive</span>
            <span className="text-secondary">{sentiment.neutral} neutral</span>
            <span className="text-danger">{sentiment.negative} negative</span>
          </div>
        )}

        {visible.length > 0 && (
          <ul className="flex flex-col gap-2 border-t border-border pt-4">
            {visible.slice(0, 20).map((mention) => (
              <li
                key={mention.id}
                className="rounded-md border border-border bg-canvas p-3"
              >
                <div className="mb-1 flex flex-wrap items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-muted">
                  <Badge variant={sentimentVariant(mention.sentiment)}>
                    {mention.sentiment.toLowerCase()}
                  </Badge>
                  <span>{mention.authorHandle}</span>
                  <span>·</span>
                  <span>{SOURCE_LABEL[mention.source]}</span>
                  <span>·</span>
                  <span>{mention.platform}</span>
                  {mention.reach > 0 && (
                    <>
                      <span>·</span>
                      <span>{mention.reach.toLocaleString()} reach</span>
                    </>
                  )}
                </div>
                <p className="line-clamp-3 text-sm text-primary">{mention.text}</p>
                {mention.permalink && (
                  <a
                    href={mention.permalink}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="mt-1 inline-block text-xs text-secondary underline-offset-4 transition-colors hover:text-accent hover:underline"
                  >
                    Open
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}

        <p className="border-t border-border pt-3 text-xs text-muted">
          Monitors search three places: your engagement inbox, your own synced
          posts, and the competitors you track below. None of the five platforms
          offers open search on the permissions this app holds, so nothing here
          claims to see the whole platform.
        </p>
      </div>
    </Section>
  );
}

function Chip({
  active,
  dimmed = false,
  onClick,
  children,
}: {
  active: boolean;
  dimmed?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-full border px-3 py-1 text-xs transition-colors",
        active
          ? "border-accent/40 bg-accent/10 text-accent"
          : "border-border text-secondary hover:border-border-strong",
        dimmed && "opacity-50"
      )}
    >
      {children}
    </button>
  );
}

function sentimentVariant(sentiment: Sentiment) {
  if (sentiment === Sentiment.NEGATIVE) return "danger" as const;
  if (sentiment === Sentiment.POSITIVE) return "success" as const;
  return "default" as const;
}
