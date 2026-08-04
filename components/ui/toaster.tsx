"use client";

import { Toaster as Sonner } from "sonner";

/** Toasts, themed to the §7 tokens rather than sonner's defaults. */
export function Toaster() {
  return (
    <Sonner
      position="bottom-right"
      toastOptions={{
        unstyled: false,
        classNames: {
          toast:
            "!bg-surface-raised !border !border-border !text-primary !rounded-md !font-sans !shadow-xl !shadow-black/40",
          description: "!text-secondary",
          actionButton: "!bg-accent !text-accent-contrast",
          cancelButton: "!bg-surface !text-secondary",
          error: "!border-danger/40",
          success: "!border-success/40",
        },
      }}
    />
  );
}
