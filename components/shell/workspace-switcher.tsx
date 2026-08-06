"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Building2, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { switchWorkspaceAction } from "@/app/actions/workspaces";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Switch the workspace the whole app is acting in.
 *
 * Rendered only when there is more than one — a solo brand should never see a
 * picker with one item in it, which reads as a feature they're failing to use.
 */
export type WorkspaceOption = {
  id: string;
  name: string;
  slug: string;
  kind: string;
  role: string;
  active: boolean;
  parentName: string | null;
};

export function WorkspaceSwitcher({
  workspaces,
}: {
  workspaces: WorkspaceOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  if (workspaces.length < 2) return null;
  const active = workspaces.find((workspace) => workspace.active);

  function choose(orgId: string) {
    startTransition(async () => {
      const result = await switchWorkspaceAction({ orgId });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="w-full justify-start gap-2">
          {pending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Building2 className="h-3.5 w-3.5" />
          )}
          <span className="min-w-0 flex-1 truncate text-left">
            {active?.name ?? "Workspace"}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {workspaces.map((workspace) => (
          <DropdownMenuItem
            key={workspace.id}
            disabled={pending}
            onSelect={() => choose(workspace.id)}
            className="flex items-start gap-2"
          >
            <span className="w-3.5 shrink-0 pt-0.5">
              {workspace.active && <Check className="h-3.5 w-3.5 text-accent" />}
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-sm">{workspace.name}</span>
              <span className="truncate font-mono text-[10px] uppercase tracking-wider text-muted">
                {workspace.role}
                {workspace.parentName ? ` · ${workspace.parentName}` : ""}
              </span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
