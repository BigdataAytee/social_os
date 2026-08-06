"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { StudioSwitcher } from "@/components/shell/studio-switcher";
import { Logo } from "@/components/shell/logo";
import {
  WorkspaceSwitcher,
  type WorkspaceOption,
} from "@/components/shell/workspace-switcher";
import { ORG_NAV, PRIMARY_NAV, WORKSPACE_NAV, type NavItem } from "@/lib/navigation";
import { STUDIOS } from "@/lib/studios";
import { cn } from "@/lib/utils";

function useIsActive() {
  const pathname = usePathname();
  return (href: string) => pathname === href || pathname.startsWith(`${href}/`);
}

function NavRow({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors duration-fast ease-standard",
        active
          ? "bg-surface-raised text-primary"
          : "text-secondary hover:bg-surface-raised/60 hover:text-primary"
      )}
    >
      {active && (
        <span
          aria-hidden
          className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-accent"
        />
      )}
      <Icon className="h-4 w-4 shrink-0" />
      <span className="truncate">{item.label}</span>
    </Link>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-3 pb-1.5 pt-5 text-[10px] uppercase tracking-wider text-muted">
      {children}
    </p>
  );
}

export function SidebarNav() {
  const isActive = useIsActive();

  return (
    <nav className="flex flex-1 flex-col overflow-y-auto px-3 pb-4" aria-label="Main">
      <div className="flex flex-col gap-0.5 pt-2">
        {PRIMARY_NAV.map((item) => (
          <NavRow key={item.href} item={item} active={isActive(item.href)} />
        ))}
      </div>

      <SectionLabel>Studios</SectionLabel>
      <div className="flex flex-col gap-0.5">
        {STUDIOS.map((studio) => {
          const href = `/studio/${studio.slug}`;
          const active = isActive(href);
          return (
            <Link
              key={studio.slug}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "group relative flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors duration-fast ease-standard",
                active
                  ? "bg-surface-raised text-primary"
                  : "text-secondary hover:bg-surface-raised/60 hover:text-primary"
              )}
            >
              {active && (
                <span
                  aria-hidden
                  className="absolute inset-y-1.5 left-0 w-0.5 rounded-full"
                  style={{ backgroundColor: `rgb(var(${studio.accentVar}))` }}
                />
              )}
              {/* The accent dot is how a Studio identifies itself everywhere (§7). */}
              <span
                aria-hidden
                className={cn(
                  "h-2 w-2 shrink-0 rounded-full transition-opacity duration-fast",
                  active ? "opacity-100" : "opacity-60 group-hover:opacity-100"
                )}
                style={{ backgroundColor: `rgb(var(${studio.accentVar}))` }}
              />
              <span className="truncate">{studio.label}</span>
            </Link>
          );
        })}
      </div>

      <SectionLabel>Workspace</SectionLabel>
      <div className="flex flex-col gap-0.5">
        {WORKSPACE_NAV.map((item) => (
          <NavRow key={item.href} item={item} active={isActive(item.href)} />
        ))}
      </div>

      <SectionLabel>Organization</SectionLabel>
      <div className="flex flex-col gap-0.5">
        {ORG_NAV.map((item) => (
          <NavRow key={item.href} item={item} active={isActive(item.href)} />
        ))}
      </div>
    </nav>
  );
}

export type { WorkspaceOption };

export function Sidebar({
  orgName,
  workspaces,
}: {
  orgName: string;
  workspaces: WorkspaceOption[];
}) {
  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-surface lg:flex">
      <div className="flex flex-col gap-3 px-3 pb-1 pt-4">
        <div className="px-1">
          <Logo />
        </div>
        <StudioSwitcher />
      </div>
      <SidebarNav />
      <div className="border-t border-border px-2 py-2">
        {workspaces.length > 1 ? (
          // The switcher replaces the label entirely when there's a choice —
          // showing both would be the same information twice.
          <WorkspaceSwitcher workspaces={workspaces} />
        ) : (
          <div className="px-2 py-1">
            <p className="truncate text-[10px] uppercase tracking-wider text-muted">
              Organization
            </p>
            <p className="truncate text-sm text-secondary">{orgName}</p>
          </div>
        )}
      </div>
    </aside>
  );
}
