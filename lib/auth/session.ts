import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import type { Role } from "@prisma/client";

import { checkDatabase } from "@/lib/db-health";
import { db } from "@/lib/db";
import { createClient } from "@/lib/supabase/server";
import { ensureWorkspace } from "@/modules/org/service";

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

/**
 * Cookie naming the workspace the user is currently acting in.
 *
 * A cookie rather than a column because it is a per-browser view preference,
 * not a property of the account — the same person can reasonably have two tabs
 * open on two clients. **It is never trusted:** every read verifies the
 * membership still exists before honouring it, so a hand-edited cookie names a
 * workspace the user isn't in and gets ignored.
 */
export const ACTIVE_ORG_COOKIE = "socialos_active_org";

export type SessionResult =
  | { status: "anonymous" }
  /** The database is missing, unreachable, or has no tables yet. */
  | { status: "db-unavailable" }
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

  // Deploys no longer fail on a database that can't be migrated, so the app can
  // legitimately be running without a usable one. Check before touching it —
  // otherwise the first query throws and the page 500s with nothing to act on.
  if ((await checkDatabase()) !== "ok") return { status: "db-unavailable" };

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
      },
    },
  });

  // The workspace this browser last chose, honoured only if the membership is
  // still real. Falls back to the earliest membership — which is what the
  // session did unconditionally before workspaces existed.
  const requested = cookies().get(ACTIVE_ORG_COOKIE)?.value;
  let membership =
    (requested
      ? profile.memberships.find((m) => m.orgId === requested)
      : undefined) ?? profile.memberships[0];

  // First sign-in: provision a workspace rather than dead-ending (§11).
  if (!membership) {
    const provisioned = await ensureWorkspace({
      id: profile.id,
      email: profile.email,
      name: profile.name,
    });

    if (provisioned) {
      const created = await db.membership.findUnique({
        where: { userId_orgId: { userId: profile.id, orgId: provisioned.orgId } },
        include: { org: true },
      });
      if (created) membership = created;
    }
  }

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
  // /setup names the specific problem rather than showing a generic error.
  if (result.status === "db-unavailable") redirect("/setup");
  if (result.status === "no-org") redirect("/no-organization");
  return result.session;
}
