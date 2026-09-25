const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const pad = (value: number) => String(value).padStart(2, "0");

// A registry timestamp in UTC, after block explorers' style:
// `2026-09-04T12:30:23.000Z` → `Sep-04-2026 12:30:23 PM +UTC`. Formatted by
// hand rather than with `Intl`, whose output varies across runtimes, since the
// server renders it.
export function formatUtcTimestamp(iso: string): string {
  const date = new Date(iso);
  const hours = date.getUTCHours();
  const hours12 = hours % 12 || 12;
  const meridiem = hours < 12 ? "AM" : "PM";
  return (
    `${MONTHS[date.getUTCMonth()]}-${pad(date.getUTCDate())}-${date.getUTCFullYear()} ` +
    `${pad(hours12)}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} ${meridiem} +UTC`
  );
}
