import { Check, Minus } from "lucide-react";

import { Section } from "@/components/ui/section";

/**
 * What this deployment can actually do, and what it's missing.
 *
 * `/setup` checks only the four variables the app needs to boot, so a fully
 * booted deployment with no encryption key looked completely healthy while
 * every real connection was silently switched off. The symptom reached me as
 * "the selection is not working" — which was true, and unfindable.
 *
 * Server component: it reads `process.env` and must never ship those values to
 * the browser. Only the *presence* of each name crosses the boundary, and the
 * values are never read here at all — `configured` is computed by the caller
 * from the same availability helpers the registry uses, so this panel and the
 * connection cards can't disagree.
 */

export type Capability = {
  name: string;
  configured: boolean;
  /** What stops working without it, in the user's terms. */
  effect: string;
  /** The environment variable(s) behind it. */
  vars: string[];
  /**
   * Set when the variable is *present but rejected* — wrong length, stray
   * quotes, truncated paste. This is the state that used to be invisible: the
   * app reported "not set" to someone looking straight at the value in their
   * dashboard, which reads as the app being broken rather than the value being
   * wrong.
   */
  problem?: string | null;
};

export function CapabilityPanel({ capabilities }: { capabilities: Capability[] }) {
  const missing = capabilities.filter((capability) => !capability.configured);
  const rejected = missing.filter((capability) => capability.problem);

  return (
    <Section
      title="Capabilities"
      description="What this deployment can do right now, and what each missing key would switch on"
    >
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-5">
        {missing.length === 0 ? (
          <p className="text-sm text-primary">
            Everything is configured. Real connections, AI generation and
            scheduled background work are all live.
          </p>
        ) : rejected.length > 0 ? (
          <p className="text-sm text-primary">
            {rejected.length === 1 ? "One variable is" : `${rejected.length} variables are`}{" "}
            set but not accepted — see the red note below. The value is present;
            it just isn&rsquo;t valid, so fixing it is an edit rather than an
            addition.
          </p>
        ) : (
          <p className="text-sm text-muted">
            {missing.length} of {capabilities.length} switched off. The app works
            without them — it falls back to seeded data and a local writer — but
            these are the keys that make it real. Add them under Vercel →
            Settings → Environment Variables, then redeploy.
          </p>
        )}

        <ul className="flex flex-col gap-2">
          {capabilities.map((capability) => (
            <li
              key={capability.name}
              className="flex items-start gap-3 border-t border-border pt-2 first:border-t-0 first:pt-0"
            >
              {capability.configured ? (
                <Check
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success"
                  aria-label="configured"
                />
              ) : (
                <Minus
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted"
                  aria-label="not configured"
                />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm text-primary">{capability.name}</p>
                <p className="text-xs text-muted">{capability.effect}</p>
                {!capability.configured &&
                  (capability.problem ? (
                    <p className="mt-0.5 text-[11px] leading-snug text-danger">
                      Set, but rejected: {capability.problem}
                    </p>
                  ) : (
                    <p className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-warning">
                      needs {capability.vars.join(" + ")}
                    </p>
                  ))}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </Section>
  );
}
