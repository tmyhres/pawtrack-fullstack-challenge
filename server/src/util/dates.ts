// Canonical "service date" resolution.
//
// A booking carries `scheduledDate` (an ISO instant) plus wall-clock
// `startTime`/`endTime`. The day a booking belongs to is the tenant-LOCAL
// calendar date of that instant — never the raw UTC date-part, and never the
// instant projected through whatever timezone the server happens to run in.
// Both the list date-filter and the sitter overlap check must agree on this,
// or a booking can be filtered under one day while overlap-checked under
// another (the original double-booking / wrong-filter incidents).

// `Intl.DateTimeFormat` throws a RangeError on an invalid IANA zone, so we fall
// back to UTC rather than 500ing a request on corrupted tenant data. Formatters
// are cached so a date filter doesn't reconstruct one per booking row.
const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(tz: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(tz);
  if (cached) return cached;

  const opts: Intl.DateTimeFormatOptions = { year: 'numeric', month: '2-digit', day: '2-digit' };
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = new Intl.DateTimeFormat('en-US', { ...opts, timeZone: tz });
  } catch {
    fmt = new Intl.DateTimeFormat('en-US', { ...opts, timeZone: 'UTC' });
  }
  formatterCache.set(tz, fmt);
  return fmt;
}

// Return YYYY-MM-DD for `scheduledDate` as observed in IANA timezone `tz`.
// Uses formatToParts (not .format()) so the layout doesn't depend on a locale's
// default date order — explicit assembly is robust across ICU versions.
export function tenantLocalDate(scheduledDate: string, tz: string): string | null {
  const instant = new Date(scheduledDate);
  if (Number.isNaN(instant.getTime())) return null;

  const parts = formatterFor(tz).formatToParts(instant);
  const get = (type: 'year' | 'month' | 'day') =>
    parts.find(p => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}
