import { z } from "zod";

import { assertCan } from "@/lib/auth/permissions";
import type { Session } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { assetSchema, folderSchema } from "@/lib/validators/misc";
import { logActivity } from "@/modules/activity/service";

export async function listFolders(session: Session) {
  return db.folder.findMany({
    where: { orgId: session.orgId },
    include: { _count: { select: { assets: true } } },
    orderBy: { name: "asc" },
  });
}

export async function listAssets(
  session: Session,
  filters: { folderId?: string | null; query?: string; tag?: string } = {}
) {
  const query = filters.query?.trim();

  return db.asset.findMany({
    where: {
      orgId: session.orgId,
      ...(filters.folderId !== undefined ? { folderId: filters.folderId } : {}),
      ...(filters.tag ? { tags: { has: filters.tag } } : {}),
      ...(query
        ? {
            OR: [
              { name: { contains: query, mode: "insensitive" as const } },
              { tags: { has: query.toLowerCase() } },
            ],
          }
        : {}),
    },
    include: { folder: true },
    orderBy: { createdAt: "desc" },
  });
}

export async function createFolder(
  session: Session,
  input: z.input<typeof folderSchema>
) {
  assertCan(session.role, "asset.upload");
  const data = folderSchema.parse(input);
  return db.folder.create({ data: { orgId: session.orgId, ...data } });
}

export async function createAsset(
  session: Session,
  input: z.input<typeof assetSchema>
) {
  assertCan(session.role, "asset.upload");
  const data = assetSchema.parse(input);

  const asset = await db.asset.create({
    data: { orgId: session.orgId, ...data },
  });
  await logActivity(session, "asset.uploaded", "asset", asset.id, {
    name: asset.name,
  });
  return asset;
}

export async function deleteAsset(session: Session, id: string) {
  assertCan(session.role, "asset.upload");
  const result = await db.asset.deleteMany({
    where: { id, orgId: session.orgId },
  });
  if (result.count === 0) throw new Error("Asset not found");
}

/** Every distinct tag in the org, for the filter bar. */
export async function listTags(session: Session) {
  const assets = await db.asset.findMany({
    where: { orgId: session.orgId },
    select: { tags: true },
  });
  return [...new Set(assets.flatMap((a) => a.tags))].sort();
}
