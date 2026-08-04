import { Prisma, Role } from "@prisma/client";

import { db } from "@/lib/db";

/**
 * Workspace provisioning — the onboarding path (ARCHITECTURE.md §11, Phase 8).
 *
 * Runs on the first authenticated request from a user who has no Membership.
 * Two behaviours, chosen by env:
 *
 *   SOCIALOS_JOIN_ORG_SLUG set  → join that organization (how the demo works:
 *                                 sign up with any email, land in the seeded org
 *                                 with data already in it)
 *   unset                       → create a fresh organization owned by the user
 *
 * Without this, signing up outside the seeded org is a dead end.
 *
 * Idempotent and safe under concurrency. Two simultaneous first requests are
 * the normal case, not an edge case — a browser opening the app fires several
 * at once — so this must never yield two workspaces for one person.
 */

export type Provisioned = {
  orgId: string;
  role: Role;
};

export async function ensureWorkspace(user: {
  id: string;
  email: string;
  name: string | null;
}): Promise<Provisioned | null> {
  // Already provisioned (a concurrent request won, or this was called twice).
  const existing = await currentMembership(user.id);
  if (existing) return existing;

  const joinSlug = process.env.SOCIALOS_JOIN_ORG_SLUG?.trim();

  if (joinSlug) {
    const org = await db.organization.findUnique({ where: { slug: joinSlug } });
    if (org) {
      // The first person into an empty org owns it; everyone after is an admin,
      // so a shared demo doesn't hand every visitor the ability to delete it.
      const members = await db.membership.count({ where: { orgId: org.id } });
      return attach(user.id, org.id, members === 0 ? Role.OWNER : Role.ADMIN);
    }
    // Configured slug doesn't exist yet (seed not run). Fall through and give
    // them their own workspace rather than blocking sign-in on it.
  }

  return createOwnWorkspace(user);
}

async function createOwnWorkspace(user: {
  id: string;
  email: string;
  name: string | null;
}): Promise<Provisioned | null> {
  const name = workspaceName(user);

  // The slug is derived from the user id, so two concurrent calls for the same
  // person generate the *same* slug and collide on the unique constraint —
  // exactly one org is created and the loser re-reads the winner's. A
  // uniqueness loop that appended -2 would defeat this by letting both succeed.
  const slug = `${slugify(name)}-${user.id.replace(/-/g, "").slice(0, 8)}`;

  let orgId: string;
  try {
    const org = await db.organization.create({ data: { name, slug } });
    orgId = org.id;
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const winner = await db.organization.findUnique({ where: { slug } });
    if (!winner) return currentMembership(user.id);
    orgId = winner.id;
  }

  // A brand-new workspace with no brand voice makes every AI generation
  // toneless, so seed a neutral one the user can edit in Settings.
  try {
    await db.brandVoice.create({
      data: {
        orgId,
        tone: "Clear and direct. Write like a practitioner talking to a peer.",
        audience:
          "Describe who you're writing for in Settings → Brand voice.",
        emojiUsage: "light",
        ctaStyle:
          "Soft and specific — ask a real question or name one next step.",
        readingLevel: "Grade 8 — short sentences, concrete nouns.",
        avoidWords: ["leverage", "synergy", "game-changer", "unlock"],
        terminology: {},
      },
    });
  } catch (error) {
    // Already seeded by the request that won the race above.
    if (!isUniqueViolation(error)) throw error;
  }

  return attach(user.id, orgId, Role.OWNER);
}

async function attach(
  userId: string,
  orgId: string,
  role: Role
): Promise<Provisioned> {
  try {
    await db.membership.create({ data: { userId, orgId, role } });
  } catch (error) {
    // The unique [userId, orgId] constraint makes a concurrent duplicate a
    // no-op rather than an error.
    if (!isUniqueViolation(error)) throw error;
  }

  const membership = await db.membership.findUnique({
    where: { userId_orgId: { userId, orgId } },
  });

  return { orgId, role: membership?.role ?? role };
}

/** The user's earliest membership, which is the one the session will use. */
async function currentMembership(userId: string): Promise<Provisioned | null> {
  const membership = await db.membership.findFirst({
    where: { userId },
    orderBy: { createdAt: "asc" },
  });
  return membership
    ? { orgId: membership.orgId, role: membership.role }
    : null;
}

function isUniqueViolation(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

function workspaceName(user: { email: string; name: string | null }) {
  if (user.name?.trim()) return `${user.name.trim().split(" ")[0]}'s Workspace`;
  return `${user.email.split("@")[0]}'s Workspace`;
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
