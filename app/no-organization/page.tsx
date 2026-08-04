import type { Metadata } from "next";

import { Logo } from "@/components/shell/logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getSessionResult } from "@/lib/auth/session";

export const metadata: Metadata = { title: "No organization · SocialOS" };

/**
 * Authenticated, but no Membership. Phase 8 replaces this with the real
 * onboarding flow; until then it's a dead end with an explanation rather than a
 * redirect loop.
 */
export default async function NoOrganizationPage() {
  const result = await getSessionResult();
  const email = result.status === "no-org" ? result.email : null;

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-6 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>
        <Card>
          <CardContent className="flex flex-col gap-5 p-6 pt-6">
            <div className="flex flex-col gap-2">
              <h1 className="font-display text-lg font-semibold text-primary">
                You&rsquo;re signed in, but not in a workspace
              </h1>
              <p className="text-sm text-secondary">
                {email ? (
                  <>
                    <span className="font-mono text-xs text-primary">{email}</span>{" "}
                    isn&rsquo;t a member of any organization yet.
                  </>
                ) : (
                  <>This account isn&rsquo;t a member of any organization yet.</>
                )}
              </p>
            </div>

            <div className="rounded-md border border-border bg-surface-raised p-4">
              <p className="mb-2 text-xs uppercase tracking-wide text-muted">
                Working locally?
              </p>
              <p className="text-sm text-secondary">
                Run the seed with{" "}
                <code className="font-mono text-xs text-primary">
                  SUPABASE_SERVICE_ROLE_KEY
                </code>{" "}
                set and sign in as one of the demo users, or add a{" "}
                <code className="font-mono text-xs text-primary">Membership</code>{" "}
                row pointing this user at the demo org.
              </p>
            </div>

            <p className="text-xs text-muted">
              Self-serve onboarding lands in Phase 8 — see PROGRESS.md.
            </p>

            <form action="/auth/sign-out" method="post">
              <Button type="submit" variant="secondary" className="w-full">
                Sign out
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
