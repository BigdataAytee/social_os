/**
 * SocialOS demo seed — ARCHITECTURE.md §12.
 *
 * Idempotent: re-running wipes and rebuilds the demo org rather than
 * duplicating it. Everything is deterministic (seeded PRNG) so two runs produce
 * the same numbers and screenshots stay stable between sessions.
 *
 * If SUPABASE_SERVICE_ROLE_KEY is set, matching Supabase auth users are created
 * so you can actually log in as each role. Without it the profile rows are still
 * seeded and the console explains how to link them.
 */

import { randomUUID } from "node:crypto";
import {
  ConnectedAccountStatus,
  Platform,
  PostStatus,
  PrismaClient,
  Role,
  TaskStatus,
} from "@prisma/client";

const db = new PrismaClient();

const ORG_SLUG = "northwind";
const ORG_NAME = "Northwind Studio";
const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "socialos-demo-1234";

// ---------------------------------------------------------------- utilities

/** Deterministic PRNG (mulberry32) — realistic noise that doesn't move between runs. */
function makeRandom(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = makeRandom(20240817);

const pick = <T,>(items: readonly T[]): T =>
  items[Math.floor(rand() * items.length)];

const between = (min: number, max: number) => min + rand() * (max - min);
const intBetween = (min: number, max: number) => Math.round(between(min, max));

const DAY = 24 * 60 * 60 * 1000;
const now = new Date();
/** Midnight today, so snapshot dates line up cleanly on day boundaries. */
const today = new Date(
  Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
);
const daysAgo = (n: number) => new Date(today.getTime() - n * DAY);
const hoursFromNow = (n: number) => new Date(now.getTime() + n * 60 * 60 * 1000);

// ------------------------------------------------------------ demo people

const PEOPLE = [
  {
    key: "owner",
    email: "maya@northwind.studio",
    name: "Maya Oyelaran",
    role: Role.OWNER,
  },
  {
    key: "admin",
    email: "devin@northwind.studio",
    name: "Devin Park",
    role: Role.ADMIN,
  },
  {
    key: "editor",
    email: "rosa@northwind.studio",
    name: "Rosa Iversen",
    role: Role.EDITOR,
  },
  {
    key: "editor2",
    email: "sam@northwind.studio",
    name: "Sam Achebe",
    role: Role.EDITOR,
  },
  {
    key: "viewer",
    email: "nina@northwind.studio",
    name: "Nina Kowalski",
    role: Role.VIEWER,
  },
] as const;

type PersonKey = (typeof PEOPLE)[number]["key"];

/**
 * Creates (or finds) a Supabase auth user per demo person and returns their
 * auth uid. Falls back to generated UUIDs when the service role key is absent —
 * the app still renders, you just can't log in as them until they're linked.
 */
async function resolveUserIds(): Promise<{
  ids: Record<PersonKey, string>;
  authLinked: boolean;
}> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const ids = {} as Record<PersonKey, string>;

  if (!url || !serviceKey) {
    for (const person of PEOPLE) ids[person.key] = randomUUID();
    return { ids, authLinked: false };
  }

  const { createClient } = await import("@supabase/supabase-js");
  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // One page is plenty for a demo org; bump perPage if the list ever grows.
  const { data: existing } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 200,
  });
  const byEmail = new Map(
    (existing?.users ?? []).map((u) => [u.email?.toLowerCase(), u.id])
  );

  for (const person of PEOPLE) {
    const found = byEmail.get(person.email.toLowerCase());
    if (found) {
      ids[person.key] = found;
      continue;
    }

    const { data, error } = await admin.auth.admin.createUser({
      email: person.email,
      password: DEMO_PASSWORD,
      email_confirm: true,
      user_metadata: { name: person.name },
    });

    if (error || !data.user) {
      throw new Error(
        `Failed to create Supabase auth user ${person.email}: ${error?.message}`
      );
    }
    ids[person.key] = data.user.id;
  }

  return { ids, authLinked: true };
}

// ------------------------------------------------------------------ content

const HANDLES: Record<Platform, string> = {
  [Platform.X]: "@northwindstudio",
  [Platform.TIKTOK]: "@northwind.studio",
  [Platform.INSTAGRAM]: "@northwind.studio",
  [Platform.FACEBOOK]: "Northwind Studio",
  [Platform.YOUTUBE]: "@NorthwindStudio",
};

/** Starting follower counts — different orders of magnitude per platform so
 *  charts don't all look the same. */
const FOLLOWER_BASE: Record<Platform, number> = {
  [Platform.X]: 18400,
  [Platform.TIKTOK]: 96200,
  [Platform.INSTAGRAM]: 42800,
  [Platform.FACEBOOK]: 11300,
  [Platform.YOUTUBE]: 27500,
};

const POST_BODIES: Record<Platform, string[]> = {
  [Platform.X]: [
    "Most teams don't have a content problem. They have a decision problem — nobody has said what the account is *for*.",
    "We audited 40 brand accounts this month. The ones growing had one thing in common: they publish on a schedule they can actually keep.",
    "Unpopular take: your best performing post format is probably the one you're bored of.",
    "Thread: seven things we changed about our publishing workflow that cut approval time from 4 days to 6 hours 🧵",
    "Engagement rate is a ratio. If it's falling while reach climbs, that's not a problem — that's distribution working.",
    "Hot take that isn't hot: posting less but editing more beats posting daily and shipping filler.",
    "Every 'algorithm change' panic we've tracked since 2021 resolved the same way — the accounts posting consistently were fine.",
  ],
  [Platform.TIKTOK]: [
    "POV: you're 3 days from a launch and the creative isn't approved. Here's the 20-minute fix.",
    "3 hooks that outperformed everything else we tested this quarter (with the numbers)",
    "Stop starting videos with your logo. Watch what happens to retention when you don't.",
    "Day 4 of building a content system in public. Today: the approval queue.",
    "The 'boring' B-roll shot that carried our best performing video",
    "Answering the question we get most: how many videos before the algorithm 'gets' you?",
  ],
  [Platform.INSTAGRAM]: [
    "Six slides on the content calendar we actually use →",
    "Behind the scenes on this month's campaign shoot. Swipe for the setup that made it work.",
    "Carousel: the 5 metrics we check every Monday, and the 4 we deliberately ignore.",
    "New reel up. The edit took 40 minutes; the idea took two weeks of noticing.",
    "Save this one — our full posting cadence, broken down by platform.",
    "Studio notes: what changed in our workflow this quarter.",
  ],
  [Platform.FACEBOOK]: [
    "We're hosting an open workshop on content operations next month — details and signup in the comments.",
    "A longer post today, because this deserves the room: how we rebuilt our approvals process from scratch, and what broke along the way.",
    "Community question of the week: what's the single biggest bottleneck in your publishing workflow right now?",
    "Recap from last week's session, plus the slides for anyone who couldn't make it.",
    "We've been quiet here for a few weeks. Here's what we were building.",
  ],
  [Platform.YOUTUBE]: [
    "The Content Operating System — how five platforms become one workflow (full walkthrough)",
    "We tested 12 hook formats for 60 days. Here's what actually moved retention.",
    "Building a social media calendar that survives contact with a real team",
    "Why your approval process is the real reason you post inconsistently",
    "Studio tour + the exact gear we use for a two-person content team",
  ],
};

/** Per-platform platformData shapes (§4). Deliberately varied. */
function platformDataFor(platform: Platform, body: string) {
  switch (platform) {
    case Platform.X:
      return body.includes("🧵")
        ? {
            kind: "thread",
            tweets: [
              body,
              "1. We stopped routing every post through the founder. Approval authority moved to whoever owns the channel.",
              "2. Drafts get a deadline, not a due date. A draft with no deadline is an idea.",
              "3. We templated the three formats that work and stopped inventing a new one each week.",
              "4. Anything under 200 characters skips review entirely.",
              "5. The calendar is the source of truth. If it's not on it, it isn't happening.",
            ],
          }
        : { kind: "tweet", characters: body.length };
    case Platform.TIKTOK:
      return {
        kind: "video",
        durationSeconds: intBetween(18, 74),
        sound: pick([
          "original audio — northwind.studio",
          "Sunset Drive — Ivy Sound",
          "trending: Quiet Morning",
        ]),
        hashtags: pick([
          ["contentstrategy", "socialmediamanager", "smallbusiness"],
          ["marketingtips", "creatoreconomy", "behindthescenes"],
          ["socialmediatips", "contentcreator"],
        ]),
      };
    case Platform.INSTAGRAM:
      return body.startsWith("Carousel") || body.includes("slides")
        ? {
            kind: "carousel",
            slides: [
              "The calendar we actually use",
              "Monday: review + approvals",
              "Tuesday: shoot day",
              "Wednesday: edit + schedule",
              "Thursday: engage",
              "Friday: measure",
            ],
          }
        : {
            kind: pick(["reel", "post"]),
            hashtags: ["contentstrategy", "socialmediamarketing", "studiolife"],
          };
    case Platform.FACEBOOK:
      return {
        kind: "post",
        linkPreview: rand() > 0.6 ? "https://northwind.studio/workshop" : null,
        audience: "public",
      };
    case Platform.YOUTUBE:
      return {
        kind: rand() > 0.75 ? "short" : "video",
        title: body,
        thumbnailIdeas: [
          "Split screen: cluttered calendar vs clean calendar",
          "Face left, bold 3-word overlay right",
        ],
        tags: ["content strategy", "social media", "workflow"],
      };
  }
}

const IDEAS: { platform: Platform; content: string; source: string }[] = [
  { platform: Platform.X, content: "Thread: the anatomy of a post that got 400 saves and 11 likes — and why saves matter more", source: "ai" },
  { platform: Platform.X, content: "Rewrite of that competitor thread on posting cadence, but with our actual numbers", source: "swipe-file" },
  { platform: Platform.X, content: "Quote-tweet the industry report with the one chart everyone's misreading", source: "manual" },
  { platform: Platform.TIKTOK, content: "Green-screen reaction to the 'post 3x a day' advice going around", source: "manual" },
  { platform: Platform.TIKTOK, content: "Series: one workflow bottleneck per video, 30 seconds each", source: "ai" },
  { platform: Platform.TIKTOK, content: "Trending sound + our approval-queue-from-hell story", source: "swipe-file" },
  { platform: Platform.INSTAGRAM, content: "Carousel: 7 caption openers ranked by our own save rate", source: "ai" },
  { platform: Platform.INSTAGRAM, content: "Story series — a week in the studio, one frame per day", source: "manual" },
  { platform: Platform.INSTAGRAM, content: "Reel: the 40-minute edit, sped up, with the decisions annotated", source: "manual" },
  { platform: Platform.FACEBOOK, content: "Long-form: what three years of running client content taught us about scope", source: "ai" },
  { platform: Platform.FACEBOOK, content: "Event promo sequence for the November workshop — 4 posts", source: "manual" },
  { platform: Platform.YOUTUBE, content: "Keyword gap: 'social media calendar template' has volume and no good video", source: "ai" },
  { platform: Platform.YOUTUBE, content: "Shorts cutdown of the operations walkthrough — 6 clips", source: "manual" },
  { platform: Platform.YOUTUBE, content: "Response video to the 'AI will replace social managers' take", source: "swipe-file" },
];

const COMPETITORS: { platform: Platform; handle: string; notes: string }[] = [
  { platform: Platform.X, handle: "@buffer", notes: "Best-in-class educational threads. Posts 4x/day, heavy on data pulls." },
  { platform: Platform.X, handle: "@laterdotcom", notes: "Leans product-led. Their hook formats are worth swiping." },
  { platform: Platform.TIKTOK, handle: "@socialmediaexaminer", notes: "Talking-head format, high volume. Retention drops hard after 12s." },
  { platform: Platform.TIKTOK, handle: "@theprofessionalcreator", notes: "Great at the 3-second hook. Study their openers." },
  { platform: Platform.INSTAGRAM, handle: "@planoly", notes: "Carousel-first. Consistent template, strong save rate." },
  { platform: Platform.FACEBOOK, handle: "Social Media Managers Collective", notes: "Group-led growth. Almost no page posting." },
  { platform: Platform.YOUTUBE, handle: "@thinkmedia", notes: "Title/thumbnail discipline is the whole lesson here." },
];

// --------------------------------------------------------------------- seed

async function main() {
  console.log("→ Resolving demo users…");
  const { ids, authLinked } = await resolveUserIds();

  console.log("→ Resetting demo organization…");
  // Cascade deletes take care of every org-scoped table (§4).
  await db.organization.deleteMany({ where: { slug: ORG_SLUG } });

  const org = await db.organization.create({
    data: { name: ORG_NAME, slug: ORG_SLUG },
  });

  console.log("→ Users + memberships…");
  for (const person of PEOPLE) {
    await db.user.upsert({
      where: { id: ids[person.key] },
      update: { email: person.email, name: person.name },
      create: {
        id: ids[person.key],
        email: person.email,
        name: person.name,
        avatarUrl: null,
      },
    });
    await db.membership.create({
      data: { userId: ids[person.key], orgId: org.id, role: person.role },
    });
  }

  console.log("→ Connected accounts (mock) + analytics history…");
  const platforms = Object.values(Platform);
  const accounts = [];

  for (const platform of platforms) {
    const account = await db.connectedAccount.create({
      data: {
        orgId: org.id,
        platform,
        handle: HANDLES[platform],
        status: ConnectedAccountStatus.MOCK,
        meta: {
          displayName: ORG_NAME,
          profileUrl: `https://example.com/${HANDLES[platform].replace("@", "")}`,
          connectedVia: "mock-adapter",
        },
      },
    });
    accounts.push(account);

    // 60–90 days of noisy history (§12): growth trend + weekday seasonality +
    // random walk + occasional spike. Straight lines make Phase 7 unjudgeable.
    // `days` back to and including today ⇒ days + 1 rows, so 59–89 gives 60–90.
    const days = intBetween(59, 89);
    let followers = FOLLOWER_BASE[platform];
    let drift = 0;

    const snapshots = [];
    for (let i = days; i >= 0; i--) {
      const date = daysAgo(i);
      const dow = date.getUTCDay();

      // Weekends are quieter everywhere except TikTok, which is busier.
      const weekend = dow === 0 || dow === 6;
      const seasonality =
        platform === Platform.TIKTOK
          ? weekend
            ? 1.18
            : 0.96
          : weekend
            ? 0.78
            : 1.05;

      // Spike days: a post lands. ~1 in 12.
      const spike = rand() > 0.92 ? between(1.8, 3.4) : 1;

      drift = drift * 0.7 + between(-0.4, 0.9);
      const dailyGrowth = Math.max(
        0,
        Math.round(FOLLOWER_BASE[platform] * 0.0011 + drift * 12 + (spike > 1 ? intBetween(60, 420) : 0))
      );
      followers += dailyGrowth;

      const impressions = Math.round(
        followers * between(0.22, 0.48) * seasonality * spike
      );
      const reach = Math.round(impressions * between(0.55, 0.78));
      const engagement = Math.round(reach * between(0.018, 0.061));
      const clicks = Math.round(engagement * between(0.06, 0.19));

      snapshots.push({
        accountId: account.id,
        date,
        followers,
        reach,
        engagement,
        impressions,
        clicks,
      });
    }

    await db.analyticsSnapshot.createMany({ data: snapshots });
  }

  console.log("→ Campaigns…");
  const campaigns = await Promise.all([
    db.campaign.create({
      data: {
        orgId: org.id,
        name: "Autumn Workshop Series",
        description:
          "Four-week promo run for the November content-operations workshop. Facebook and YouTube lead, X and Instagram support.",
        startDate: daysAgo(21),
        endDate: new Date(today.getTime() + 21 * DAY),
      },
    }),
    db.campaign.create({
      data: {
        orgId: org.id,
        name: "Content OS Launch",
        description:
          "Product launch push across all five platforms. Anchored on the long-form YouTube walkthrough, cut down everywhere else.",
        startDate: daysAgo(6),
        endDate: new Date(today.getTime() + 34 * DAY),
      },
    }),
    db.campaign.create({
      data: {
        orgId: org.id,
        name: "Always-On Education",
        description:
          "Evergreen educational content. No end date — this is the baseline the other campaigns sit on top of.",
        startDate: daysAgo(120),
        endDate: null,
      },
    }),
  ]);

  console.log("→ Posts across every status…");
  const authorPool: PersonKey[] = ["owner", "admin", "editor", "editor2"];

  // Explicit status plan so every PostStatus is represented, not left to chance.
  const statusPlan: PostStatus[] = [
    ...Array<PostStatus>(9).fill(PostStatus.PUBLISHED),
    ...Array<PostStatus>(6).fill(PostStatus.SCHEDULED),
    ...Array<PostStatus>(5).fill(PostStatus.DRAFT),
    ...Array<PostStatus>(4).fill(PostStatus.NEEDS_APPROVAL),
    ...Array<PostStatus>(3).fill(PostStatus.QUEUED),
    ...Array<PostStatus>(2).fill(PostStatus.FAILED),
  ];

  const createdPosts = [];
  for (let i = 0; i < statusPlan.length; i++) {
    const status = statusPlan[i];
    const platform = platforms[i % platforms.length];
    const bodies = POST_BODIES[platform];
    const body = bodies[Math.floor(i / platforms.length) % bodies.length];

    let scheduledAt: Date | null = null;
    let publishedAt: Date | null = null;

    switch (status) {
      case PostStatus.PUBLISHED:
        publishedAt = daysAgo(intBetween(1, 45));
        scheduledAt = publishedAt;
        break;
      case PostStatus.SCHEDULED:
        scheduledAt = hoursFromNow(intBetween(6, 24 * 18));
        break;
      case PostStatus.QUEUED:
        scheduledAt = hoursFromNow(intBetween(1, 8));
        break;
      case PostStatus.FAILED:
        scheduledAt = daysAgo(intBetween(1, 5));
        break;
      case PostStatus.NEEDS_APPROVAL:
        scheduledAt = hoursFromNow(intBetween(24, 24 * 7));
        break;
      case PostStatus.DRAFT:
        break;
    }

    // Roughly two thirds of posts belong to a campaign.
    const campaign = rand() > 0.34 ? pick(campaigns) : null;

    const post = await db.post.create({
      data: {
        orgId: org.id,
        platform,
        status,
        body,
        platformData: platformDataFor(platform, body) as object,
        campaignId: campaign?.id ?? null,
        authorId: ids[pick(authorPool)],
        scheduledAt,
        publishedAt,
      },
    });
    createdPosts.push(post);
  }

  console.log("→ Ideas…");
  await db.idea.createMany({
    data: IDEAS.map((idea) => ({
      orgId: org.id,
      platform: idea.platform,
      content: idea.content,
      source: idea.source,
    })),
  });

  console.log("→ Brand voice…");
  await db.brandVoice.create({
    data: {
      orgId: org.id,
      tone: "Direct and warm. Opinionated without being combative. Writes like a practitioner talking to a peer, never like a brand talking to an audience.",
      audience:
        "In-house social media managers and small agency teams (2–15 people) who are responsible for output across several platforms and are chronically short on time.",
      emojiUsage: "light",
      ctaStyle:
        "Soft and specific. Ask a real question or point at one concrete next step. Never 'link in bio 🔥' or 'drop a comment below'.",
      readingLevel: "Grade 8 — short sentences, concrete nouns, no jargon that isn't load-bearing.",
      avoidWords: [
        "leverage",
        "synergy",
        "game-changer",
        "unlock",
        "supercharge",
        "revolutionary",
        "seamless",
        "delve",
      ],
      terminology: {
        "social media manager": "prefer over 'content creator' when addressing the audience",
        Studio: "always capitalised when referring to a SocialOS Studio",
        "content calendar": "not 'editorial calendar'",
      },
    },
  });

  console.log("→ Competitors…");
  await db.competitor.createMany({
    data: COMPETITORS.map((c) => ({
      orgId: org.id,
      platform: c.platform,
      handle: c.handle,
      notes: c.notes,
    })),
  });

  console.log("→ Asset library…");
  const brandFolder = await db.folder.create({
    data: { orgId: org.id, name: "Brand" },
  });
  const campaignFolder = await db.folder.create({
    data: { orgId: org.id, name: "Campaigns" },
  });
  const workshopFolder = await db.folder.create({
    data: { orgId: org.id, name: "Autumn Workshop", parentId: campaignFolder.id },
  });

  await db.asset.createMany({
    data: [
      { orgId: org.id, type: "brand-asset", name: "Northwind wordmark (dark)", url: "https://assets.example.com/northwind/wordmark-dark.svg", folderId: brandFolder.id, tags: ["logo", "brand"] },
      { orgId: org.id, type: "brand-asset", name: "Northwind wordmark (light)", url: "https://assets.example.com/northwind/wordmark-light.svg", folderId: brandFolder.id, tags: ["logo", "brand"] },
      { orgId: org.id, type: "document", name: "Brand guidelines v3", url: "https://assets.example.com/northwind/guidelines-v3.pdf", folderId: brandFolder.id, tags: ["brand", "reference"] },
      { orgId: org.id, type: "image", name: "Studio shoot — wide", url: "https://assets.example.com/northwind/studio-wide.jpg", folderId: workshopFolder.id, tags: ["photo", "workshop", "bts"] },
      { orgId: org.id, type: "image", name: "Studio shoot — desk detail", url: "https://assets.example.com/northwind/studio-desk.jpg", folderId: workshopFolder.id, tags: ["photo", "workshop"] },
      { orgId: org.id, type: "image", name: "Workshop promo — carousel base", url: "https://assets.example.com/northwind/workshop-carousel.png", folderId: workshopFolder.id, tags: ["carousel", "instagram", "workshop"] },
      { orgId: org.id, type: "video", name: "Operations walkthrough — master", url: "https://assets.example.com/northwind/walkthrough-master.mp4", folderId: campaignFolder.id, tags: ["youtube", "launch"] },
      { orgId: org.id, type: "video", name: "Walkthrough cutdown — 30s", url: "https://assets.example.com/northwind/walkthrough-30s.mp4", folderId: campaignFolder.id, tags: ["tiktok", "reel", "launch"] },
      { orgId: org.id, type: "image", name: "Thumbnail A/B — calendar split", url: "https://assets.example.com/northwind/thumb-calendar.png", folderId: campaignFolder.id, tags: ["thumbnail", "youtube"] },
    ],
  });

  console.log("→ Tasks, comments, notifications, activity…");
  const approvalPosts = createdPosts.filter(
    (p) => p.status === PostStatus.NEEDS_APPROVAL
  );
  const failedPosts = createdPosts.filter((p) => p.status === PostStatus.FAILED);

  await db.task.createMany({
    data: [
      { orgId: org.id, title: "Approve the workshop promo carousel", status: TaskStatus.TODO, assigneeId: ids.admin, dueDate: hoursFromNow(20), entityType: approvalPosts[0] ? "post" : null, entityId: approvalPosts[0]?.id ?? null },
      { orgId: org.id, title: "Cut 6 Shorts from the operations walkthrough", status: TaskStatus.IN_PROGRESS, assigneeId: ids.editor, dueDate: hoursFromNow(72) },
      { orgId: org.id, title: "Refresh the X swipe file — Q4 pull", status: TaskStatus.TODO, assigneeId: ids.editor2, dueDate: hoursFromNow(24 * 6) },
      { orgId: org.id, title: "Retry the failed Facebook post", status: TaskStatus.TODO, assigneeId: ids.admin, dueDate: hoursFromNow(4), entityType: failedPosts[0] ? "post" : null, entityId: failedPosts[0]?.id ?? null },
      { orgId: org.id, title: "Write the campaign brief for Content OS Launch", status: TaskStatus.DONE, assigneeId: ids.owner, dueDate: daysAgo(3), entityType: "campaign", entityId: campaigns[1].id },
      { orgId: org.id, title: "Book the November workshop venue", status: TaskStatus.DONE, assigneeId: ids.owner, dueDate: daysAgo(9) },
      { orgId: org.id, title: "Audit competitor hooks — TikTok", status: TaskStatus.IN_PROGRESS, assigneeId: ids.editor, dueDate: hoursFromNow(24 * 3) },
    ],
  });

  const commentTargets = createdPosts.slice(0, 6);
  await db.comment.createMany({
    data: [
      { orgId: org.id, userId: ids.admin, body: "Hook is strong but the second line buries it. Can we cut the qualifier?", postId: commentTargets[0]?.id ?? null },
      { orgId: org.id, userId: ids.editor, body: "Tightened — take another look.", postId: commentTargets[0]?.id ?? null },
      { orgId: org.id, userId: ids.owner, body: "Approved. Ship it in the Tuesday slot, not Monday — Monday's already crowded.", postId: commentTargets[1]?.id ?? null },
      { orgId: org.id, userId: ids.viewer, body: "Small thing: we say 'content calendar' not 'editorial calendar' per the voice guide.", postId: commentTargets[2]?.id ?? null },
      { orgId: org.id, userId: ids.editor2, body: "Pulled the numbers for this — engagement rate was 4.1%, not 3.2%. Updated.", postId: commentTargets[3]?.id ?? null },
      { orgId: org.id, userId: ids.admin, body: "Let's hold this until the launch video is live so the CTA has somewhere to point.", entityType: "campaign", entityId: campaigns[1].id },
    ],
  });

  await db.notification.createMany({
    data: [
      { orgId: org.id, userId: ids.admin, type: "post-approved", body: "Maya approved “Autumn Workshop — carousel promo”.", read: false, link: "/calendar" },
      { orgId: org.id, userId: ids.admin, type: "approval-requested", body: "Rosa submitted 3 posts for approval.", read: false, link: "/calendar" },
      { orgId: org.id, userId: ids.admin, type: "publish-failed", body: "A Facebook post failed to publish — token needs reconnecting.", read: false, link: "/settings" },
      { orgId: org.id, userId: ids.admin, type: "trend-alert", body: "“content operations” is trending on X in your category.", read: true, link: "/studio/x" },
      { orgId: org.id, userId: ids.editor, type: "mention", body: "Devin mentioned you on “Thread: seven things we changed…”.", read: false, link: "/studio/x" },
      { orgId: org.id, userId: ids.editor, type: "task-assigned", body: "You were assigned “Cut 6 Shorts from the operations walkthrough”.", read: true, link: "/team" },
      { orgId: org.id, userId: ids.owner, type: "milestone", body: "TikTok crossed 100K followers.", read: false, link: "/analytics" },
    ],
  });

  await db.activityLog.createMany({
    data: [
      { orgId: org.id, userId: ids.owner, action: "org.created", entityType: "organization", entityId: org.id, createdAt: daysAgo(120) },
      { orgId: org.id, userId: ids.owner, action: "member.invited", entityType: "user", entityId: ids.admin, createdAt: daysAgo(118) },
      { orgId: org.id, userId: ids.owner, action: "member.invited", entityType: "user", entityId: ids.editor, createdAt: daysAgo(96) },
      { orgId: org.id, userId: ids.admin, action: "integration.connected", entityType: "connectedAccount", entityId: accounts[0].id, createdAt: daysAgo(90), metadata: { platform: "X", mode: "mock" } },
      { orgId: org.id, userId: ids.admin, action: "campaign.created", entityType: "campaign", entityId: campaigns[0].id, createdAt: daysAgo(21) },
      { orgId: org.id, userId: ids.editor, action: "post.created", entityType: "post", entityId: createdPosts[0].id, createdAt: daysAgo(12) },
      { orgId: org.id, userId: ids.admin, action: "post.approved", entityType: "post", entityId: createdPosts[1].id, createdAt: daysAgo(11) },
      { orgId: org.id, userId: ids.admin, action: "post.published", entityType: "post", entityId: createdPosts[1].id, createdAt: daysAgo(11) },
      { orgId: org.id, userId: ids.editor2, action: "asset.uploaded", entityType: "folder", entityId: workshopFolder.id, createdAt: daysAgo(8) },
      { orgId: org.id, userId: ids.owner, action: "brandVoice.updated", entityType: "brandVoice", entityId: org.id, createdAt: daysAgo(5) },
      { orgId: org.id, userId: ids.editor, action: "post.submittedForApproval", entityType: "post", entityId: createdPosts[2].id, createdAt: daysAgo(2) },
    ],
  });

  // ------------------------------------------------------------------ report
  const counts = {
    users: await db.user.count(),
    accounts: await db.connectedAccount.count({ where: { orgId: org.id } }),
    snapshots: await db.analyticsSnapshot.count({
      where: { account: { orgId: org.id } },
    }),
    posts: await db.post.count({ where: { orgId: org.id } }),
    campaigns: await db.campaign.count({ where: { orgId: org.id } }),
    ideas: await db.idea.count({ where: { orgId: org.id } }),
    assets: await db.asset.count({ where: { orgId: org.id } }),
    competitors: await db.competitor.count({ where: { orgId: org.id } }),
    tasks: await db.task.count({ where: { orgId: org.id } }),
    notifications: await db.notification.count({ where: { orgId: org.id } }),
  };

  console.log("\n✓ Seeded %s (%s)", ORG_NAME, ORG_SLUG);
  console.table(counts);

  if (authLinked) {
    console.log("\nSupabase auth users created. Log in with any of:");
    for (const p of PEOPLE) {
      console.log(`  ${p.role.padEnd(6)}  ${p.email}  /  ${DEMO_PASSWORD}`);
    }
  } else {
    console.log(
      "\n⚠ SUPABASE_SERVICE_ROLE_KEY not set — profile rows were seeded with\n" +
        "  generated ids, so you cannot log in as them yet. Either:\n" +
        "    a) set NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY and re-run\n" +
        "       `npx prisma db seed`, or\n" +
        "    b) sign up in the app, then point a membership at your new user id."
    );
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
