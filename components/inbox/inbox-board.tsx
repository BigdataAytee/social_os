"use client";

import { useMemo, useState, useTransition } from "react";
import { ConversationStatus, Platform, Sentiment } from "@prisma/client";
import {
  AtSign,
  Clock,
  Loader2,
  MessageSquare,
  RefreshCw,
  Send,
  Sparkles,
  UserPlus,
} from "lucide-react";
import { toast } from "sonner";

import {
  assignAction,
  replyAction,
  setStatusAction,
  suggestReplyAction,
  syncInboxAction,
} from "@/app/actions/inbox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { studioForPlatform } from "@/lib/studios";
import { cn } from "@/lib/utils";

/**
 * The inbox, as two panes (OS-ARCHITECTURE.md §11 stage 5).
 *
 * List on the left, thread on the right — the shape every inbox has, because
 * triage and answering are different activities and switching between them
 * shouldn't cost a page load.
 *
 * The ordering is the feature. It comes from the server already sorted by
 * priority, and this component never re-sorts: if the list disagreed with the
 * counts in the header, the header would be the thing people stopped trusting.
 */

export type ConversationRow = {
  id: string;
  platform: Platform;
  kind: "COMMENT" | "MENTION" | "DM";
  status: ConversationStatus;
  authorHandle: string;
  authorName: string | null;
  preview: string;
  sentiment: Sentiment;
  priority: number;
  band: "high" | "medium" | "low";
  unread: number;
  lastMessageAt: string;
  permalink: string | null;
  assignee: { id: string; name: string | null; email: string } | null;
  messageCount: number;
};

type Member = { id: string; name: string | null; email: string };

export function InboxBoard({
  conversations,
  counts,
  members,
  currentUserId,
  canReply,
  canManage,
}: {
  conversations: ConversationRow[];
  counts: { open: number; unread: number; mine: number; unassigned: number; high: number };
  members: Member[];
  currentUserId: string;
  canReply: boolean;
  canManage: boolean;
}) {
  const [filter, setFilter] = useState<"all" | "mine" | "unassigned" | "high">(
    "all"
  );
  const [selectedId, setSelectedId] = useState<string | null>(
    conversations[0]?.id ?? null
  );
  const [syncing, startSync] = useTransition();

  const visible = useMemo(() => {
    switch (filter) {
      case "mine":
        return conversations.filter((c) => c.assignee?.id === currentUserId);
      case "unassigned":
        return conversations.filter((c) => !c.assignee);
      case "high":
        return conversations.filter((c) => c.band === "high");
      default:
        return conversations;
    }
  }, [conversations, filter, currentUserId]);

  const selected =
    visible.find((c) => c.id === selectedId) ?? visible[0] ?? null;

  function sync() {
    startSync(async () => {
      const result = await syncInboxAction();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(
        `${result.data.conversations} conversations, ${result.data.messages} messages`
      );
      // Surfaced individually rather than folded into the success line: an
      // account that can't read its inbox is a standing fact someone needs to
      // act on, not a footnote to a successful sync.
      for (const note of result.data.notes) toast.warning(note);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          <Chip active={filter === "all"} onClick={() => setFilter("all")}>
            All {counts.open}
          </Chip>
          <Chip active={filter === "mine"} onClick={() => setFilter("mine")}>
            Mine {counts.mine}
          </Chip>
          <Chip
            active={filter === "unassigned"}
            onClick={() => setFilter("unassigned")}
          >
            Unassigned {counts.unassigned}
          </Chip>
          <Chip active={filter === "high"} onClick={() => setFilter("high")}>
            High priority {counts.high}
          </Chip>
        </div>
        <Button variant="secondary" onClick={sync} disabled={syncing}>
          {syncing ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <RefreshCw className="h-4 w-4" aria-hidden />
          )}
          Sync now
        </Button>
      </div>

      {conversations.length === 0 ? (
        <EmptyState onSync={sync} syncing={syncing} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
          <ul className="flex max-h-[70vh] flex-col gap-1.5 overflow-y-auto pr-1">
            {visible.length === 0 ? (
              <li className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted">
                Nothing in this filter.
              </li>
            ) : (
              visible.map((conversation) => (
                <li key={conversation.id}>
                  <ConversationCard
                    conversation={conversation}
                    active={conversation.id === selected?.id}
                    onSelect={() => setSelectedId(conversation.id)}
                  />
                </li>
              ))
            )}
          </ul>

          {selected ? (
            <ThreadPane
              key={selected.id}
              conversation={selected}
              members={members}
              canReply={canReply}
              canManage={canManage}
            />
          ) : (
            <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted">
              Pick a conversation.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ConversationCard({
  conversation,
  active,
  onSelect,
}: {
  conversation: ConversationRow;
  active: boolean;
  onSelect: () => void;
}) {
  const studio = studioForPlatform(conversation.platform);
  const Icon = conversation.kind === "DM" ? Send : conversation.kind === "MENTION" ? AtSign : MessageSquare;

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active}
      className={cn(
        "flex w-full flex-col gap-1.5 rounded-lg border p-3 text-left transition-colors",
        active
          ? "border-accent/40 bg-accent/5"
          : "border-border bg-surface hover:border-border-strong"
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: `rgb(var(${studio.accentVar}))` }}
          aria-hidden
        />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-primary">
          {conversation.authorHandle}
        </span>
        {conversation.unread > 0 && (
          <span className="rounded-full bg-accent px-1.5 text-[10px] font-medium text-canvas">
            {conversation.unread}
          </span>
        )}
        <PriorityDot band={conversation.band} />
      </div>

      <p className="line-clamp-2 text-xs text-secondary">{conversation.preview}</p>

      <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-muted">
        <Icon className="h-3 w-3" aria-hidden />
        <span>{studio.label}</span>
        <span>·</span>
        <span>{relativeTime(conversation.lastMessageAt)}</span>
        {conversation.assignee && (
          <>
            <span>·</span>
            <span className="truncate">
              {conversation.assignee.name ?? conversation.assignee.email}
            </span>
          </>
        )}
      </div>
    </button>
  );
}

function ThreadPane({
  conversation,
  members,
  canReply,
  canManage,
}: {
  conversation: ConversationRow;
  members: Member[];
  canReply: boolean;
  canManage: boolean;
}) {
  const [draft, setDraft] = useState("");
  const [sending, startSend] = useTransition();
  const [suggesting, startSuggest] = useTransition();
  const [managing, startManage] = useTransition();

  function send() {
    const text = draft.trim();
    if (!text) return;
    startSend(async () => {
      const result = await replyAction({
        conversationId: conversation.id,
        text,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      if (!result.data.sent) {
        // The platform refused. The draft stays in the box — losing what
        // someone just wrote is a worse failure than the one that caused it.
        toast.error(result.data.error ?? "The platform refused this reply");
        return;
      }
      setDraft("");
      toast.success("Replied");
    });
  }

  function suggest() {
    startSuggest(async () => {
      const result = await suggestReplyAction({
        conversationId: conversation.id,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setDraft(result.data.draft);
      toast.success(
        result.data.source === "local"
          ? "Local draft — set ANTHROPIC_API_KEY for Claude"
          : "Draft ready — read it before sending"
      );
    });
  }

  function assignTo(userId: string | null) {
    startManage(async () => {
      const result = await assignAction({
        conversationId: conversation.id,
        userId,
      });
      toast[result.ok ? "success" : "error"](
        result.ok ? (userId ? "Assigned" : "Unassigned") : result.error
      );
    });
  }

  function updateStatus(status: ConversationStatus, snoozeHours?: number) {
    startManage(async () => {
      const result = await setStatusAction({
        conversationId: conversation.id,
        status,
        snoozeHours,
      });
      toast[result.ok ? "success" : "error"](
        result.ok ? `Marked ${status.toLowerCase()}` : result.error
      );
    });
  }

  const studio = studioForPlatform(conversation.platform);

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate font-display text-sm font-medium text-primary">
              {conversation.authorName ?? conversation.authorHandle}
            </h3>
            <Badge variant={sentimentVariant(conversation.sentiment)}>
              {conversation.sentiment.toLowerCase()}
            </Badge>
            <Badge variant={conversation.band === "high" ? "danger" : "default"}>
              priority {conversation.priority}
            </Badge>
          </div>
          <p className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-muted">
            {studio.label} · {conversation.kind.toLowerCase()} ·{" "}
            {conversation.messageCount} message
            {conversation.messageCount === 1 ? "" : "s"}
          </p>
        </div>

        {conversation.permalink && (
          <a
            href={conversation.permalink}
            target="_blank"
            rel="noreferrer noopener"
            className="text-xs text-secondary underline-offset-4 transition-colors hover:text-accent hover:underline"
          >
            Open on {studio.label}
          </a>
        )}
      </div>

      <div className="rounded-md border border-border bg-canvas p-3">
        <p className="whitespace-pre-wrap text-sm text-primary">
          {conversation.preview}
        </p>
      </div>

      {canManage && (
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor={`assign-${conversation.id}`}>
            Assign this conversation
          </label>
          <div className="flex items-center gap-1.5 text-xs text-muted">
            <UserPlus className="h-3.5 w-3.5" aria-hidden />
            <select
              id={`assign-${conversation.id}`}
              value={conversation.assignee?.id ?? ""}
              disabled={managing}
              onChange={(event) => assignTo(event.target.value || null)}
              className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-primary"
            >
              <option value="">Unassigned</option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name ?? member.email}
                </option>
              ))}
            </select>
          </div>

          <Button
            variant="ghost"
            disabled={managing}
            onClick={() => updateStatus(ConversationStatus.SNOOZED, 24)}
          >
            <Clock className="h-3.5 w-3.5" aria-hidden />
            Snooze a day
          </Button>
          <Button
            variant="ghost"
            disabled={managing}
            onClick={() => updateStatus(ConversationStatus.DONE)}
          >
            Mark done
          </Button>
        </div>
      )}

      {canReply ? (
        <div className="flex flex-col gap-2 border-t border-border pt-4">
          <label
            className="font-mono text-[10px] uppercase tracking-wider text-muted"
            htmlFor={`reply-${conversation.id}`}
          >
            Reply as {studio.label}
          </label>
          <Textarea
            id={`reply-${conversation.id}`}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={4}
            placeholder="Write a reply, or draft one and edit it."
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={send} disabled={sending || !draft.trim()}>
              {sending ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Send className="h-4 w-4" aria-hidden />
              )}
              Send reply
            </Button>
            <Button variant="secondary" onClick={suggest} disabled={suggesting}>
              {suggesting ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Sparkles className="h-4 w-4" aria-hidden />
              )}
              Draft a reply
            </Button>
          </div>
          <p className="text-xs text-muted">
            A drafted reply is never sent for you. Read it, change it, then send.
          </p>
        </div>
      ) : (
        <p className="border-t border-border pt-4 text-xs text-muted">
          Your role can read the inbox but not reply under the brand&rsquo;s
          name.
        </p>
      )}
    </div>
  );
}

function EmptyState({
  onSync,
  syncing,
}: {
  onSync: () => void;
  syncing: boolean;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border p-12 text-center">
      <MessageSquare className="h-6 w-6 text-muted" aria-hidden />
      <p className="text-sm text-primary">Nothing here yet.</p>
      <p className="max-w-md text-xs text-muted">
        The inbox fills from your connected accounts every fifteen minutes.
        Accounts with a read-only connection can&rsquo;t be read for comments —
        syncing will tell you which.
      </p>
      <Button variant="secondary" onClick={onSync} disabled={syncing}>
        {syncing ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <RefreshCw className="h-4 w-4" aria-hidden />
        )}
        Sync now
      </Button>
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
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
          : "border-border text-secondary hover:border-border-strong"
      )}
    >
      {children}
    </button>
  );
}

function PriorityDot({ band }: { band: "high" | "medium" | "low" }) {
  const label = `${band} priority`;
  return (
    <span
      title={label}
      aria-label={label}
      className={cn(
        "h-1.5 w-1.5 shrink-0 rounded-full",
        band === "high"
          ? "bg-danger"
          : band === "medium"
            ? "bg-warning"
            : "bg-border-strong"
      )}
    />
  );
}

function sentimentVariant(sentiment: Sentiment) {
  if (sentiment === Sentiment.NEGATIVE) return "danger" as const;
  if (sentiment === Sentiment.POSITIVE) return "success" as const;
  return "default" as const;
}

function relativeTime(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}
