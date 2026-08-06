"use server";

import { revalidatePath } from "next/cache";
import { ConnectedAccountStatus, IntegrationMode, type Platform } from "@prisma/client";

import { assertCan } from "@/lib/auth/permissions";
import { requireSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { logActivity } from "@/modules/activity/service";
import { syncAccount } from "@/modules/integrations/sync";
import { toActionResult, type ActionResult } from "./result";

/**
 * Choosing a connection type (Platform-Connections.md §4).
 *
 * The rule that shapes all of this: **switching an already-connected account's
 * mode is an explicit reconnect, not a silent migration.** It changes who holds
 * the credential — your own OAuth app, or the provider — and the org should
 * always know that happened. So this action never moves a live credential
 * between modes; it either sets the mode on an account that has none, or
 * disconnects and asks you to connect again.
 */

export type ModeChangeOutcome =
  /** Mode set; nothing was connected, so nothing had to be revoked. */
  | { kind: "set" }
  /** Was connected under another mode — credential dropped, reconnect needed. */
  | { kind: "reconnect-required"; previous: IntegrationMode };

export async function setConnectionModeAction(input: {
  accountId: string;
  platform: Platform;
  mode: IntegrationMode | null;
}): Promise<ActionResult<ModeChangeOutcome>> {
  return toActionResult(async () => {
    const session = await requireSession();
    assertCan(session.role, "integration.manage");

    const account = await db.connectedAccount.findFirst({
      where: { id: input.accountId, orgId: session.orgId },
      include: { credential: { select: { accountId: true } } },
    });
    if (!account) throw new Error("Account not found");
    if (account.integrationMode === input.mode) return { kind: "set" as const };

    const wasConnected = account.credential !== null;
    const previous = account.integrationMode;

    await db.$transaction(async (tx) => {
      if (wasConnected) {
        // The credential is only valid for the mode that produced it: a
        // platform token means nothing to the provider, and a provider
        // reference means nothing to the platform. Carrying it across would
        // leave an account that looks connected and fails on first use.
        await tx.platformCredential.deleteMany({
          where: { accountId: account.id },
        });
      }
      await tx.connectedAccount.update({
        where: { id: account.id },
        data: {
          integrationMode: input.mode,
          status: wasConnected
            ? ConnectedAccountStatus.DISCONNECTED
            : input.mode === null
              ? ConnectedAccountStatus.MOCK
              : account.status,
          lastSyncError: null,
        },
      });
    });

    await logActivity(session, "integration.mode-changed", "account", account.id, {
      platform: input.platform,
      from: previous,
      to: input.mode,
    });

    revalidatePath("/settings");
    revalidatePath(`/studio/${input.platform.toLowerCase()}`);

    return wasConnected && previous
      ? ({ kind: "reconnect-required", previous } as const)
      : ({ kind: "set" } as const);
  });
}

/**
 * Connect an account through the unified provider.
 *
 * Deliberately different in shape from the direct flow: there is no OAuth URL to
 * build, because the provider has already done each platform's dance. §2 step 2
 * — for unified you initiate *their* flow rather than constructing the
 * platform's auth URL yourself.
 *
 * The provider's hosted connect page is where the user actually approves, on the
 * platform's own unmodified consent screen (§2 step 3). This records the
 * resulting account reference; wiring the hosted redirect is a provider-account
 * task, not a code one, so the reference is supplied rather than fetched.
 */
export async function connectUnifiedAction(input: {
  accountId: string;
  platform: Platform;
  accountReference: string;
}): Promise<ActionResult<{ synced: number }>> {
  return toActionResult(async () => {
    const session = await requireSession();
    assertCan(session.role, "integration.manage");

    const reference = input.accountReference.trim();
    if (!reference) throw new Error("Enter the provider's account reference.");

    const account = await db.connectedAccount.findFirst({
      where: { id: input.accountId, orgId: session.orgId },
    });
    if (!account) throw new Error("Account not found");

    // Encrypted exactly like a platform token: §3 is explicit that a provider
    // reference is still sensitive, because it authorises actions on the user's
    // behalf.
    const { sealJson } = await import("@/lib/crypto");
    const sealed = sealJson({ accessToken: reference });

    await db.platformCredential.upsert({
      where: { accountId: account.id },
      update: { ...sealed, externalId: reference, scopes: [], expiresAt: null },
      create: {
        accountId: account.id,
        ...sealed,
        externalId: reference,
        scopes: [],
      },
    });
    await db.connectedAccount.update({
      where: { id: account.id },
      data: {
        integrationMode: IntegrationMode.UNIFIED,
        status: ConnectedAccountStatus.CONNECTED,
        lastSyncError: null,
      },
    });

    await logActivity(session, "integration.connected", "account", account.id, {
      platform: input.platform,
      mode: "UNIFIED",
    });

    // §2 step 7: pull immediately, so the account isn't sitting empty until the
    // next scheduled sync.
    let synced = 0;
    try {
      synced = (await syncAccount(session, account.id)).posts;
    } catch {
      // The connection is real even if the first pull failed; syncAccount has
      // already recorded why on the account row.
    }

    revalidatePath("/settings");
    revalidatePath(`/studio/${input.platform.toLowerCase()}`);
    return { synced };
  });
}
