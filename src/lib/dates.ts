// Deterministic date labels for the agency workspace.
//
// `toLocaleDateString("en-IN")` gives different text on Node and in Chromium (different ICU data),
// and it also follows the machine's timezone. Rendering that text in a client component produces a
// React hydration error. Every label here is built from integer parts and fixed name tables, and is
// always shown in Indian Standard Time (UTC+05:30), so the server and the browser print the same text
// whatever their timezone or ICU data.

const IST_OFFSET_MS = 330 * 60 * 1000;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

type DateInput = Date | string | number | null | undefined;

const pad2 = (n: number) => String(n).padStart(2, "0");

function validTime(value: DateInput): number | null {
  if (value == null || value === "") return null;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
}

function istParts(time: number) {
  const d = new Date(time + IST_OFFSET_MS);
  return {
    year: d.getUTCFullYear(), month: d.getUTCMonth(), day: d.getUTCDate(),
    weekday: d.getUTCDay(), hours: d.getUTCHours(), minutes: d.getUTCMinutes(),
  };
}

/** e.g. "Fri, 09 Oct 2026" — the "today" chip, in the same format as every other date. */
export function dayChipLabel(value: Date | string | number) {
  const p = istParts(new Date(value).getTime());
  return `${WEEKDAYS[p.weekday].slice(0, 3)}, ${pad2(p.day)} ${MONTHS[p.month].slice(0, 3)} ${p.year}`;
}

/** e.g. "5:30 pm" — a short 12-hour clock. */
export function clockLabel(value: Date | string | number) {
  const p = istParts(new Date(value).getTime());
  const hours12 = p.hours % 12 || 12;
  return `${hours12}:${pad2(p.minutes)} ${p.hours < 12 ? "am" : "pm"}`;
}

/** e.g. "09 Oct 2026". Returns "—" for a missing or invalid date. */
export function dateLabel(value: DateInput) {
  const time = validTime(value);
  if (time === null) return "—";
  const p = istParts(time);
  return `${pad2(p.day)} ${MONTHS[p.month].slice(0, 3)} ${p.year}`;
}

/** e.g. "09 Oct 2026, 5:30 pm". Returns "—" for a missing or invalid date. */
export function dateTimeLabel(value: DateInput) {
  const time = validTime(value);
  if (time === null) return "—";
  return `${dateLabel(time)}, ${clockLabel(time)}`;
}
