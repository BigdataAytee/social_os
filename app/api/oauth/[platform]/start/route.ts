import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

import { can } from "@/lib/auth/permissions";
import { getSessionResult } from "@/lib/auth/session";
import { createPkcePair, encodeState, randomNonce } from "@/lib/crypto";
import { parsePlatformSlug } from "@/lib/studios";
import {
  redirectUri,
  resolveProvider,
  providerCredentials,
} from "@/modules/integrations/oauth/providers";
import { connectAvailability } from "@/modules/integrations/oauth/service";

export const dynamic = "force-dynamic";

/**
 * Step 1 of the connect flow: send the person to the platform's consent screen.
 *
 * A GET that redirects, rather than a server action, because the browser has to
 * end up on the platform's own domain — and because the CSRF nonce and PKCE
 * verifier must be set as cookies on the same response that starts the flow.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { platform: string } }
) {
  const platform = parsePlatformSlug(params.platform);
  if (!platform) {
    return NextResponse.json({ error: "Unknown platform" }, { status: 404 });
  }

  const result = await getSessionResult();
  if (result.status !== "ok") {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  const session = result.session;

  // Connecting an account spends org-wide credentials and changes what every
  // member sees, so it is gated exactly like any other integration change.
  if (!can(session.role, "integration.manage")) {
    return NextResponse.redirect(
      new URL(
        `/studio/${params.platform}?connect=forbidden`,
        request.url
      )
    );
  }

  const availability = connectAvailability(platform);
  if (!availability.available) {
    return NextResponse.redirect(
      new URL(`/studio/${params.platform}?connect=unavailable`, request.url)
    );
  }

  const provider = resolveProvider(platform);
  const credentials = providerCredentials(platform)!;
  const nonce = randomNonce();

  const authorize = new URL(provider.authorizeUrl);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set(provider.clientIdParam, credentials.clientId);
  authorize.searchParams.set("redirect_uri", redirectUri(platform));
  authorize.searchParams.set("scope", provider.scopes.join(" "));
  authorize.searchParams.set(
    "state",
    encodeState({
      orgId: session.orgId,
      userId: session.userId,
      platform,
      nonce,
      returnTo: `/studio/${params.platform}`,
    })
  );
  for (const [key, value] of Object.entries(provider.extraAuthParams ?? {})) {
    authorize.searchParams.set(key, value);
  }

  const jar = cookies();
  const secure = process.env.NODE_ENV === "production";
  const cookieOptions = {
    httpOnly: true,
    secure,
    sameSite: "lax" as const,
    path: "/api/oauth",
    maxAge: 600,
  };

  // The nonce proves the callback belongs to a flow this browser started —
  // a signed state alone can be replayed by anyone who captures the URL.
  jar.set(`socialos_oauth_nonce_${platform}`, nonce, cookieOptions);

  if (provider.pkce) {
    const { verifier, challenge } = createPkcePair();
    jar.set(`socialos_oauth_verifier_${platform}`, verifier, cookieOptions);
    authorize.searchParams.set("code_challenge", challenge);
    authorize.searchParams.set("code_challenge_method", "S256");
  }

  return NextResponse.redirect(authorize);
}
