"use client";

import { useMemo, useState } from "react";
import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { PostStatus, type Platform } from "@prisma/client";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";

import { reschedulePostAction } from "@/app/actions/posts";
import { PlatformDot, StatusBadge } from "@/components/content/platform-badge";
import { Button } from "@/components/ui/button";
import { STUDIOS } from "@/lib/studios";
import { cn } from "@/lib/utils";

/**
 * The unified calendar (Phase 5).
 *
 * Dragging a post to a new day fires a real mutation through React Query — the
 * cell updates immediately and rolls back if the server refuses (an editor
 * dragging onto the calendar, for instance, lands in NEEDS_APPROVAL rather than
 * SCHEDULED, and a published post can't move at all).
 */

export type CalendarPost = {
  id: string;
  platform: Platform;
  status: PostStatus;
  body: string;
  scheduledAt: string | null;
  campaignName: string | null;
};

const STATUS_FILTERS: { value: PostStatus | "ALL"; label: string }[] = [
  { value: "ALL", label: "All" },
  { value: PostStatus.DRAFT, label: "Drafts" },
  { value: PostStatus.NEEDS_APPROVAL, label: "Approvals" },
  { value: PostStatus.SCHEDULED, label: "Scheduled" },
  { value: PostStatus.PUBLISHED, label: "Published" },
];

export function CalendarBoard({ posts }: { posts: CalendarPost[] }) {
  const [month, setMonth] = useState(() => new Date());
  const [platform, setPlatform] = useState<Platform | "ALL">("ALL");
  const [status, setStatus] = useState<PostStatus | "ALL">("ALL");
  const [items, setItems] = useState(posts);

  const queryClient = useQueryClient();

  const reschedule = useMutation({
    mutationFn: async (input: { id: string; scheduledAt: string }) => {
      const result = await reschedulePostAction(input);
      if (!result.ok) throw new Error(result.error);
      return result.data;
    },
    // Optimistic: move the card now, put it back if the server disagrees.
    onMutate: async (input) => {
      const previous = items;
      setItems((current) =>
        current.map((p) =>
          p.id === input.id ? { ...p, scheduledAt: input.scheduledAt } : p
        )
      );
      return { previous };
    },
    onError: (error, _input, context) => {
      if (context?.previous) setItems(context.previous);
      toast.error(error instanceof Error ? error.message : "Couldn't move that");
    },
    onSuccess: () => {
      toast.success("Rescheduled");
      queryClient.invalidateQueries();
    },
  });

  const sensors = useSensors(
    // A small activation distance so clicking a card doesn't start a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );

  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(month), { weekStartsOn: 1 });
    const end = endOfWeek(endOfMonth(month), { weekStartsOn: 1 });
    return eachDayOfInterval({ start, end });
  }, [month]);

  const visible = items.filter(
    (p) =>
      (platform === "ALL" || p.platform === platform) &&
      (status === "ALL" || p.status === status)
  );

  const unscheduled = visible.filter((p) => !p.scheduledAt);

  function onDragEnd(event: DragEndEvent) {
    const postId = String(event.active.id);
    const dayKey = event.over?.id ? String(event.over.id) : null;
    if (!dayKey) return;

    const post = items.find((p) => p.id === postId);
    if (!post) return;

    // Keep the existing time of day; only the date moves.
    const existing = post.scheduledAt ? new Date(post.scheduledAt) : new Date();
    const target = new Date(dayKey);
    target.setHours(existing.getHours(), existing.getMinutes(), 0, 0);

    if (post.scheduledAt && isSameDay(new Date(post.scheduledAt), target)) return;

    reschedule.mutate({ id: postId, scheduledAt: target.toISOString() });
  }

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div className="flex flex-col gap-5">
        {/* -------------------------------------------------------- controls */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1">
            <Button
              size="icon"
              variant="ghost"
              aria-label="Previous month"
              onClick={() => setMonth((m) => subMonths(m, 1))}
            >
              <ChevronLeft />
            </Button>
            <span className="min-w-[9rem] text-center font-display text-sm font-medium text-primary">
              {format(month, "MMMM yyyy")}
            </span>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Next month"
              onClick={() => setMonth((m) => addMonths(m, 1))}
            >
              <ChevronRight />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setMonth(new Date())}
            >
              Today
            </Button>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            <FilterChip
              active={platform === "ALL"}
              onClick={() => setPlatform("ALL")}
            >
              All platforms
            </FilterChip>
            {STUDIOS.map((s) => (
              <FilterChip
                key={s.slug}
                active={platform === s.platform}
                onClick={() => setPlatform(s.platform)}
                accentVar={s.accentVar}
              >
                {s.label}
              </FilterChip>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {STATUS_FILTERS.map((f) => (
              <FilterChip
                key={f.value}
                active={status === f.value}
                onClick={() => setStatus(f.value)}
              >
                {f.label}
              </FilterChip>
            ))}
          </div>
        </div>

        {/* ------------------------------------------------------------ grid */}
        <div className="overflow-x-auto">
          <div className="min-w-[52rem]">
            <div className="grid grid-cols-7 gap-px border-b border-border pb-2">
              {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
                <div
                  key={d}
                  className="px-2 font-mono text-[10px] uppercase tracking-wider text-muted"
                >
                  {d}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-px bg-border">
              {days.map((day) => (
                <DayCell
                  key={day.toISOString()}
                  day={day}
                  month={month}
                  posts={visible.filter(
                    (p) => p.scheduledAt && isSameDay(new Date(p.scheduledAt), day)
                  )}
                />
              ))}
            </div>
          </div>
        </div>

        {/* ---------------------------------------------------- unscheduled */}
        {unscheduled.length > 0 && (
          <div className="flex flex-col gap-2">
            <h2 className="font-display text-sm font-medium text-primary">
              Unscheduled drafts
            </h2>
            <p className="text-xs text-muted">
              Drag one onto a day to schedule it.
            </p>
            <div className="flex flex-wrap gap-2">
              {unscheduled.map((post) => (
                <DraggablePost key={post.id} post={post} standalone />
              ))}
            </div>
          </div>
        )}
      </div>
    </DndContext>
  );
}

function FilterChip({
  active,
  onClick,
  accentVar,
  children,
}: {
  active: boolean;
  onClick: () => void;
  accentVar?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex items-center gap-1.5 rounded-sm border px-2 py-1 text-xs transition-colors duration-fast",
        active
          ? "border-border-strong bg-surface-raised text-primary"
          : "border-border bg-surface text-muted hover:text-secondary"
      )}
    >
      {accentVar && (
        <span
          aria-hidden
          className="h-1.5 w-1.5 rounded-full"
          style={{ backgroundColor: `rgb(var(${accentVar}))` }}
        />
      )}
      {children}
    </button>
  );
}

function DayCell({
  day,
  month,
  posts,
}: {
  day: Date;
  month: Date;
  posts: CalendarPost[];
}) {
  const { setNodeRef, isOver } = useDroppable({ id: day.toISOString() });
  const outside = !isSameMonth(day, month);

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex min-h-[7rem] flex-col gap-1 bg-canvas p-1.5 transition-colors duration-fast",
        outside && "opacity-40",
        isOver && "bg-accent/10"
      )}
    >
      <span
        className={cn(
          "font-mono text-[11px] tabular",
          isToday(day) ? "font-medium text-accent" : "text-muted"
        )}
      >
        {format(day, "d")}
      </span>
      {posts.map((post) => (
        <DraggablePost key={post.id} post={post} />
      ))}
    </div>
  );
}

function DraggablePost({
  post,
  standalone = false,
}: {
  post: CalendarPost;
  standalone?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: post.id });

  return (
    <button
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={
        transform
          ? {
              transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
              zIndex: 40,
            }
          : undefined
      }
      className={cn(
        "flex cursor-grab flex-col gap-1 rounded-sm border border-border bg-surface p-1.5 text-left transition-colors hover:border-border-strong active:cursor-grabbing",
        standalone && "w-56",
        isDragging && "opacity-70 shadow-lg shadow-black/40"
      )}
      title={post.body}
    >
      <span className="flex items-center gap-1.5">
        <PlatformDot platform={post.platform} />
        <StatusBadge status={post.status} className="scale-90 origin-left" />
      </span>
      <span className="line-clamp-2 text-[11px] leading-snug text-secondary">
        {post.body}
      </span>
      {post.scheduledAt && (
        <span className="font-mono text-[10px] tabular text-muted">
          {format(new Date(post.scheduledAt), "HH:mm")}
        </span>
      )}
    </button>
  );
}
