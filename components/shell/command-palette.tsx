"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import {
  ArrowRight,
  CalendarPlus,
  PenLine,
  Search,
  Sparkles,
} from "lucide-react";

import { ALL_NAV } from "@/lib/navigation";
import { STUDIOS } from "@/lib/studios";
import { cn } from "@/lib/utils";

/**
 * ⌘K palette (Phase 1). Navigation plus the handful of actions worth reaching
 * without the mouse. Reads the same nav and Studio registries the sidebar does,
 * so a new destination shows up here automatically.
 */
export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        onOpenChange(!open);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onOpenChange]);

  function go(href: string) {
    onOpenChange(false);
    router.push(href);
  }

  return (
    <Command.Dialog
      open={open}
      onOpenChange={onOpenChange}
      label="Command palette"
      className={cn(
        "fixed left-1/2 top-[20%] z-50 w-full max-w-lg -translate-x-1/2 overflow-hidden",
        "rounded-lg border border-border bg-surface shadow-2xl shadow-black/60"
      )}
      overlayClassName="fixed inset-0 z-50 bg-black/60"
    >
      <div className="flex items-center gap-2 border-b border-border px-4">
        <Search className="h-4 w-4 shrink-0 text-muted" />
        <Command.Input
          placeholder="Search or jump to…"
          className="h-12 w-full bg-transparent text-sm text-primary outline-none placeholder:text-muted"
        />
      </div>

      <Command.List className="max-h-80 overflow-y-auto p-2">
        <Command.Empty className="px-3 py-6 text-center text-sm text-muted">
          Nothing matches that.
        </Command.Empty>

        <Group heading="Actions">
          <Item onSelect={() => go("/studio/x")} icon={PenLine}>
            Write a post
          </Item>
          <Item onSelect={() => go("/calendar")} icon={CalendarPlus}>
            Open the calendar
          </Item>
          <Item onSelect={() => go("/assistant")} icon={Sparkles}>
            Ask the assistant
          </Item>
        </Group>

        <Group heading="Studios">
          {STUDIOS.map((studio) => (
            <Item
              key={studio.slug}
              onSelect={() => go(`/studio/${studio.slug}`)}
              accentVar={studio.accentVar}
            >
              {studio.label} Studio
            </Item>
          ))}
        </Group>

        <Group heading="Go to">
          {ALL_NAV.filter((item) => !item.href.startsWith("/studio")).map(
            (item) => (
              <Item key={item.href} onSelect={() => go(item.href)} icon={item.icon}>
                {item.label}
              </Item>
            )
          )}
        </Group>
      </Command.List>
    </Command.Dialog>
  );
}

function Group({
  heading,
  children,
}: {
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <Command.Group
      heading={heading}
      className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted"
    >
      {children}
    </Command.Group>
  );
}

function Item({
  onSelect,
  icon: Icon,
  accentVar,
  children,
}: {
  onSelect: () => void;
  icon?: React.ComponentType<{ className?: string }>;
  accentVar?: string;
  children: React.ReactNode;
}) {
  return (
    <Command.Item
      onSelect={onSelect}
      className="flex cursor-pointer items-center gap-2.5 rounded-sm px-3 py-2 text-sm text-secondary outline-none data-[selected=true]:bg-surface-raised data-[selected=true]:text-primary"
    >
      {accentVar ? (
        <span
          aria-hidden
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: `rgb(var(${accentVar}))` }}
        />
      ) : Icon ? (
        <Icon className="h-4 w-4 shrink-0" />
      ) : null}
      <span className="flex-1 truncate">{children}</span>
      <ArrowRight className="h-3 w-3 shrink-0 opacity-0 data-[selected=true]:opacity-100" />
    </Command.Item>
  );
}
