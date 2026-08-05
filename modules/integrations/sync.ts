import { ConnectedAccountStatus, Platform } from "@prisma/client";

import { assertCan } from "@/lib/auth/permissions";
import type { Session } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { logActivity } from "@/modules/activity/service";
import { getAdapter } from "./registry";

/**
 * Pulling platform data into the database.
 *
 * Writes are upserts keyed on (accountId, externalId) and (accountId, date), so
 * a re-sync of an overlapping window refreshes metrics rather than duplicating
 * rows — which matters because engagement on a post keeps moving for days after
 * it goes out, and the whole point of re-syncing is to catch that.
 */

/** How far back a sync reaches when the account has never been pulled. */
const FIRST_SYNC_DAYS = 90;
/** Overlap on subsequent syncs, so late-arriving engagement is picked up. */
const RESYNC_OVERLAP_DAYS = 7;

export type SyncResult = {
  accountId: string;
  platform: Platform;
  handle: string;
  posts: number;
  snapshots: number;
};

function windowStart(lastSyncAt: Date | null): Date {
  const days = lastSyncAt === null ? FIRST_SYNC_DAYS : RESYNC_OVERLAP_DAYS;
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - days);

  // Never reach further back than the last sync minus the overlap — a long-idle
  // account shouldn't silently re-pull a quarter of history.
  if (lastSyncAt) {
    const fromLast = new Date(lastSyncAt);
    fromLast.setUTCDate(fromLast.getUTCDate() - RESYNC_OVERLAP_DAYS);
    return fromLast < start ? fromLast : start;
  }
  return start;
}

/**
 * Pull one account. Records the failure reason on the account row before
 * rethrowing, so the Studio can explain a broken connection without the caller
 * having to catch and store anything.
 */
export async function syncAccount(
  session: Session,
  accountId: string
): Promise<SyncResult> {
  assertCan(session.role, "integration.manage");

  const account = await db.connectedAccount.findFirst({
    where: { id: accountId, orgId: session.orgId },
  });
  if (!account) throw new Error("Account not found");

  const since = windowStart(account.lastSyncAt);
  const adapter = getAdapter(account.platform);

  try {
    const [posts, snapshots] = await Promise.all([
      adapter.fetchPosts(account.id, since),
      adapter.fetchAnalytics(account.id, since),
    ]);

    for (const post of posts) {
      const data = {
        orgId: account.orgId,
        accountId: account.id,
        permalink: post.permalink,
        text: post.text,
        mediaType: post.mediaType,
        publishedAt: post.publishedAt,
        likes: post.likes,
        comments: post.comments,
        shares: post.shares,
        views: post.views,
        metrics: post.metrics,
        fetchedAt: new Date(),
      };
      await db.externalPost.upsert({
        where: {
          accountId_externalId: {
            accountId: account.id,
            externalId: post.externalId,
          },
        },
        update: data,
        create: { ...data, externalId: post.externalId },
      });
    }

    for (const snapshot of snapshots) {
      const data = {
        followers: snapshot.followers,
        reach: snapshot.reach,
        engagement: snapshot.engagement,
        impressions: snapshot.impressions,
        clicks: snapshot.clicks,
      };
      await db.analyticsSnapshot.upsert({
        where: {
          accountId_date: { accountId: account.id, date: snapshot.date },
        },
        update: data,
        create: { accountId: account.id, date: snapshot.date, ...data },
      });
    }

    await db.connectedAccount.update({
      where: { id: account.id },
      data: {
        lastSyncAt: new Date(),
        lastSyncError: null,
        // A MOCK account that just pulled real rows is connected; leave a
        // DISCONNECTED one alone rather than reviving it behind the person's back.
        ...(account.status === ConnectedAccountStatus.ERROR ||
        account.status === ConnectedAccountStatus.MOCK
          ? { status: ConnectedAccountStatus.CONNECTED }
          : {}),
      },
    });

    await logActivity(session, "integration.synced", "account", account.id, {
      platform: account.platform,
      posts: posts.length,
    });

    return {
      accountId: account.id,
      platform: account.platform,
      handle: account.handle,
      posts: posts.length,
      snapshots: snapshots.length,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "The sync failed.";
    await db.connectedAccount.update({
      where: { id: account.id },
      data: {
        status: ConnectedAccountStatus.ERROR,
        lastSyncError: message.slice(0, 500),
      },
    });
    throw error;
  }
}

/**
 * Pull every account for a platform (or the whole org).
 *
 * One account's failure must not abort the others — a revoked Instagram token
 * should not stop X from refreshing — so failures are collected and returned
 * rather than thrown.
 */
export async function syncOrg(
  session: Session,
  platform?: Platform
): Promise<{ synced: SyncResult[]; failed: { handle: string; error: string }[] }> {
  assertCan(session.role, "integration.manage");

  const accounts = await db.connectedAccount.findMany({
    where: {
      orgId: session.orgId,
      ...(platform ? { platform } : {}),
      status: { not: ConnectedAccountStatus.DISCONNECTED },
    },
  });

  const synced: SyncResult[] = [];
  const failed: { handle: string; error: string }[] = [];

  for (const account of accounts) {
    try {
      synced.push(await syncAccount(session, account.id));
    } catch (error) {
      failed.push({
        handle: account.handle,
        error: error instanceof Error ? error.message : "Sync failed",
      });
    }
  }

  return { synced, failed };
}

export async function listExternalPosts(
  session: Session,
  opts: { platform?: Platform; since?: Date; take?: number } = {}
) {
  return db.externalPost.findMany({
    where: {
      orgId: session.orgId,
      ...(opts.platform ? { account: { platform: opts.platform } } : {}),
      ...(opts.since ? { publishedAt: { gte: opts.since } } : {}),
    },
    include: { account: { select: { platform: true, handle: true } } },
    orderBy: { publishedAt: "desc" },
    take: opts.take ?? 200,
  });
}

export type ExternalPostRow = Awaited<
  ReturnType<typeof listExternalPosts>
>[number];
