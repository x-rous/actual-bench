/**
 * Time-zone choices for a schedule (RD-080 / PR-045).
 *
 * The presentation follows the convention people already recognise from every
 * other time-zone picker — `(UTC+04:00) Dubai`, ordered west to east — because
 * an IANA identifier alone ("Asia/Dubai") is a developer's answer to "when
 * should this run".
 *
 * Offsets are labelled **UTC**, matching the tz database's own tables. `Intl`
 * reports them as "GMT+04:00"; the two are the same number, and UTC is the term
 * the underlying zone data uses.
 *
 * The offsets are computed from `Intl` at call time rather than tabulated. A
 * fixed table is wrong for half the year in every zone that observes daylight
 * saving: "(GMT-08:00) Pacific Time" reads as a fact and is false in July.
 */

export type TimezoneOption = {
  /** IANA identifier — what actually gets stored and scheduled. */
  value: string;
  /** e.g. "(UTC+04:00) Dubai" */
  label: string;
  offsetMinutes: number;
};

const FALLBACK_ZONES = [
  "UTC",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Moscow",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Sao_Paulo",
];

export function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** Current offset in minutes, DST included, or null if the zone is unusable. */
export function zoneOffsetMinutes(zone: string, at: Date = new Date()): number | null {
  try {
    const formatted = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      timeZoneName: "longOffset",
    }).format(at);

    const match = /GMT([+-])(\d{2}):(\d{2})/.exec(formatted);
    // A zone sitting exactly on zero is rendered as plain "GMT" by Intl.
    if (!match) return /GMT/.test(formatted) ? 0 : null;

    const sign = match[1] === "-" ? -1 : 1;
    return sign * (Number(match[2]) * 60 + Number(match[3]));
  } catch {
    return null;
  }
}

export function formatOffset(minutes: number): string {
  if (minutes === 0) return "UTC+00:00";
  const sign = minutes < 0 ? "-" : "+";
  const absolute = Math.abs(minutes);
  const hours = String(Math.floor(absolute / 60)).padStart(2, "0");
  const rest = String(absolute % 60).padStart(2, "0");
  return `UTC${sign}${hours}:${rest}`;
}

/** "America/Argentina/Buenos_Aires" → "Buenos Aires" */
export function zoneCity(zone: string): string {
  const segments = zone.split("/");
  return (segments[segments.length - 1] ?? zone).replace(/_/g, " ");
}

function availableZones(): string[] {
  const supported = (Intl as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
  if (typeof supported !== "function") return FALLBACK_ZONES;
  try {
    const zones = supported("timeZone");
    return zones.length > 0 ? zones : FALLBACK_ZONES;
  } catch {
    return FALLBACK_ZONES;
  }
}

/**
 * Every selectable zone, ordered west to east, with the user's own zone and UTC
 * pinned first — the two answers most people want, without scrolling a list of
 * four hundred.
 */
export function timezoneOptions(at: Date = new Date()): TimezoneOption[] {
  const own = browserTimezone();

  const zones = new Set<string>(availableZones());
  // Neither is guaranteed to be in the platform list, and both must be offered.
  zones.add("UTC");
  zones.add(own);

  const options: TimezoneOption[] = [];
  for (const zone of zones) {
    const offsetMinutes = zoneOffsetMinutes(zone, at);
    if (offsetMinutes === null) continue;
    options.push({
      value: zone,
      label: `(${formatOffset(offsetMinutes)}) ${zoneCity(zone)}`,
      offsetMinutes,
    });
  }

  options.sort(
    (a, b) => a.offsetMinutes - b.offsetMinutes || a.label.localeCompare(b.label)
  );

  const pinned = options.filter((option) => option.value === own || option.value === "UTC");
  const rest = options.filter((option) => option.value !== own && option.value !== "UTC");
  // The user's own zone leads, because it is the right answer far more often
  // than any other single entry.
  pinned.sort((a, b) => (a.value === own ? -1 : b.value === own ? 1 : 0));

  return [...pinned, ...rest];
}
