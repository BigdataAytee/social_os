import { OrgKind, Role } from "@prisma/client";

import { assertCan } from "@/lib/auth/permissions";
import type { Session } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { logActivity } from "@/modules/activity/service";

/**
 * Workspaces (OS-ARCHITECTURE.md §11 stage 3).
 *
 * **The Organization already was the workspace.** It carries every business
 * row, `orgId` isolation is enforced in the service layer and covered by the
 * smoke suite, and `@@unique([userId, orgId])` already allowed a user to hold
 * several memberships. The architecture doc sketched a Workspace table *inside*
 * Organization; building it that way would have duplicated a boundary that
 * already works and required backfilling a `workspaceId` onto sixteen tables,
 * with a fresh chance to get isolation wrong on each one.
 *
 * What was actually missing: switching between them, an agency→client
 * relationship, and two roles. That is all this module adds.
 */

export type WorkspaceSummary = {
  id: string;
  name: string;
  slug: string;
  kind: OrgKind;
  role: Role;
  /** True for the one the session is currently acting in. */
  active: boolean;
  /** Set when this is a client workspace owned by an agency. */
  parentName: string | null;
};

/**
 * Every workspace this user can act in.
 *
 * Membership only — an agency admin does *not* silently get their clients'
 * workspaces here. Reaching a client is an explicit membership on it, because
 * "I can see it because I own the parent" is exactly the implicit grant that
 * leaks one client's data to another.
 */
export async function listWorkspaces(
  session: Session
): Promise<WorkspaceSummary[]> {
  const memberships = await db.membership.findMany({
    where: { userId: session.userId },
    include: { org: { include: { parent: { select: { name: true } } } } },
    orderBy: { createdAt: "asc" },
  });

  return memberships.map((membership) => ({
    id: membership.orgId,
    name: membership.org.name,
    slug: membership.org.slug,
    kind: membership.org.kind,
    role: membership.role,
    active: membership.orgId === session.orgId,
    parentName: membership.org.parent?.name ?? null,
  }));
}

/**
 * Can this user act in this workspace?
 *
 * The single check every switch goes through. It asks the membership table, not
 * the parent chain — see the note on `listWorkspaces`.
 */
export async function canAccessWorkspace(
  userId: string,
  orgId: string
): Promise<boolean> {
  const membership = await db.membership.findUnique({
    where: { userId_orgId: { userId, orgId } },
    select: { id: true, role: true },
  });
  if (!membership) return false;
  // A CLIENT belongs to exactly one workspace and cannot be moved out of it by
  // a crafted cookie, because their membership is the only one they have.
  return true;
}

/**
 * Create a client workspace under the current org.
 *
 * The creator becomes its OWNER so the agency can work in it immediately. A
 * separate CLIENT membership is what the customer gets, and it is deliberately
 * a second, explicit act — handing a client a workspace should never be a side
 * effect of creating one.
 */
export async function createClientWorkspace(
  session: Session,
  input: { name: string }
) {
  assertCan(session.role, "workspace.create");

  const name = input.name.trim();
  if (!name) throw new Error("A workspace needs a name");

  const parent = await db.organization.findUnique({
    where: { id: session.orgId },
  });
  if (!parent) throw new Error("Organization not found");
  if (parent.kind === OrgKind.CLIENT) {
    // One level. An agency owns clients; a client owning clients is a hierarchy
    // nobody asked for and every permission check would have to walk.
    throw new Error("A client workspace can't own further workspaces");
  }

  // Derived from the parent so two agencies can both have a "Acme" client.
  const slug = `${slugify(name)}-${parent.id.slice(-6)}`;

  const workspace = await db.organization.create({
    data: {
      name,
      slug,
      kind: OrgKind.CLIENT,
      parentOrgId: parent.id,
      memberships: {
        create: { userId: session.userId, role: Role.OWNER },
      },
      // A workspace with no brand voice makes every generation toneless.
      brandVoice: {
        create: {
          tone: "Clear and direct. Write like a practitioner talking to a peer.",
          audience: `Describe ${name}'s audience in Settings → Brand voice.`,
          emojiUsage: "light",
          ctaStyle: "Soft and specific — ask a real question or name one next step.",
          readingLevel: "Grade 8 — short sentences, concrete nouns.",
          avoidWords: ["leverage", "synergy", "game-changer", "unlock"],
          terminology: {},
        },
      },
    },
  });

  await logActivity(session, "workspace.created", "org", workspace.id, {
    name,
    kind: OrgKind.CLIENT,
  });

  return workspace;
}

/** Add someone to a workspace. The only way anyone reaches one. */
export async function inviteToWorkspace(
  session: Session,
  input: { orgId: string; email: string; role: Role }
) {
  assertCan(session.role, "member.manage");

  // You can only invite into a workspace you are in — otherwise "manage
  // members" in one org would be a lever on every org in the database.
  if (!(await canAccessWorkspace(session.userId, input.orgId))) {
    throw new Error("You don't have access to that workspace");
  }

  const user = await db.user.findUnique({
    where: { email: input.email.trim().toLowerCase() },
  });
  if (!user) {
    throw new Error(
      "No SocialOS account with that email yet — they need to sign up first."
    );
  }

  const membership = await db.membership.upsert({
    where: { userId_orgId: { userId: user.id, orgId: input.orgId } },
    update: { role: input.role },
    create: { userId: user.id, orgId: input.orgId, role: input.role },
  });

  await logActivity(session, "member.invited", "user", user.id, {
    orgId: input.orgId,
    role: input.role,
  });

  return membership;
}

/** Branding for white-label surfaces. Display only — never access. */
export async function setBranding(
  session: Session,
  branding: Record<string, unknown>
) {
  assertCan(session.role, "org.settings");
  return db.organization.update({
    where: { id: session.orgId },
    data: { branding: branding as never },
  });
}

export async function getBranding(orgId: string) {
  const org = await db.organization.findUnique({
    where: { id: orgId },
    select: { branding: true, name: true, kind: true },
  });
  return org;
}

function slugify(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "workspace"
  );
}
