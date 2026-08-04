/**
 * Server actions return a discriminated result rather than throwing across the
 * network boundary — a thrown error in a server action reaches the client as an
 * opaque digest, which is useless for showing the person what went wrong.
 *
 * Service-layer errors (permission denials, validation failures) are expected
 * outcomes here, not crashes.
 */

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export async function toActionResult<T>(
  fn: () => Promise<T>
): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    if (error instanceof Error) {
      // Zod issues arrive as a JSON blob; surface the first message instead.
      try {
        const parsed = JSON.parse(error.message);
        if (Array.isArray(parsed) && parsed[0]?.message) {
          return { ok: false, error: String(parsed[0].message) };
        }
      } catch {
        // Not a Zod error — fall through to the plain message.
      }
      return { ok: false, error: error.message };
    }
    return { ok: false, error: "Something went wrong" };
  }
}
