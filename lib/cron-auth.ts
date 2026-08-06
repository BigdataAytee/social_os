import type { NextRequest } from "next/server";

/**
 * Shared guard for every cron endpoint.
 *
 * Without it these are unauthenticated ways to make the whole system do work —
 * publish queues, platform syncs, model calls. Vercel signs its cron
 * invocations with this header.
 *
 * When `CRON_SECRET` is unset the endpoints stay open, deliberately: a local
 * `npm run dev` has no secret and being unable to test the queue would be
 * worse. Production sets it, and `/setup` will say so if it doesn't.
 */
export function cronAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return true;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}
