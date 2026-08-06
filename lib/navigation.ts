import {
  BarChart3,
  Calendar,
  FolderOpen,
  Flame,
  Inbox,
  Radar,
  LayoutDashboard,
  Settings,
  Sparkles,
  Users,
  type LucideIcon,
} from "lucide-react";

import { STUDIOS } from "@/lib/studios";

/**
 * Sidebar destinations (ARCHITECTURE.md §6). Every entry here is a real,
 * navigable route from Phase 0 — later phases fill pages in rather than
 * creating them.
 */

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
};

export const PRIMARY_NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  // Above the Studios: the hub is where a day starts — what happened, what is
  // worth reacting to — and the Studios are where the reaction gets written.
  { href: "/hub", label: "X Hub", icon: Flame },
];

export const STUDIO_NAV: NavItem[] = STUDIOS.map((studio) => ({
  href: `/studio/${studio.slug}`,
  label: studio.label,
  // Studio rows render an accent dot rather than an icon, but keep a sensible
  // fallback so the type stays uniform.
  icon: Sparkles,
}));

export const WORKSPACE_NAV: NavItem[] = [
  // First in the workspace group on purpose: the inbox is the surface with
  // other people waiting on the other side of it.
  { href: "/inbox", label: "Inbox", icon: Inbox },
  { href: "/calendar", label: "Calendar", icon: Calendar },
  { href: "/assets", label: "Asset Library", icon: FolderOpen },
  { href: "/assistant", label: "AI Assistant", icon: Sparkles },
  { href: "/listening", label: "Listening", icon: Radar },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
];

export const ORG_NAV: NavItem[] = [
  { href: "/team", label: "Team", icon: Users },
  { href: "/settings", label: "Settings", icon: Settings },
];

/** Flat list — used by the command palette in Phase 1. */
export const ALL_NAV: NavItem[] = [
  ...PRIMARY_NAV,
  ...STUDIO_NAV,
  ...WORKSPACE_NAV,
  ...ORG_NAV,
];
