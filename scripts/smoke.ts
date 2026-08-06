/**
 * End-to-end exercise of the service layer against a real, seeded database.
 *
 * The pages are thin — they call these functions and render the result — so a
 * bug that would surface as a broken page surfaces here first, without needing
 * Supabase Auth or a browser. Run it against a throwaway database:
 *
 *   DATABASE_URL=… DIRECT_URL=… npx prisma migrate deploy && npx tsx prisma/seed.ts
 *   DATABASE_URL=… npx tsx scripts/smoke.ts
 *
 * It writes (creates posts, reschedules, publishes) so never point it at a
 * database whose contents you care about.
 */

import { Platform, PostStatus, type Role } from "@prisma/client";

import type { Session } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getBestPostingTimes, getSeries, getTotals, listCompetitors, listConnectedAccounts } from "@/modules/analytics/service";
import { listActivity } from "@/modules/activity/service";
import { listAssets, listFolders, listTags } from "@/modules/assets/service";
import { getBrandVoice } from "@/modules/brandvoice/service";
import { listCampaigns } from "@/modules/campaigns/service";
import { listIdeas } from "@/modules/ideas/service";
import { countUnread, listNotifications } from "@/modules/notifications/service";
import {
  countByStatus,
  createPost,
  deletePost,
  getPost,
  listPosts,
  publishPost,
  reschedulePost,
  updatePost,
} from "@/modules/posts/service";
import { listMembers, listTasks } from "@/modules/team/service";

let failures = 0;
let checks = 0;

function ok(label: string, condition: boolean, detail = "") {
  checks += 1;
  if (condition) {
    console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    failures += 1;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function throws(label: string, fn: () => Promise<unknown>) {
  checks += 1;
  try {
    await fn();
    failures += 1;
    console.log(`  ✗ ${label} — expected a rejection, got none`);
  } catch (error) {
    console.log(
      `  ✓ ${label} — ${(error instanceof Error ? error.message : String(error)).slice(0, 80)}`
    );
  }
}

async function sessionFor(role: Role): Promise<Session> {
  const membership = await db.membership.findFirst({
    where: { role, org: { slug: "northwind" } },
    include: { org: true, user: true },
  });
  if (!membership) throw new Error(`No seeded ${role} in the northwind org`);
  return {
    userId: membership.userId,
    email: membership.user.email,
    name: membership.user.name,
    avatarUrl: membership.user.avatarUrl,
    orgId: membership.orgId,
    orgName: membership.org.name,
    orgSlug: membership.org.slug,
    role: membership.role,
  };
}

async function main() {
  const owner = await sessionFor("OWNER");
  const editor = await sessionFor("EDITOR");
  const viewer = await sessionFor("VIEWER");

  console.log(`\nDashboard (${owner.orgName}, as ${owner.role})`);
  const totals = await getTotals(owner, { days: 30 });
  ok("getTotals returns followers", totals.followers > 0, `${totals.followers}`);
  ok("engagement rate is a sane percentage", totals.engagementRate > 0 && totals.engagementRate < 100, `${totals.engagementRate.toFixed(2)}%`);
  ok(
    "deltas are finite",
    Object.values(totals.deltas).every((d) => Number.isFinite(d)),
    Object.entries(totals.deltas).map(([k, v]) => `${k} ${v.toFixed(1)}%`).join(", ")
  );
  const counts = await countByStatus(owner);
  ok("countByStatus covers every status", Object.keys(counts).length === Object.keys(PostStatus).length, JSON.stringify(counts));

  console.log("\nAnalytics");
  const series = await getSeries(owner, { days: 30 });
  ok("one series per connected account", series.length === 5, `${series.length} series`);
  ok("every series has points", series.every((s) => s.points.length > 0), `${series[0]?.points.length ?? 0} points on ${series[0]?.platform}`);
  ok(
    "points are chronological",
    series.every((s) => s.points.every((p, i) => i === 0 || p.date >= s.points[i - 1]!.date))
  );
  ok("30-day window is not over-wide", series.every((s) => s.points.length <= 31), `max ${Math.max(...series.map((s) => s.points.length))}`);
  const best = await getBestPostingTimes(owner);
  ok("best posting times returns rows", Array.isArray(best.slots) && best.slots.length > 0, `${best.slots.length} rows`);
  ok("and names the zone its hours are in", typeof best.timezone === "string" && best.timezone.length > 0, best.timezone);
  ok("connected accounts listed", (await listConnectedAccounts(owner)).length === 5);
  ok("competitors listed", (await listCompetitors(owner)).length === 7);

  console.log("\nPer-Studio reads");
  for (const platform of Object.values(Platform)) {
    const posts = await listPosts(owner, { platform });
    const t = await getTotals(owner, { platform, days: 30 });
    ok(`${platform} studio loads`, Array.isArray(posts) && Number.isFinite(t.followers), `${posts.length} posts, ${t.followers} followers`);
  }

  console.log("\nCalendar");
  const month = await listPosts(owner, {
    from: new Date(Date.now() - 30 * 864e5),
    to: new Date(Date.now() + 30 * 864e5),
  });
  ok("calendar window returns posts", month.length > 0, `${month.length} posts`);
  ok("every calendar post has a scheduledAt", month.every((p) => p.scheduledAt !== null));

  console.log("\nOther surfaces");
  ok("campaigns", (await listCampaigns(owner)).length === 3);
  ok("ideas", (await listIdeas(owner)).length === 14);
  ok("assets", (await listAssets(owner)).length === 9);
  ok("asset folders", Array.isArray(await listFolders(owner)));
  ok("asset tags", Array.isArray(await listTags(owner)));
  ok("brand voice", (await getBrandVoice(owner)) !== null);
  ok("team members", (await listMembers(owner)).length === 5);
  ok("tasks", (await listTasks(owner)).length === 7);
  ok("notifications", (await listNotifications(owner)).length > 0);
  ok("unread count is a number", Number.isFinite(await countUnread(owner)));
  ok("activity feed", Array.isArray(await listActivity(owner)));

  console.log("\nApproval gate (ARCHITECTURE.md §5)");
  const editorPost = await createPost(editor, {
    platform: Platform.X,
    body: "Smoke test — editor tries to schedule directly.",
    status: PostStatus.SCHEDULED,
    scheduledAt: new Date(Date.now() + 864e5),
    platformData: {},
  });
  ok("EDITOR scheduling is downgraded to NEEDS_APPROVAL", editorPost.status === PostStatus.NEEDS_APPROVAL, editorPost.status);

  const ownerPost = await createPost(owner, {
    platform: Platform.X,
    body: "Smoke test — owner schedules directly.",
    status: PostStatus.SCHEDULED,
    scheduledAt: new Date(Date.now() + 864e5),
    platformData: {},
  });
  ok("OWNER may schedule directly", ownerPost.status === PostStatus.SCHEDULED, ownerPost.status);

  await throws("EDITOR cannot approve to SCHEDULED", () =>
    updatePost(editor, { id: editorPost.id, status: PostStatus.SCHEDULED })
  );
  await throws("VIEWER cannot create", () =>
    createPost(viewer, { platform: Platform.X, body: "nope", status: PostStatus.DRAFT, platformData: {} })
  );
  await throws("VIEWER cannot publish", () => publishPost(viewer, ownerPost.id));

  const approved = await updatePost(owner, { id: editorPost.id, status: PostStatus.SCHEDULED });
  ok("OWNER approves the editor's post", approved.status === PostStatus.SCHEDULED);

  console.log("\nWrites");
  const when = new Date(Date.now() + 3 * 864e5);
  const moved = await reschedulePost(owner, { id: ownerPost.id, scheduledAt: when });
  ok("reschedule persists the new time", moved.scheduledAt?.getTime() === when.getTime());

  const published = await publishPost(owner, ownerPost.id);
  ok("publish sets PUBLISHED", published.status === PostStatus.PUBLISHED, published.status);
  ok("publish stamps publishedAt", published.publishedAt !== null);
  await throws("published posts can't be rescheduled", () =>
    reschedulePost(owner, { id: ownerPost.id, scheduledAt: when })
  );
  await throws("published posts can't be un-published", () =>
    updatePost(owner, { id: ownerPost.id, status: PostStatus.DRAFT })
  );

  console.log("\nTenant isolation (ARCHITECTURE.md §2.5)");
  const otherOrg = await db.organization.create({
    data: { name: "Smoke Tenant", slug: `smoke-${Date.now()}` },
  });
  const intruder: Session = { ...owner, orgId: otherOrg.id, orgSlug: otherOrg.slug };
  ok("another org sees none of these posts", (await listPosts(intruder)).length === 0);
  ok("getPost is scoped by org", (await getPost(intruder, ownerPost.id)) === null);
  await throws("cross-org delete is refused", () => deletePost(intruder, ownerPost.id));
  await throws("cross-org publish is refused", () => publishPost(intruder, ownerPost.id));

  console.log("\nCleanup");
  await deletePost(owner, ownerPost.id);
  await deletePost(owner, editorPost.id);
  await db.organization.delete({ where: { id: otherOrg.id } });
  ok("smoke posts removed", (await getPost(owner, ownerPost.id)) === null);

  console.log(
    `\n${failures === 0 ? "✓" : "✗"} ${checks - failures}/${checks} checks passed\n`
  );
  await db.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error("\nSmoke run threw:\n", error);
  await db.$disconnect();
  process.exit(1);
});
