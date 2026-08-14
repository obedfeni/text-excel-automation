/**
 * Time/date helpers shared between the WhatsApp-text parser (lib/parser.ts)
 * and the Excel generator (lib/excel.ts), so both sides agree on formats.
 */

/** Parses a free-text time mention ("5:00pm", "5pm", "17:40", "7.40 am") into "HH:MM" 24h, or "" if not found. */
export function parseTime(text: string): string {
  // Require either an am/pm marker or an explicit "HH:MM"/"HH.MM" pattern -
  // a bare number like "5" on its own is too ambiguous to treat as a time.
  const m = text.match(/\b(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a\.m\.?|p\.m\.?)\b/i) ||
    text.match(/\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/);
  if (!m) return '';

  let hour = Number(m[1]);
  const minute = m[2] ? m[2].padStart(2, '0') : '00';
  const meridiem = m[3]?.toLowerCase().replace(/\./g, '');

  if (meridiem) {
    const isPm = meridiem.startsWith('p');
    if (isPm && hour < 12) hour += 12;
    if (!isPm && hour === 12) hour = 0;
  }
  if (hour > 23 || Number(minute) > 59) return '';
  return `${String(hour).padStart(2, '0')}:${minute}`;
}

/** Formats a "HH:MM" duration in minutes as "45min" or "1h 45min". Returns "" if either time is missing/invalid. */
export function computeDuration(downTime: string, upTime: string): string {
  const down = toMinutes(downTime);
  const up = toMinutes(upTime);
  if (down === null || up === null) return '';
  let diff = up - down;
  if (diff < 0) diff += 24 * 60; // shift crossed midnight
  if (diff === 0) return '0min';
  const hours = Math.floor(diff / 60);
  const minutes = diff % 60;
  if (hours === 0) return `${minutes}min`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}min`;
}

function toMinutes(hhmm: string): number | null {
  const m = hhmm.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * Parses a "N/N/YYYY" date mention into an ISO "YYYY-MM-DD" string.
 * The two-number order is ambiguous (MM/DD vs DD/MM) in free text, so this
 * defaults to MM/DD/YYYY (matching the source spreadsheet's own "M/d/yyyy"
 * column format) and only swaps the order when the first number can't
 * possibly be a month (i.e. is greater than 12).
 */
export function parseReportDate(text: string): string {
  const m = text.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (!m) return '';
  let [, a, b, year] = m;
  let month = Number(a);
  let day = Number(b);
  if (month > 12 && day <= 12) {
    // first number can't be a month -> it must be the day (DD/MM/YYYY)
    [month, day] = [day, month];
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) return '';
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Formats an ISO "YYYY-MM-DD" date for display, e.g. "Aug 10, 2026". Returns the raw string if unparseable. */
export function formatDateForDisplay(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
