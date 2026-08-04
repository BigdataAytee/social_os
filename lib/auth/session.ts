import { redirect } from "next/navigation";
import { cache } from "react";
import type { Role } from "@prisma/client";

import { db } from "@/lib/db";
import { createClient } from "@/lib/supabase/server";

export type Session = {
  userId: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  orgId: string;
  orgName: string;
  orgSlug: string;
  role: Role;
};

export type SessionResult =
  | { status: "anonymous" }
  /** Authenticated with Supabase, but not a member of any org yet.
   *  Phase 8 turns this into the onboarding flow. */
  | { status: "no-org"; userId: string; email: string }
  | { status: "ok"; session: Session };

/**
 * The single source of truth for "who is asking, and for which org".
 *
 * orgId is derived here from the user's Membership and never accepted from a
 * client (ARCHITECTURE.md §2.5 / §5). Wrapped in React `cache` so a page that
 * calls it from several components still issues one query per request.
 */
export const getSessionResult = cache(async (): Promise<SessionResult> => {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { status: "anonymous" };

  const email = user.email ?? `${user.id}@unknown.local`;

  // Profile mirror of the auth user (§4), created on first authenticated request.
  const profile = await db.user.upsert({
    where: { id: user.id },
    update: {},
    create: {
      id: user.id,
      email,
      name:
        (user.user_metadata?.name as string | undefined) ??
        email.split("@")[0] ??
        null,
      avatarUrl: (user.user_metadata?.avatar_url as string | undefined) ?? null,
    },
    include: {
      memberships: {
        include: { org: true },
        orderBy: { createdAt: "asc" },
        take: 1,
      },
    },
  });

  const membership = profile.memberships[0];
  if (!membership) {
    return { status: "no-org", userId: profile.id, email: profile.email };
  }

  return {
    status: "ok",
    session: {
      userId: profile.id,
      email: profile.email,
      name: profile.name,
      avatarUrl: profile.avatarUrl,
      orgId: membership.orgId,
      orgName: membership.org.name,
      orgSlug: membership.org.slug,
      role: membership.role,
    },
  };
});

export async function getSession(): Promise<Session | null> {
  const result = await getSessionResult();
  return result.status === "ok" ? result.session : null;
}

/**
 * Use in any authenticated Server Component / server action.
 * Redirects rather than throwing, so callers can treat the return as present.
 */
export async function requireSession(): Promise<Session> {
  const result = await getSessionResult();
  if (result.status === "anonymous") redirect("/login");
  if (result.status === "no-org") redirect("/no-organization");
  return result.session;
}
