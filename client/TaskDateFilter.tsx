import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { addDays, addMonths, calendarRange, localDate, type DateRange } from '../shared/dates';
import { WEEKDAYS, dateLabel, keyTarget, monthStart, monthWeeks } from './calendar';
import { usePopoverDismiss, usePopoverPosition } from './popover';

const presetLabels = {
  today: '今天', week: '本周', month: '本月', upcoming: '未来 7 天', overdue: '已逾期', none: '无截止日期',
} as const;
type Preset = keyof typeof presetLabels;
export type DateFilterValue = { kind: 'all' } | { kind: 'preset'; preset: Preset } | ({ kind: 'range' } & DateRange);
export type DateFilterQuery = Partial<DateRange> & { due?: 'today' | 'upcoming' | 'overdue' | 'none' };

export function dateFilterQuery(value: DateFilterValue, today = localDate()): DateFilterQuery {
  if (value.kind === 'all') return {};
  if (value.kind === 'range') return { dueFrom: value.dueFrom, dueTo: value.dueTo };
  if (value.preset === 'week' || value.preset === 'month') return calendarRange(value.preset, today);
  return { due: value.preset };
}

function selectedRange(value: DateFilterValue, today: string): DateRange | null {
  if (value.kind === 'range') return value;
  if (value.kind !== 'preset') return null;
  if (value.preset === 'today' || value.preset === 'week' || value.preset === 'month') return calendarRange(value.preset, today);
  if (value.preset === 'upcoming') return { dueFrom: addDays(today, 1), dueTo: addDays(today, 7) };
  return null;
}
const rangeLabel =({ dueFrom, dueTo }: DateRange) => dueFrom === dueTo ? dueFrom.replaceAll('-', '/') : `${dueFrom.replaceAll('-', '/')} – ${dueTo.replaceAll('-', '/')}`;

export function TaskDateFilter({ value, onChange }: { value: DateFilterValue; onChange: (value: DateFilterValue) => void }) {
  const today = localDate();
  const selected = selectedRange(value, today);
  const label = value.kind === 'all' ? '全部日期' : value.kind === 'preset' ? presetLabels[value.preset] : rangeLabel(value);
  const [open, setOpen] = useState(false);
  const [compact, setCompact] = useState(() => window.matchMedia('(max-width: 600px)').matches);
  const [firstMonth, setFirstMonth] = useState(monthStart(today));
  const [focusedDate, setFocusedDate] = useState(today);
  const [start, setStart] = useState<string | null>(null);
  const [hoveredDate, setHoveredDate] = useState<string | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const focusRequest = useRef<string | null>(null);
  const id = useId();
  const position = usePopoverPosition(open, trigger, panel);
  const monthCount = compact ? 1 : 2;
  const previewEnd = hoveredDate || start;
  const range = start && previewEnd ? { dueFrom: start < previewEnd ? start : previewEnd, dueTo: start < previewEnd ? previewEnd : start } : selected;

  function close(restoreFocus = false) {
    setOpen(false); setStart(null); setHoveredDate(null); focusRequest.current = null;
    if (restoreFocus) trigger.current?.focus({ preventScroll: true });
  }
  function commit(next: DateFilterValue) { onChange(next); close(true); }
  function show() {
    const date = selected?.dueFrom || today;
    setFirstMonth(monthStart(date)); setFocusedDate(date); focusRequest.current = date;
    setStart(null); setHoveredDate(null); setOpen(true);
  }
  usePopoverDismiss(open, [panel, trigger], () => close(), () => close(true));
  useEffect(() => {
    const media = window.matchMedia('(max-width: 600px)');
    const update = () => setCompact(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  // External shortcuts (for example the overview) replace an unfinished selection too.
  useEffect(() => { setOpen(false); setStart(null); setHoveredDate(null); }, [value]);
  useLayoutEffect(() => {
    if (open && (focusedDate < firstMonth || focusedDate >= addMonths(firstMonth, monthCount))) {
      setFirstMonth(monthStart(focusedDate)); focusRequest.current = focusedDate;
    }
  }, [open, focusedDate, firstMonth, monthCount]);
  useLayoutEffect(() => {
    if (!open || !position || !focusRequest.current) return;
    const button = panel.current?.querySelector<HTMLButtonElement>(`[data-date="${focusRequest.current}"]`);
    if (button) { button.focus({ preventScroll: true }); focusRequest.current = null; }
  }, [open, firstMonth, focusedDate, compact, position]);

  function selectDate(date: string) {
    if (!start) { setStart(date); setHoveredDate(date); return; }
    commit({ kind: 'range', dueFrom: date < start ? date : start, dueTo: date < start ? start : date });
  }
  function moveMonth(amount: number) {
    const next = addMonths(firstMonth, amount);
    setFirstMonth(next); setFocusedDate(next); setHoveredDate(null);
  }
  function onDateKey(event: KeyboardEvent<HTMLButtonElement>, date: string) {
    const next = keyTarget(event.key, date, event.shiftKey);
    if (!next) return;
    event.preventDefault();
    if (next < firstMonth || next >= addMonths(firstMonth, monthCount)) setFirstMonth(monthStart(next));
    setFocusedDate(next); focusRequest.current = next;
  }

  return <div className="task-date-filter">
    <button type="button" ref={trigger} className={`task-date-trigger ${value.kind !== 'all' ? 'is-filtered' : ''}`}
      aria-label="按截止日期筛选" aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined}
      title={label} onClick={() => open ? close() : show()}>
      <CalendarDays size={14} aria-hidden="true" /><span>{label}</span><ChevronDown size={14} aria-hidden="true" />
    </button>
    {open && createPortal(<div ref={panel} id={id} role="dialog" aria-label="截止日期筛选" aria-describedby={`${id}-hint`}
      className="task-date-popover" style={{ left: position?.left ?? 0, top: position?.top ?? 0, visibility: position ? 'visible' : 'hidden' }}>
      <header className="task-date-heading"><strong>截止日期</strong><button type="button" className="task-date-icon" aria-label="关闭日期筛选" onClick={() => close(true)}><X size={16} /></button></header>
      <div className="task-date-shortcuts" aria-label="快捷日期">
        {(['today', 'week', 'month'] as const).map(preset => <button type="button" key={preset}
          aria-pressed={value.kind === 'preset' && value.preset === preset} onClick={() => commit({ kind: 'preset', preset })}>{presetLabels[preset]}</button>)}
      </div>
      <div className="task-date-calendar-nav"><button type="button" className="task-date-icon" aria-label="上个月" onClick={() => moveMonth(-1)}><ChevronLeft size={17} /></button>
        <span>选择开始和结束日期</span><button type="button" className="task-date-icon" aria-label="下个月" onClick={() => moveMonth(1)}><ChevronRight size={17} /></button></div>
      <div className="task-date-calendars" onMouseLeave={() => setHoveredDate(null)}>
        {Array.from({ length: monthCount }, (_, index) => {
          const month = addMonths(firstMonth, index);
          const titleId = `${id}-month-${index}`;
          return <div className="task-date-month" key={month}>
            <h3 id={titleId}>{month.slice(0, 4)}年 {Number(month.slice(5, 7))}月</h3>
            <table role="grid" aria-labelledby={titleId}><thead><tr>{WEEKDAYS.map(day => <th scope="col" key={day} aria-label={`星期${day}`}>{day}</th>)}</tr></thead>
              <tbody>{monthWeeks(month).map((week, row) => <tr key={row}>{week.map((date, weekday) => {
                if (!date) return <td key={weekday} />;
                const inRange = !!range && date >= range.dueFrom && date <= range.dueTo;
                const edge = date === range?.dueFrom || date === range?.dueTo;
                return <td key={weekday} aria-selected={inRange} className={`${inRange ? 'in-range' : ''} ${date === range?.dueFrom ? 'range-start' : ''} ${date === range?.dueTo ? 'range-end' : ''}`}>
                  <button type="button" data-date={date} tabIndex={date === focusedDate ? 0 : -1} aria-label={dateLabel(date)} aria-current={date === today ? 'date' : undefined}
                    className={edge ? 'range-edge' : ''} onClick={() => selectDate(date)} onKeyDown={event => onDateKey(event, date)}
                    onFocus={() => { setFocusedDate(date); if (start) setHoveredDate(date); }} onMouseEnter={() => { if (start) setHoveredDate(date); }}>{Number(date.slice(8))}</button>
                </td>;
              })}</tr>)}</tbody>
            </table>
          </div>;
        })}
      </div>
      <p id={`${id}-hint`} className="task-date-hint" aria-live="polite">{start ? `已选 ${dateLabel(start)}，再选一天即可筛选。` : '选完即筛选，包含首尾两天；同一天点两次可筛选单日。'}</p>
      <footer className="task-date-footer"><div>{(['upcoming', 'overdue', 'none'] as const).map(preset => <button type="button" key={preset}
        aria-pressed={value.kind === 'preset' && value.preset === preset} onClick={() => commit({ kind: 'preset', preset })}>{presetLabels[preset]}</button>)}</div>
        <button type="button" className="task-date-clear" onClick={() => commit({ kind: 'all' })}>清除日期筛选</button></footer>
    </div>, document.body)}
  </div>;
}
