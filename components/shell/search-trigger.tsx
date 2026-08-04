"use client";

import { useState } from "react";
import { Search } from "lucide-react";

import { CommandPalette } from "@/components/shell/command-palette";

/** The topbar's ⌘K affordance plus the palette it opens. */
export function SearchTrigger() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group flex h-8 max-w-xs flex-1 items-center gap-2 rounded-md border border-border bg-surface-raised px-3 text-left text-sm text-muted transition-colors duration-fast hover:border-border-strong hover:text-secondary"
      >
        <Search className="h-3.5 w-3.5" />
        <span className="flex-1 truncate">Search or jump to…</span>
        <kbd className="hidden rounded-sm border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted sm:inline">
          ⌘K
        </kbd>
      </button>
      <CommandPalette open={open} onOpenChange={setOpen} />
    </>
  );
}
