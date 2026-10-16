import { describe, expect, it } from 'vitest';
import { addMonths, calendarRange, localDate } from '../shared/dates.js';

describe('快捷日期范围', () => {
  it('今天使用上海业务日期，范围包含当天', () => {
    expect(calendarRange('today', localDate('2026-10-14T16:00:00Z'))).toEqual({ dueFrom: '2026-10-15', dueTo: '2026-10-15' });
    expect(calendarRange('today', localDate('2026-10-14T15:59:59Z'))).toEqual({ dueFrom: '2026-10-14', dueTo: '2026-10-14' });
  });

  it.each([
    ['2026-10-12', '2026-10-12', '2026-10-18'],
    ['2026-10-18', '2026-10-12', '2026-10-18'],
    ['2026-11-01', '2026-10-26', '2026-11-01'],
    ['2027-01-01', '2026-12-28', '2027-01-03'],
  ])('本周以周一开始，并处理周日、跨月及跨年：%s', (today, dueFrom, dueTo) => {
    expect(calendarRange('week', today)).toEqual({ dueFrom, dueTo });
  });

  it.each([
    ['2026-10-15', '2026-10-01', '2026-10-31'],
    ['2026-12-31', '2026-12-01', '2026-12-31'],
    ['2026-02-28', '2026-02-01', '2026-02-28'],
    ['2028-02-15', '2028-02-01', '2028-02-29'],
  ])('本月覆盖整个自然月：%s', (today, dueFrom, dueTo) => {
    expect(calendarRange('month', today)).toEqual({ dueFrom, dueTo });
  });
});

it('日历翻月跨年，并将月末日期限制在目标月份内', () => {
  expect(addMonths('2026-12-31', 1)).toBe('2027-01-31');
  expect(addMonths('2026-03-31', -1)).toBe('2026-02-28');
  expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
  expect(addMonths('2028-02-29', -12)).toBe('2027-02-28');
});
