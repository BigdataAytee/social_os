/**
 * Timezone-aware bucketing, in one place.
 *
 * Two modules recommend posting times to the same person — `modules/analytics`
 * powers the Studio panel, `modules/strategy` powers the Growth Strategist — and
 * both used to bucket by **UTC** hour and then render the number bare. For any
 * account not sitting on Greenwich that advice was wrong by the offset, and
 * silently so, because nothing on screen said which zone the hour was in.
 *
 * Shared rather than copied: two implementations that drift apart would have
 * the two surfaces recommending times five hours apart, which is worse than
 * either being wrong on its own.
 */

const DAY_INDEX = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Weekday (0 = Sunday) and hour of an instant, in a given IANA zone.
 *
 * `Intl` rather than offset arithmetic or a date library: it carries the IANA
 * database, so it gets DST right — including the transitions where a fixed
 * offset puts a post in the wrong hour for half the year, which is precisely
 * when posting-time advice would quietly drift.
 *
 * An unrecognised zone falls back to UTC rather than throwing. This runs inside
 * a nightly recompute over every org; one bad stored value must not take the
 * whole job down, and UTC is the behaviour that predates the field.
 */
export function localParts(
  at: Date,
  timeZone: string
): { day: number; hour: number } {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      hour: "numeric",
      hour12: false,
    }).formatToParts(at);
  } catch {
    return { day: at.getUTCDay(), hour: at.getUTCHours() };
  }

  const weekday = parts.find((part) => part.type === "weekday")?.value ?? "Sun";
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");

  return {
    day: Math.max(0, DAY_INDEX.indexOf(weekday)),
    // Some ICU versions render midnight as 24 under hour12:false.
    hour: hour === 24 ? 0 : hour,
  };
}

/** True when this runtime can resolve the zone. Used to validate user input. */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * "14:00 WAT" — the label that would have made the UTC bug visible.
 *
 * Falls back to the raw zone name where the runtime has no short name for it.
 */
export function zoneAbbreviation(timeZone: string, at = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "short",
    }).formatToParts(at);
    return (
      parts.find((part) => part.type === "timeZoneName")?.value ?? timeZone
    );
  } catch {
    return timeZone;
  }
}
