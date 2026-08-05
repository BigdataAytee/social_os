import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

import { can } from "@/lib/auth/permissions";
import { getSessionResult } from "@/lib/auth/session";
import { decodeState, nonceMatches } from "@/lib/crypto";
import { parsePlatformSlug } from "@/lib/studios";
import { logActivity } from "@/modules/activity/service";
import { fetchIdentity } from "@/modules/integrations/oauth/identity";
import {
  exchangeCode,
  linkAccount,
} from "@/modules/integrations/oauth/service";
import { syncAccount } from "@/modules/integrations/sync";

export const dynamic = "force-dynamic";

/**
 * Step 2: the platform sends the browser back here with a code.
 *
 * Everything that can go wrong here goes wrong on somebody else's server, so
 * each failure redirects to the Studio with a `connect=` reason rather than
 * rendering an error page — the person needs to land somewhere they can retry,
 * and the Studio already knows how to explain the state.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { platform: string } }
) {
  const platform = parsePlatformSlug(params.platform);
  const back = (reason: string, slug = params.platform) =>
    NextResponse.redirect(
      new URL(`/studio/${slug}?connect=${reason}`, request.url)
    );

  if (!platform) {
    return NextResponse.json({ error: "Unknown platform" }, { status: 404 });
  }

  const url = new URL(request.url);
  // The person pressed Cancel on the consent screen. Not an error.
  if (url.searchParams.get("error")) return back("cancelled");

  const code = url.searchParams.get("code");
  const rawState = url.searchParams.get("state");
  if (!code || !rawState) return back("invalid");

  const state = decodeState(rawState);
  if (!state || state.platform !== platform) return back("invalid");

  const jar = cookies();
  const nonceCookie = jar.get(`socialos_oauth_nonce_${platform}`)?.value;
  const verifier = jar.get(`socialos_oauth_verifier_${platform}`)?.value;

  // Signed state says *we* issued it; the cookie says *this browser* did.
  if (!nonceCookie || !nonceMatches(nonceCookie, state.nonce)) {
    return back("invalid");
  }

  const result = await getSessionResult();
  if (result.status !== "ok") {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  const session = result.session;

  // The signed state carries the org the flow began in. If the person switched
  // accounts mid-flow, binding the token to the *current* session would attach
  // it to the wrong organisation.
  if (session.orgId !== state.orgId) return back("invalid");
  if (!can(session.role, "integration.manage")) return back("forbidden");

  const clear = (response: NextResponse) => {
    response.cookies.delete(`socialos_oauth_nonce_${platform}`);
    response.cookies.delete(`socialos_oauth_verifier_${platform}`);
    return response;
  };

  try {
    const exchanged = await exchangeCode({
      platform,
      code,
      codeVerifier: verifier,
    });

    // Ask the platform who this is before writing anything — the handle is part
    // of the account's unique key, so guessing it would fork the history.
    const identity = await fetchIdentity(platform, exchanged.tokens.accessToken);

    const account = await linkAccount({
      orgId: session.orgId,
      platform,
      handle: identity.handle,
      externalId: identity.externalId,
      tokens: {
        // Meta hands back a Page token that the user token can't substitute for.
        accessToken: identity.replacementToken ?? exchanged.tokens.accessToken,
        refreshToken: exchanged.tokens.refreshToken,
      },
      expiresAt: exchanged.expiresAt,
      scopes: exchanged.scopes,
      meta: identity.meta,
    });

    await logActivity(session, "integration.connected", "account", account.id, {
      platform,
      handle: identity.handle,
    });

    // Pull straight away. A freshly connected account with no data looks broken,
    // and this is the one moment the person is definitely watching.
    try {
      await syncAccount(session, account.id);
    } catch {
      // The connection is real even if the first pull failed; syncAccount has
      // already recorded why on the account row.
      return clear(back("connected-sync-failed", params.platform));
    }

    return clear(back("connected", params.platform));
  } catch (error) {
    console.error(`[oauth] ${platform} callback failed`, error);
    return clear(back("failed", params.platform));
  }
}
