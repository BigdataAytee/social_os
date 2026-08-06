/**
 * Stage 3 verification: workspaces, switching, and the isolation an agency
 * depends on.
 *
 *   DATABASE_URL=… npx tsx scripts/workspaces-e2e.ts
 *
 * Writes to the database. Point it at a throwaway one.
 */

import { OrgKind, Platform, PostStatus, Role } from "@prisma/client";

import { can } from "@/lib/auth/permissions";
import type { Session } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { createPost, listPosts } from "@/modules/posts/service";
import {
  canAccessWorkspace,
  createClientWorkspace,
  inviteToWorkspace,
  listWorkspaces,
} from "@/modules/workspaces/service";

let failures = 0;
let checks = 0;

function ok(label: string, condition: boolean, detail = "") {
  checks += 1;
  if (!condition) failures += 1;
  console.log(`  ${condition ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
}

async function throws(label: string, fn: () => Promise<unknown>) {
  checks += 1;
  try {
    await fn();
    failures += 1;
    console.log(`  ✗ ${label} — expected a rejection, got none`);
  } catch (error) {
    console.log(
      `  ✓ ${label} — ${(error instanceof Error ? error.message : String(error)).slice(0, 60)}`
    );
  }
}

function sessionOf(m: {
  userId: string;
  orgId: string;
  role: Role;
  org: { name: string; slug: string };
  email: string;
}): Session {
  return {
    userId: m.userId,
    email: m.email,
    name: null,
    avatarUrl: null,
    orgId: m.orgId,
    orgName: m.org.name,
    orgSlug: m.org.slug,
    role: m.role,
  };
}

async function main() {
  const membership = await db.membership.findFirst({
    where: { role: "OWNER", org: { slug: "northwind" } },
    include: { org: true, user: true },
  });
  if (!membership) throw new Error("Seed the northwind demo org first");

  const agency = sessionOf({
    userId: membership.userId,
    orgId: membership.orgId,
    role: membership.role,
    org: membership.org,
    email: membership.user.email,
  });

  // Clean up anything a previous run left behind.
  await db.organization.deleteMany({
    where: { parentOrgId: agency.orgId, name: { startsWith: "E2E Client" } },
  });

  console.log("\nRole matrix (OS-ARCHITECTURE.md §9)");
  ok("CREATOR can write", can(Role.CREATOR, "post.create"));
  ok(
    "CREATOR cannot submit for approval",
    !can(Role.CREATOR, "post.submitForApproval")
  );
  ok("CREATOR cannot publish", !can(Role.CREATOR, "post.publish"));
  ok("CLIENT can approve their own workspace's work", can(Role.CLIENT, "post.approve"));
  ok("CLIENT can comment", can(Role.CLIENT, "comment.write"));
  ok("CLIENT cannot create", !can(Role.CLIENT, "post.create"));
  ok("CLIENT cannot manage integrations", !can(Role.CLIENT, "integration.manage"));
  ok(
    "CLIENT cannot switch workspaces — deny by default",
    !can(Role.CLIENT, "workspace.switch")
  );
  ok("CLIENT cannot create workspaces", !can(Role.CLIENT, "workspace.create"));
  ok("VIEWER is unchanged", can(Role.VIEWER, "comment.write") && !can(Role.VIEWER, "post.create"));
  ok("ADMIN can create workspaces", can(Role.ADMIN, "workspace.create"));

  console.log("\nCreating a client workspace");
  const client = await createClientWorkspace(agency, { name: "E2E Client Alpha" });
  ok("workspace is a CLIENT", client.kind === OrgKind.CLIENT);
  ok("owned by the agency", client.parentOrgId === agency.orgId);
  ok(
    "the creator is its OWNER",
    (await db.membership.findUnique({
      where: { userId_orgId: { userId: agency.userId, orgId: client.id } },
    }))?.role === Role.OWNER
  );
  ok(
    "it gets a starter brand voice",
    (await db.brandVoice.findUnique({ where: { orgId: client.id } })) !== null
  );

  const second = await createClientWorkspace(agency, { name: "E2E Client Beta" });
  ok("two clients can share a name pattern without slug collision", second.slug !== client.slug);

  const clientSession: Session = {
    ...agency,
    orgId: client.id,
    orgName: client.name,
    orgSlug: client.slug,
  };
  await throws("a client workspace can't own further workspaces", () =>
    createClientWorkspace(clientSession, { name: "E2E Client Nested" })
  );

  console.log("\nSwitching");
  const visible = await listWorkspaces(agency);
  ok(
    "the agency sees all three of its workspaces",
    visible.length >= 3,
    `${visible.length}`
  );
  ok(
    "exactly one is active",
    visible.filter((w) => w.active).length === 1
  );
  ok(
    "client workspaces name their parent",
    visible.find((w) => w.id === client.id)?.parentName === agency.orgName
  );
  ok("access is granted by membership", await canAccessWorkspace(agency.userId, client.id));

  console.log("\nIsolation — what an agency cannot survive getting wrong");
  const outsider = await db.user.create({
    data: { id: `e2e-outsider-${Date.now()}`, email: `e2e-${Date.now()}@example.test` },
  });
  ok(
    "a non-member cannot access a workspace",
    !(await canAccessWorkspace(outsider.id, client.id))
  );

  // The scenario that matters: one client's data must be invisible from
  // another client's workspace, even though one agency owns both.
  const alphaPost = await createPost(clientSession, {
    platform: Platform.X,
    body: "Alpha's confidential draft.",
    status: PostStatus.DRAFT,
    platformData: {},
  });
  const betaSession: Session = {
    ...agency,
    orgId: second.id,
    orgName: second.name,
    orgSlug: second.slug,
  };
  ok(
    "one client's posts are invisible from the other's workspace",
    (await listPosts(betaSession)).every((post) => post.id !== alphaPost.id)
  );
  ok(
    "and invisible from the agency's own workspace",
    (await listPosts(agency)).every((post) => post.id !== alphaPost.id)
  );
  ok(
    "the post is visible in its own workspace",
    (await listPosts(clientSession)).some((post) => post.id === alphaPost.id)
  );

  console.log("\nInvitations");
  await throws("you can't invite into a workspace you're not in", () =>
    inviteToWorkspace(
      { ...agency, userId: outsider.id },
      { orgId: client.id, email: membership.user.email, role: Role.CLIENT }
    )
  );
  await throws("inviting an email with no account is refused clearly", () =>
    inviteToWorkspace(agency, {
      orgId: client.id,
      email: "nobody-at-all@example.test",
      role: Role.CLIENT,
    })
  );

  const invited = await inviteToWorkspace(agency, {
    orgId: client.id,
    email: outsider.email,
    role: Role.CLIENT,
  });
  ok("a real user can be invited as CLIENT", invited.role === Role.CLIENT);
  ok(
    "and can now access exactly that workspace",
    (await canAccessWorkspace(outsider.id, client.id)) &&
      !(await canAccessWorkspace(outsider.id, second.id))
  );

  const clientView = await listWorkspaces({
    ...clientSession,
    userId: outsider.id,
    role: Role.CLIENT,
  });
  ok(
    "a client sees only their own workspace",
    clientView.length === 1 && clientView[0]!.id === client.id,
    `${clientView.length} visible`
  );

  console.log("\nCleanup");
  await db.post.deleteMany({ where: { id: alphaPost.id } });
  await db.organization.deleteMany({ where: { id: { in: [client.id, second.id] } } });
  await db.user.delete({ where: { id: outsider.id } });
  console.log("  ✓ test rows removed");

  console.log(
    `\n${failures === 0 ? "✓" : "✗"} ${checks - failures}/${checks} checks passed\n`
  );
  await db.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error("\nWorkspaces e2e threw:\n", error);
  await db.$disconnect();
  process.exit(1);
});
