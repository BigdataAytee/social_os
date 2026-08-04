import Link from "next/link";

import { Logo } from "@/components/shell/logo";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-canvas px-6 text-center">
      <Logo />
      <div className="flex flex-col gap-2">
        <p className="font-mono text-xs uppercase tracking-wider text-muted">404</p>
        <h1 className="font-display text-xl font-semibold text-primary">
          Nothing lives here
        </h1>
        <p className="max-w-sm text-balance text-sm text-secondary">
          The page you asked for isn&rsquo;t part of SocialOS.
        </p>
      </div>
      <Button asChild variant="secondary">
        <Link href="/dashboard">Back to Dashboard</Link>
      </Button>
    </div>
  );
}
