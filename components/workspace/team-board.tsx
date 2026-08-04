"use client";

import { useState, useTransition } from "react";
import { Role, TaskStatus } from "@prisma/client";
import { formatDistanceToNow } from "date-fns";
import { Activity, CheckSquare, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import {
  createTaskAction,
  setMemberRoleAction,
  setTaskStatusAction,
} from "@/app/actions/workspace";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Section } from "@/components/ui/section";
import { ROLE_SUMMARY } from "@/lib/auth/permissions";
import { cn } from "@/lib/utils";

/**
 * Team workspace (Phase 6): members and roles, the shared task queue, and the
 * activity log. Role changes go through the service layer, which refuses to
 * demote the last owner — the UI reports that rather than preventing it.
 */

export type MemberRow = {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  role: Role;
};

export type TaskRow = {
  id: string;
  title: string;
  status: TaskStatus;
  assigneeName: string | null;
  dueDate: string | null;
};

export type ActivityRow = {
  id: string;
  action: string;
  userName: string;
  createdAt: string;
};

export function TeamBoard({
  members,
  tasks,
  activity,
  canManage,
}: {
  members: MemberRow[];
  tasks: TaskRow[];
  activity: ActivityRow[];
  canManage: boolean;
}) {
  return (
    <div className="grid gap-8 lg:grid-cols-3">
      <div className="flex flex-col gap-8 lg:col-span-2">
        <Section
          title="Members"
          description={`${members.length} people in this organization`}
        >
          <div className="flex flex-col gap-2">
            {members.map((member) => (
              <MemberRowView
                key={member.membershipId}
                member={member}
                canManage={canManage}
              />
            ))}
          </div>
        </Section>

        <TaskQueue tasks={tasks} members={members} />
      </div>

      <Section title="Activity" description="Newest first">
        {activity.length === 0 ? (
          <EmptyState icon={Activity} title="Nothing logged yet" />
        ) : (
          <ul className="flex flex-col gap-2">
            {activity.map((entry) => (
              <li
                key={entry.id}
                className="flex flex-col gap-1 rounded-md border border-border bg-surface px-3 py-2"
              >
                <span className="text-sm text-secondary">
                  <span className="text-primary">{entry.userName}</span>{" "}
                  <span className="font-mono text-xs text-muted">
                    {entry.action}
                  </span>
                </span>
                <time
                  dateTime={entry.createdAt}
                  className="font-mono text-[10px] tabular text-muted"
                >
                  {formatDistanceToNow(new Date(entry.createdAt), {
                    addSuffix: true,
                  })}
                </time>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

function MemberRowView({
  member,
  canManage,
}: {
  member: MemberRow;
  canManage: boolean;
}) {
  const [role, setRole] = useState(member.role);
  const [pending, startTransition] = useTransition();

  const initials = (member.name || member.email)
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-surface px-3 py-2.5">
      <Avatar>
        <AvatarFallback>{initials}</AvatarFallback>
      </Avatar>

      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm text-primary">{member.name}</span>
        <span className="truncate font-mono text-[11px] text-muted">
          {member.email}
        </span>
      </div>

      <span className="hidden max-w-xs text-xs text-muted lg:block">
        {ROLE_SUMMARY[role]}
      </span>

      {canManage ? (
        <Select
          value={role}
          disabled={pending}
          onValueChange={(next) => {
            const previous = role;
            setRole(next as Role);
            startTransition(async () => {
              const result = await setMemberRoleAction({
                membershipId: member.membershipId,
                role: next as Role,
              });
              if (!result.ok) {
                setRole(previous);
                toast.error(result.error);
              } else {
                toast.success(`${member.name} is now ${next.toLowerCase()}`);
              }
            });
          }}
        >
          <SelectTrigger className="w-32 shrink-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.values(Role).map((r) => (
              <SelectItem key={r} value={r}>
                {r}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <span className="shrink-0 rounded-sm border border-border bg-surface-raised px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-secondary">
          {role}
        </span>
      )}

      {pending && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted" />}
    </div>
  );
}

function TaskQueue({
  tasks,
  members,
}: {
  tasks: TaskRow[];
  members: MemberRow[];
}) {
  const [items, setItems] = useState(tasks);
  const [title, setTitle] = useState("");
  const [assigneeId, setAssigneeId] = useState("none");
  const [pending, startTransition] = useTransition();

  function add() {
    const value = title.trim();
    if (!value) return;

    startTransition(async () => {
      const result = await createTaskAction({
        title: value,
        assigneeId: assigneeId === "none" ? null : assigneeId,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setItems((prev) => [
        {
          id: result.data.id,
          title: value,
          status: TaskStatus.TODO,
          assigneeName:
            members.find((m) => m.userId === assigneeId)?.name ?? null,
          dueDate: null,
        },
        ...prev,
      ]);
      setTitle("");
      toast.success("Task added");
    });
  }

  function cycle(task: TaskRow) {
    const next =
      task.status === TaskStatus.TODO
        ? TaskStatus.IN_PROGRESS
        : task.status === TaskStatus.IN_PROGRESS
          ? TaskStatus.DONE
          : TaskStatus.TODO;

    setItems((prev) =>
      prev.map((t) => (t.id === task.id ? { ...t, status: next } : t))
    );

    startTransition(async () => {
      const result = await setTaskStatusAction({ id: task.id, status: next });
      if (!result.ok) {
        setItems((prev) =>
          prev.map((t) => (t.id === task.id ? { ...t, status: task.status } : t))
        );
        toast.error(result.error);
      }
    });
  }

  return (
    <Section
      title="Tasks"
      description={`${items.filter((t) => t.status !== "DONE").length} open`}
    >
      <div className="flex flex-wrap gap-2">
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") add();
          }}
          placeholder="What needs doing?"
          className="min-w-[12rem] flex-1"
        />
        <Select value={assigneeId} onValueChange={setAssigneeId}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Unassigned</SelectItem>
            {members.map((m) => (
              <SelectItem key={m.userId} value={m.userId}>
                {m.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button onClick={add} disabled={pending}>
          <Plus />
          Add
        </Button>
      </div>

      {items.length === 0 ? (
        <EmptyState icon={CheckSquare} title="No tasks yet" />
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((task) => (
            <li
              key={task.id}
              className="flex items-center gap-3 rounded-md border border-border bg-surface px-3 py-2.5"
            >
              <button
                type="button"
                onClick={() => cycle(task)}
                aria-label={`Mark ${task.title} as ${task.status === "DONE" ? "to do" : "next status"}`}
                className={cn(
                  "flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border transition-colors",
                  task.status === TaskStatus.DONE
                    ? "border-success bg-success/20 text-success"
                    : task.status === TaskStatus.IN_PROGRESS
                      ? "border-accent bg-accent/20"
                      : "border-border-strong"
                )}
              >
                {task.status === TaskStatus.DONE && (
                  <CheckSquare className="h-2.5 w-2.5" />
                )}
              </button>

              <span
                className={cn(
                  "min-w-0 flex-1 truncate text-sm",
                  task.status === TaskStatus.DONE
                    ? "text-muted line-through"
                    : "text-secondary"
                )}
              >
                {task.title}
              </span>

              <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-muted">
                {task.status.replace("_", " ")}
              </span>

              {task.assigneeName && (
                <span className="shrink-0 font-mono text-[10px] text-muted">
                  {task.assigneeName.split(" ")[0]}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
