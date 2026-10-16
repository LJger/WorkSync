import { addDays, addMonths } from '../shared/dates';

export const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];
export const monthStart = (date: string) => `${date.slice(0, 7)}-01`;
export const dateLabel = (date: string) => `${date.slice(0, 4)}年${Number(date.slice(5, 7))}月${Number(date.slice(8))}日`;

// Six Monday-first weeks for the month containing `month`; days outside it are null.
export function monthWeeks(month: string): (string | null)[][] {
  const first = monthStart(month);
  const offset = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7;
  const length = Number(addDays(addMonths(first, 1), -1).slice(8));
  return Array.from({ length: 6 }, (_, week) => Array.from({ length: 7 }, (_, weekday) => {
    const day = week * 7 + weekday - offset + 1;
    return day < 1 || day > length ? null : `${first.slice(0, 8)}${String(day).padStart(2, '0')}`;
  }));
}

// Grid keyboard navigation shared by the calendars (APG date picker pattern).
export function keyTarget(key: string, date: string, shiftKey: boolean): string | null {
  const weekday = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
  switch (key) {
    case 'ArrowLeft': return addDays(date, -1);
    case 'ArrowRight': return addDays(date, 1);
    case 'ArrowUp': return addDays(date, -7);
    case 'ArrowDown': return addDays(date, 7);
    case 'Home': return addDays(date, -weekday);
    case 'End': return addDays(date, 6 - weekday);
    case 'PageUp': return addMonths(date, shiftKey ? -12 : -1);
    case 'PageDown': return addMonths(date, shiftKey ? 12 : 1);
    default: return null;
  }
}
