"use client";

import { useState, useTransition } from "react";
import { formatDistanceToNow } from "date-fns";
import { Check, Loader2, Send, Trash2 } from "lucide-react";
import { PostStatus, type Platform } from "@prisma/client";
import { toast } from "sonner";

import { PlatformDot, StatusBadge } from "@/components/content/platform-badge";
import { Button } from "@/components/ui/button";
import {
  deletePostAction,
  publishPostAction,
  updatePostAction,
} from "@/app/actions/posts";
import { cn } from "@/lib/utils";

export type PostCardData = {
  id: string;
  platform: Platform;
  status: PostStatus;
  body: string;
  scheduledAt: string | null;
  publishedAt: string | null;
  campaignName: string | null;
  authorName: string | null;
};

/**
 * The post row used by the dashboard, the Studio queues and the calendar
 * drawer. Actions go through server actions → the post service, so the approval
 * gate (§5) is enforced the same way whichever surface you act from.
 */
export function PostCard({
  post,
  canApprove,
  canPublish,
  compact = false,
}: {
  post: PostCardData;
  canApprove: boolean;
  canPublish: boolean;
  compact?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [removed, setRemoved] = useState(false);

  if (removed) return null;

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    startTransition(async () => {
      const result = await fn();
      if (result.ok) toast.success(success);
      else toast.error(result.error ?? "That didn't work");
    });
  }

  const when = post.publishedAt ?? post.scheduledAt;

  return (
    <article
      className={cn(
        "group flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 transition-colors duration-fast hover:border-border-strong",
        compact && "gap-2 p-3"
      )}
    >
      <header className="flex flex-wrap items-center gap-2">
        <PlatformDot platform={post.platform} />
        <StatusBadge status={post.status} />
        {post.campaignName && (
          <span className="truncate text-xs text-muted">
            {post.campaignName}
          </span>
        )}
        {when && (
          <time
            dateTime={when}
            className="ml-auto shrink-0 font-mono text-[11px] tabular text-muted"
          >
            {post.publishedAt ? "published " : ""}
            {formatDistanceToNow(new Date(when), { addSuffix: true })}
          </time>
        )}
      </header>

      <p
        className={cn(
          "whitespace-pre-wrap text-sm leading-relaxed text-secondary",
          compact && "line-clamp-3"
        )}
      >
        {post.body}
      </p>

      <footer className="flex flex-wrap items-center gap-2">
        {post.authorName && (
          <span className="text-xs text-muted">{post.authorName}</span>
        )}

        <div className="ml-auto flex items-center gap-1.5">
          {pending && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted" />}

          {post.status === PostStatus.NEEDS_APPROVAL && canApprove && (
            <Button
              size="sm"
              variant="secondary"
              disabled={pending}
              onClick={() =>
                run(
                  () =>
                    updatePostAction({
                      id: post.id,
                      status: PostStatus.SCHEDULED,
                    }),
                  "Approved and scheduled"
                )
              }
            >
              <Check />
              Approve
            </Button>
          )}

          {post.status === PostStatus.DRAFT && (
            <Button
              size="sm"
              variant="secondary"
              disabled={pending}
              onClick={() =>
                run(
                  () =>
                    updatePostAction({
                      id: post.id,
                      status: PostStatus.NEEDS_APPROVAL,
                    }),
                  canApprove ? "Moved to approvals" : "Submitted for approval"
                )
              }
            >
              Submit
            </Button>
          )}

          {canPublish &&
            post.status !== PostStatus.PUBLISHED &&
            post.status !== PostStatus.DRAFT && (
              <Button
                size="sm"
                disabled={pending}
                onClick={() =>
                  run(() => publishPostAction(post.id), "Published")
                }
              >
                <Send />
                Publish
              </Button>
            )}

          <Button
            size="icon"
            variant="ghost"
            aria-label="Delete post"
            disabled={pending}
            className="opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
            onClick={() => {
              setRemoved(true);
              startTransition(async () => {
                const result = await deletePostAction(post.id);
                if (result.ok) toast.success("Post deleted");
                else {
                  setRemoved(false);
                  toast.error(result.error ?? "Couldn't delete that");
                }
              });
            }}
          >
            <Trash2 className="text-muted" />
          </Button>
        </div>
      </footer>
    </article>
  );
}
