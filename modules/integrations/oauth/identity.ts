import { Platform } from "@prisma/client";

/**
 * "Who did we just connect?" — one call per platform, right after the token
 * exchange, before anything is written.
 *
 * The handle is part of ConnectedAccount's unique key, so getting it from the
 * platform rather than asking the user is what makes reconnecting land on the
 * same row instead of creating a duplicate.
 *
 * Meta is the awkward one: a Facebook or Instagram *user* token is not what the
 * insights endpoints want. Both need a Page — and Instagram needs the business
 * account attached to that Page — so the identity call also swaps the user
 * token for a Page token and hands it back for storage.
 */

export type PlatformIdentity = {
  externalId: string;
  handle: string;
  meta: Record<string, unknown>;
  /** Set when the platform requires a different token than the one issued. */
  replacementToken?: string;
};

/** Read per call — see the note on apiBase in live-adapter.ts. */
function graph(): string {
  return process.env.SOCIALOS_API_BASE_META ?? "https://graph.facebook.com/v21.0";
}

async function getJson<T>(url: string, token?: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `${new URL(url).pathname} returned ${response.status}: ${body.slice(0, 200)}`
    );
  }
  return (await response.json()) as T;
}

export async function fetchIdentity(
  platform: Platform,
  accessToken: string
): Promise<PlatformIdentity> {
  switch (platform) {
    case Platform.X:
      return xIdentity(accessToken);
    case Platform.TIKTOK:
      return tiktokIdentity(accessToken);
    case Platform.YOUTUBE:
      return youtubeIdentity(accessToken);
    case Platform.FACEBOOK:
      return facebookIdentity(accessToken);
    case Platform.INSTAGRAM:
      return instagramIdentity(accessToken);
  }
}

async function xIdentity(token: string): Promise<PlatformIdentity> {
  const base = process.env.SOCIALOS_API_BASE_X ?? "https://api.x.com/2";
  const body = await getJson<{
    data: { id: string; username: string; name: string };
  }>(`${base}/users/me?user.fields=public_metrics,profile_image_url`, token);

  return {
    externalId: body.data.id,
    handle: `@${body.data.username}`,
    meta: { name: body.data.name, username: body.data.username },
  };
}

async function tiktokIdentity(token: string): Promise<PlatformIdentity> {
  const base =
    process.env.SOCIALOS_API_BASE_TIKTOK ?? "https://open.tiktokapis.com/v2";
  const body = await getJson<{
    data: {
      user: {
        open_id: string;
        display_name: string;
        username?: string;
        follower_count?: number;
      };
    };
  }>(
    `${base}/user/info/?fields=open_id,display_name,username,follower_count`,
    token
  );

  const user = body.data.user;
  return {
    externalId: user.open_id,
    handle: `@${user.username ?? user.display_name}`,
    meta: { displayName: user.display_name, followers: user.follower_count },
  };
}

async function youtubeIdentity(token: string): Promise<PlatformIdentity> {
  const base =
    process.env.SOCIALOS_API_BASE_YOUTUBE ?? "https://www.googleapis.com/youtube/v3";
  const body = await getJson<{
    items: {
      id: string;
      snippet: { title: string; customUrl?: string };
      contentDetails?: { relatedPlaylists?: { uploads?: string } };
    }[];
  }>(`${base}/channels?part=snippet,contentDetails&mine=true`, token);

  const channel = body.items?.[0];
  if (!channel) {
    throw new Error("That Google account has no YouTube channel.");
  }

  return {
    externalId: channel.id,
    handle: channel.snippet.customUrl ?? channel.snippet.title,
    meta: {
      title: channel.snippet.title,
      // Every upload lives in this playlist; the videos call needs it and
      // fetching it later would cost an extra round trip per sync.
      uploadsPlaylistId: channel.contentDetails?.relatedPlaylists?.uploads,
    },
  };
}

type MetaPage = {
  id: string;
  name: string;
  access_token: string;
  instagram_business_account?: { id: string };
};

async function metaPages(token: string): Promise<MetaPage[]> {
  const body = await getJson<{ data: MetaPage[] }>(
    `${graph()}/me/accounts?fields=id,name,access_token,instagram_business_account`,
    token
  );
  return body.data ?? [];
}

async function facebookIdentity(token: string): Promise<PlatformIdentity> {
  const pages = await metaPages(token);
  const page = pages[0];
  if (!page) {
    throw new Error(
      "No Facebook Page is available on that account. Insights are read per Page, not per profile."
    );
  }

  return {
    externalId: page.id,
    handle: page.name,
    meta: { pageId: page.id, pageName: page.name, pageCount: pages.length },
    // Page insights reject a user token outright.
    replacementToken: page.access_token,
  };
}

async function instagramIdentity(token: string): Promise<PlatformIdentity> {
  const pages = await metaPages(token);
  const linked = pages.find((page) => page.instagram_business_account);
  if (!linked?.instagram_business_account) {
    throw new Error(
      "No Instagram Business account is linked to a Facebook Page on that login. Link one in Meta Business Suite and reconnect."
    );
  }

  const igId = linked.instagram_business_account.id;
  const profile = await getJson<{ username: string; name?: string }>(
    `${graph()}/${igId}?fields=username,name`,
    linked.access_token
  );

  return {
    externalId: igId,
    handle: `@${profile.username}`,
    meta: { instagramId: igId, pageId: linked.id, name: profile.name },
    replacementToken: linked.access_token,
  };
}
