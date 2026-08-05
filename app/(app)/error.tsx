"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RotateCw } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * The authenticated shell's error boundary.
 *
 * Next.js replaces a server error with "a server-side exception has occurred"
 * and an opaque digest, which is correct — the real message can contain
 * connection strings and row contents. But with nothing else on screen, the
 * digest is all anyone has, and matching it to a log line requires access to
 * the logs.
 *
 * So: name the failures we can recognise from the digest-free information we do
 * have, and always show the digest, since it is the one string that ties this
 * screen to the server log entry.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Reaches the browser console in development and the client error reporter
    // in production; the server already logged the real stack.
    console.error("[socialos] unhandled error", error);
  }, [error]);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-6 py-16 animate-fade-in">
      <div className="flex flex-col gap-3">
        <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-danger">
          <AlertTriangle className="h-3.5 w-3.5" />
          Something failed on the server
        </span>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-primary">
          This page didn&rsquo;t render
        </h1>
        <p className="text-balance text-secondary">
          The error itself is only in the server log — it can contain connection
          strings and row contents, so it isn&rsquo;t shown here. The digest
          below is what ties this screen to that log entry.
        </p>
      </div>

      {error.digest && (
        <p className="rounded-md border border-border bg-surface-raised px-3 py-2 font-mono text-[11px] text-secondary">
          Digest {error.digest}
        </p>
      )}

      <div className="flex flex-col gap-2 rounded-md border border-border bg-surface px-4 py-3">
        <p className="font-mono text-[10px] uppercase tracking-wider text-muted">
          Most likely
        </p>
        <ul className="flex list-disc flex-col gap-1.5 pl-4 text-xs text-muted">
          <li>
            <span className="text-secondary">
              The database is behind this deployment.
            </span>{" "}
            If this build adds a migration that hasn&rsquo;t been applied, every
            page touching the changed table fails exactly like this.{" "}
            <Link href="/setup" className="text-accent hover:underline">
              /setup
            </Link>{" "}
            names the pending migrations.
            {/* Preview deployments are the usual way to get here: they share
                production's environment variables, so prepare-database.ts
                refuses to migrate from one. */}
          </li>
          <li>
            <span className="text-secondary">
              This is a preview deployment.
            </span>{" "}
            Preview builds never apply migrations — they share production&rsquo;s
            environment variables, so migrating from one would alter the
            production database. A preview of a branch that adds a migration runs
            new code against the old schema.
          </li>
          <li>
            <span className="text-secondary">
              The database went away mid-request.
            </span>{" "}
            A paused project or an exhausted connection pool. Retrying is the
            fastest way to tell.
          </li>
        </ul>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={reset}>
          <RotateCw />
          Try again
        </Button>
        <Button asChild size="sm" variant="secondary">
          <Link href="/setup">Check configuration</Link>
        </Button>
        <Button asChild size="sm" variant="ghost">
          <Link href="/dashboard">Back to dashboard</Link>
        </Button>
      </div>
    </div>
  );
}
