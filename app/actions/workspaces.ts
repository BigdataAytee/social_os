"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import type { Role } from "@prisma/client";

import { ACTIVE_ORG_COOKIE, requireSession } from "@/lib/auth/session";
import {
  canAccessWorkspace,
  createClientWorkspace,
  inviteToWorkspace,
  listWorkspaces,
} from "@/modules/workspaces/service";
import { toActionResult, type ActionResult } from "./result";

/**
 * Workspace switching (OS-ARCHITECTURE.md §11 stage 3).
 *
 * The switch writes a cookie and nothing else. Authorisation happens on *read*,
 * in `getSessionResult`, which re-checks the membership every request — so a
 * cookie that outlives a membership stops working the moment the membership
 * does, rather than at whatever point something noticed.
 */
export async function switchWorkspaceAction(input: {
  orgId: string;
}): Promise<ActionResult<{ orgId: string }>> {
  return toActionResult(async () => {
    const session = await requireSession();

    // Checked here too, so a rejected switch says so instead of silently
    // landing the user back where they started with no explanation.
    if (!(await canAccessWorkspace(session.userId, input.orgId))) {
      throw new Error("You don't have access to that workspace");
    }

    cookies().set(ACTIVE_ORG_COOKIE, input.orgId, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });

    // Everything on screen belongs to the old workspace.
    revalidatePath("/", "layout");
    return { orgId: input.orgId };
  });
}

export async function createWorkspaceAction(input: {
  name: string;
}): Promise<ActionResult<{ id: string; name: string }>> {
  return toActionResult(async () => {
    const session = await requireSession();
    const workspace = await createClientWorkspace(session, input);
    revalidatePath("/settings");
    return { id: workspace.id, name: workspace.name };
  });
}

export async function inviteMemberAction(input: {
  orgId: string;
  email: string;
  role: Role;
}): Promise<ActionResult<{ role: Role }>> {
  return toActionResult(async () => {
    const session = await requireSession();
    const membership = await inviteToWorkspace(session, input);
    revalidatePath("/team");
    return { role: membership.role };
  });
}

export async function listWorkspacesAction(): Promise<
  ActionResult<Awaited<ReturnType<typeof listWorkspaces>>>
> {
  return toActionResult(async () => {
    const session = await requireSession();
    return listWorkspaces(session);
  });
}
