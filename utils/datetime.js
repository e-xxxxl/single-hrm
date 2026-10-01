/**
 * Timezone-aware date helpers. The platform operates in Nigeria (Africa/Lagos,
 * UTC+1, no DST) but every function takes an explicit `timeZone` so this still
 * holds if an organization is configured differently.
 */

/** Break a Date into calendar parts for a given timezone. */
export function zonedParts(date, timeZone = "Africa/Lagos") {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    weekday: "short",
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour === "24" ? "0" : parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: parts.weekday, // "Mon" … "Sun"
  };
}

/** "YYYY-MM-DD" for the given instant in the given timezone. */
export function dayKey(date, timeZone = "Africa/Lagos") {
  const p = zonedParts(date, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** Minutes past local midnight for the given instant. */
export function minutesOfDay(date, timeZone = "Africa/Lagos") {
  const p = zonedParts(date, timeZone);
  return p.hour * 60 + p.minute;
}

/** Parse "HH:mm" to minutes past midnight. */
export function hhmmToMinutes(hhmm) {
  const [h, m] = String(hhmm || "0:0").split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** 0 (Sun) … 6 (Sat) for the given instant in the given timezone. */
export function zonedWeekday(date, timeZone = "Africa/Lagos") {
  const map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[zonedParts(date, timeZone).weekday];
}

/**
 * A UTC Date pinned to local midnight of `dayKey` for the given timezone —
 * used as the stable per-day key stored on attendance documents.
 */
export function dayKeyToDate(key, timeZone = "Africa/Lagos") {
  // Find the offset at noon that day to avoid DST edges (irrelevant for Lagos).
  const [y, m, d] = key.split("-").map(Number);
  const noonUtc = Date.UTC(y, m - 1, d, 12, 0, 0);
  const p = zonedParts(new Date(noonUtc), timeZone);
  const localNoonAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const offsetMs = localNoonAsUtc - noonUtc;
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0) - offsetMs);
}

/** List of "YYYY-MM-DD" keys for a calendar month "YYYY-MM". */
export function monthDayKeys(month) {
  const [y, m] = month.split("-").map(Number);
  const days = new Date(y, m, 0).getDate();
  return Array.from({ length: days }, (_, i) => `${y}-${String(m).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`);
}

/** Inclusive list of "YYYY-MM-DD" keys between two dates. */
export function eachDayKey(start, end, timeZone = "Africa/Lagos") {
  const keys = [];
  const startKey = dayKey(start, timeZone);
  const endKey = dayKey(end, timeZone);
  let cursor = dayKeyToDate(startKey, timeZone);
  const guard = 1000;
  let i = 0;
  while (dayKey(cursor, timeZone) <= endKey && i < guard) {
    keys.push(dayKey(cursor, timeZone));
    cursor = new Date(cursor.getTime() + 24 * 3600 * 1000);
    i += 1;
  }
  return keys;
}

/**
 * Count chargeable working days in an inclusive date range.
 * `workweek` is an array of weekday numbers (0=Sun … 6=Sat) that are working.
 * `includeWeekends` overrides the workweek and counts every calendar day.
 * `halfDayStart` / `halfDayEnd` subtract 0.5 each (only when that day counts).
 */
export function countLeaveDays(
  start,
  end,
  { workweek = [1, 2, 3, 4, 5], includeWeekends = false, halfDayStart = false, halfDayEnd = false, timeZone = "Africa/Lagos" } = {},
) {
  const keys = eachDayKey(start, end, timeZone);
  if (keys.length === 0) return 0;

  const isWorking = (key) =>
    includeWeekends || workweek.includes(zonedWeekday(dayKeyToDate(key, timeZone), timeZone));

  let total = 0;
  for (const key of keys) if (isWorking(key)) total += 1;

  if (halfDayStart && isWorking(keys[0])) total -= 0.5;
  if (halfDayEnd && keys.length > 1 && isWorking(keys[keys.length - 1])) total -= 0.5;
  // Single-day half-day request.
  if (halfDayStart && halfDayEnd && keys.length === 1 && isWorking(keys[0])) total += 0.5;

  return Math.max(0, total);
}

export default {
  zonedParts,
  dayKey,
  minutesOfDay,
  hhmmToMinutes,
  zonedWeekday,
  dayKeyToDate,
  monthDayKeys,
  eachDayKey,
  countLeaveDays,
};
