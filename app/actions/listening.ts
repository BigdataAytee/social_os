"use server";

import { revalidatePath } from "next/cache";
import type { MonitorKind, Platform } from "@prisma/client";

import { requireSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import {
  addCompetitor,
  removeCompetitor,
  syncCompetitor,
} from "@/modules/competitors/service";
import {
  createMonitor,
  deleteMonitor,
  scanMonitors,
  setMonitorActive,
} from "@/modules/listening/service";
import { toActionResult, type ActionResult } from "./result";

/**
 * Listening and competitor actions (OS-ARCHITECTURE.md §11 stage 6).
 *
 * Creating a monitor scans immediately rather than waiting for the nightly job.
 * A monitor that shows nothing for a day looks broken, and the corpora are
 * already in the database — there is nothing to wait for.
 */

export async function createMonitorAction(input: {
  term: string;
  kind?: MonitorKind;
  platform?: Platform | null;
}): Promise<ActionResult<{ id: string; matched: number }>> {
  return toActionResult(async () => {
    const session = await requireSession();
    const monitor = await createMonitor(session, input);
    const scan = await scanMonitors(session.orgId);
    revalidatePath("/listening");
    return { id: monitor.id, matched: scan.matched };
  });
}

export async function setMonitorActiveAction(input: {
  id: string;
  active: boolean;
}): Promise<ActionResult<{ active: boolean }>> {
  return toActionResult(async () => {
    const session = await requireSession();
    const monitor = await setMonitorActive(session, input);
    revalidatePath("/listening");
    return { active: monitor.active };
  });
}

export async function deleteMonitorAction(input: {
  id: string;
}): Promise<ActionResult<{ deleted: true }>> {
  return toActionResult(async () => {
    const session = await requireSession();
    await deleteMonitor(session, input.id);
    revalidatePath("/listening");
    return { deleted: true };
  });
}

export async function scanMonitorsAction(): Promise<
  ActionResult<{ scanned: number; matched: number }>
> {
  return toActionResult(async () => {
    const session = await requireSession();
    const result = await scanMonitors(session.orgId);
    revalidatePath("/listening");
    return result;
  });
}

export async function addCompetitorAction(input: {
  platform: Platform;
  handle: string;
  notes?: string;
}): Promise<ActionResult<{ id: string; posts: number; note?: string }>> {
  return toActionResult(async () => {
    const session = await requireSession();
    const competitor = await addCompetitor(session, input);
    // Pulled immediately for the same reason monitors scan immediately: an
    // empty competitor card teaches nothing about whether tracking works.
    const synced = await syncCompetitor(session, competitor.id);
    revalidatePath("/listening");
    return {
      id: competitor.id,
      posts: synced.posts,
      note: synced.unsupported,
    };
  });
}

export async function removeCompetitorAction(input: {
  id: string;
}): Promise<ActionResult<{ removed: true }>> {
  return toActionResult(async () => {
    const session = await requireSession();
    await removeCompetitor(session, input.id);
    revalidatePath("/listening");
    return { removed: true };
  });
}

/** Pull every tracked competitor now, then rescan monitors over the result. */
export async function syncCompetitorsAction(): Promise<
  ActionResult<{ posts: number; matched: number; notes: string[] }>
> {
  return toActionResult(async () => {
    const session = await requireSession();
    const competitors = await db.competitor.findMany({
      where: { orgId: session.orgId },
      select: { id: true, handle: true },
    });

    let posts = 0;
    const notes: string[] = [];

    for (const competitor of competitors) {
      try {
        const result = await syncCompetitor(session, competitor.id);
        posts += result.posts;
        if (result.unsupported) {
          notes.push(`${competitor.handle}: ${result.unsupported}`);
        }
      } catch (error) {
        notes.push(
          `${competitor.handle}: ${error instanceof Error ? error.message : "sync failed"}`
        );
      }
    }

    // Rescan after, not before: monitors that watch a rival's subjects should
    // see what was just pulled, in the same click.
    const scan = await scanMonitors(session.orgId);
    revalidatePath("/listening");
    return { posts, matched: scan.matched, notes };
  });
}
