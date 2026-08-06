"use server";

import { revalidatePath } from "next/cache";
import { ConnectedAccountStatus, IntegrationMode, type Platform } from "@prisma/client";

import { assertCan } from "@/lib/auth/permissions";
import { requireSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { isValidTimeZone } from "@/lib/time";
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
  /**
   * Optional. Omitted means "use the provider's primary profile", which is the
   * one-click case and what a single-brand deployment wants.
   */
  accountReference?: string;
}): Promise<ActionResult<{ synced: number; primary: boolean }>> {
  return toActionResult(async () => {
    const session = await requireSession();
    assertCan(session.role, "integration.manage");

    const reference = input.accountReference?.trim() ?? "";
    const usingPrimary = reference.length === 0;

    const account = await db.connectedAccount.findFirst({
      where: { id: input.accountId, orgId: session.orgId },
    });
    if (!account) throw new Error("Account not found");

    // **The guard that makes the one-click path safe.**
    //
    // Without a profile key every call answers for the provider's primary
    // profile. For one brand that is exactly right. For two organizations in
    // the same deployment it is a cross-tenant read: both would be looking at
    // whichever account the provider considers primary, and each would believe
    // it was their own.
    //
    // So the simple path stays available right up to the moment it stops being
    // safe, and then says why rather than silently sharing.
    if (usingPrimary) {
      const otherOrg = await db.connectedAccount.findFirst({
        where: {
          orgId: { not: session.orgId },
          integrationMode: IntegrationMode.UNIFIED,
          credential: { isNot: null },
          meta: { path: ["unifiedPrimary"], equals: true },
        },
        select: { id: true },
      });
      if (otherOrg) {
        throw new Error(
          "Another workspace in this deployment is already using the provider's primary profile. Create a profile for this workspace with your provider and paste its key below, or you'd both be reading the same account."
        );
      }
    }

    // Encrypted exactly like a platform token: §3 is explicit that a provider
    // reference is still sensitive, because it authorises actions on the user's
    // behalf.
    const { sealJson } = await import("@/lib/crypto");
    // Sealed either way. An empty reference still gets a credential row,
    // because "connected" is defined across this codebase as "has a
    // credential" — an account without one is treated as not connected by the
    // publish path, the sync scheduler and the inbox alike. Special-casing
    // primary-profile connections as credential-less would mean revisiting
    // every one of those.
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
        // Recorded so the guard above can find it, and so the card can say
        // which profile this account is actually reading.
        meta: { ...(account.meta as object | null), unifiedPrimary: usingPrimary },
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
    return { synced, primary: usingPrimary };
  });
}

/**
 * Region, timezone and language for one account.
 *
 * Stored per account rather than per organization because an agency running a
 * client's US TikTok and UK Instagram needs different answers for each, and a
 * single workspace-wide setting would make one of them wrong.
 *
 * Validated against the runtime's own ICU data rather than a hand-kept list —
 * a timezone this process can't resolve would silently fall back to UTC inside
 * `Intl`, reintroducing the exact bug this field exists to fix.
 */
export async function setAccountLocaleAction(input: {
  accountId: string;
  timezone: string | null;
  region: string | null;
  language: string | null;
}): Promise<ActionResult<{ timezone: string | null }>> {
  return toActionResult(async () => {
    const session = await requireSession();
    assertCan(session.role, "integration.manage");

    const account = await db.connectedAccount.findFirst({
      where: { id: input.accountId, orgId: session.orgId },
      select: { id: true, platform: true },
    });
    if (!account) throw new Error("Account not found");

    const timezone = input.timezone?.trim() || null;
    if (timezone && !isValidTimeZone(timezone)) {
      throw new Error(`"${timezone}" isn't a timezone this server recognises.`);
    }

    const region = input.region?.trim().toUpperCase() || null;
    if (region && !/^[A-Z]{2}$/.test(region)) {
      throw new Error("Region must be a two-letter country code, like NG or GB.");
    }

    const language = input.language?.trim() || null;

    const updated = await db.connectedAccount.update({
      where: { id: account.id },
      data: { timezone, region, language },
    });

    await logActivity(session, "integration.locale-set", "account", account.id, {
      timezone,
      region,
      language,
    });

    revalidatePath("/settings");
    revalidatePath(`/studio/${account.platform.toLowerCase()}`);
    return { timezone: updated.timezone };
  });
}
