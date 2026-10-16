export const TIME_ZONE = 'Asia/Shanghai';

export function localDate(date: Date | string = new Date()): string {
  const d = new Date(date);
  // 上海没有夏令时；显式偏移避免服务端或浏览器本地时区影响业务日期。
  return new Date(d.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
export function addDays(date: string, count: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + count);
  return d.toISOString().slice(0, 10);
}
export function addMonths(date: string, count: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + count + 1);
  d.setUTCDate(0);
  d.setUTCDate(Math.min(day, d.getUTCDate()));
  return d.toISOString().slice(0, 10);
}
export interface DateRange { dueFrom: string; dueTo: string }
export function calendarRange(period: 'today' | 'week' | 'month', today = localDate()): DateRange {
  if (period === 'today') return { dueFrom: today, dueTo: today };
  if (period === 'week') {
    const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
    const dueFrom = addDays(today, -((weekday + 6) % 7));
    return { dueFrom, dueTo: addDays(dueFrom, 6) };
  }
  const dueFrom = `${today.slice(0, 7)}-01`;
  return { dueFrom, dueTo: addDays(addMonths(dueFrom, 1), -1) };
}
export function validDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}
export function monthBounds(month: string): { start: string; end: string } {
  const [year, m] = month.split('-').map(Number);
  return {
    start: new Date(Date.UTC(year, m - 1, 1) - 8 * 3600000).toISOString(),
    end: new Date(Date.UTC(year, m, 1) - 8 * 3600000).toISOString(),
  };
}
export function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(value));
}
