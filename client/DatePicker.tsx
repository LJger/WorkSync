import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { addDays, addMonths, localDate } from '../shared/dates';
import { WEEKDAYS, dateLabel, keyTarget, monthStart, monthWeeks } from './calendar';
import { usePopoverDismiss, usePopoverPosition } from './popover';

const weekdayOf = (date: string) => `星期${WEEKDAYS[(new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7]}`;

// Single-date picker styled like the task date filter. The popover renders in place (not in a
// portal) so it stays inside modal dialogs; fixed positioning keeps it clear of their overflow.
export function DatePicker({ value, onChange, disabled = false, id, 'aria-labelledby': labelledBy, 'aria-describedby': describedBy }: {
  value: string; onChange: (date: string) => void; disabled?: boolean; id?: string; 'aria-labelledby'?: string; 'aria-describedby'?: string;
}) {
  const today = localDate();
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(monthStart(value || today));
  const [focused, setFocused] = useState(value || today);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const focusRequest = useRef(false);
  const popoverId = useId();
  const valueId = `${popoverId}-value`, titleId = `${popoverId}-title`;
  const position = usePopoverPosition(open, trigger, panel);

  function close(restoreFocus = false) {
    setOpen(false);
    if (restoreFocus) trigger.current?.focus({ preventScroll: true });
  }
  function commit(date: string) { onChange(date); close(true); }
  function show() {
    const date = value || today;
    setMonth(monthStart(date)); setFocused(date); focusRequest.current = true; setOpen(true);
  }
  function moveMonth(amount: number) {
    const next = addMonths(month, amount);
    setMonth(next); setFocused(next);
  }
  function onDateKey(event: KeyboardEvent<HTMLButtonElement>, date: string) {
    const next = keyTarget(event.key, date, event.shiftKey);
    if (!next) return;
    event.preventDefault();
    setMonth(monthStart(next)); setFocused(next); focusRequest.current = true;
  }
  usePopoverDismiss(open, [panel, trigger], () => close(), () => close(true));
  useLayoutEffect(() => {
    if (!open || !position || !focusRequest.current) return;
    panel.current?.querySelector<HTMLButtonElement>(`[data-date="${focused}"]`)?.focus({ preventScroll: true });
    focusRequest.current = false;
  }, [open, position, focused, month]);

  const shortcuts = [['今天', today], ['明天', addDays(today, 1)], ['一周后', addDays(today, 7)]] as const;
  return <div className="date-picker">
    <button type="button" id={id} ref={trigger} className={`date-picker-trigger ${value ? 'has-value' : ''}`} disabled={disabled}
      aria-labelledby={labelledBy ? `${labelledBy} ${valueId}` : undefined} aria-describedby={describedBy}
      aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? popoverId : undefined} onClick={() => open ? close() : show()}>
      <CalendarDays size={16} aria-hidden="true" /><span id={valueId}>{value ? `${dateLabel(value)} ${weekdayOf(value)}` : '未设截止日期'}</span><ChevronDown size={14} aria-hidden="true" />
    </button>
    {open && <div ref={panel} id={popoverId} role="dialog" aria-label="选择截止日期" className="task-date-popover date-picker-popover"
      style={{ left: position?.left ?? 0, top: position?.top ?? 0, visibility: position ? 'visible' : 'hidden' }}>
      <div className="task-date-shortcuts" aria-label="快捷日期">{shortcuts.map(([label, date]) =>
        <button type="button" key={label} aria-pressed={value === date} onClick={() => commit(date)}>{label}</button>)}</div>
      <div className="task-date-calendar-nav"><button type="button" className="task-date-icon" aria-label="上个月" onClick={() => moveMonth(-1)}><ChevronLeft size={17} /></button>
        <strong id={titleId}>{month.slice(0, 4)}年 {Number(month.slice(5, 7))}月</strong>
        <button type="button" className="task-date-icon" aria-label="下个月" onClick={() => moveMonth(1)}><ChevronRight size={17} /></button></div>
      <div className="task-date-month">
        <table role="grid" aria-labelledby={titleId}><thead><tr>{WEEKDAYS.map(day => <th scope="col" key={day} aria-label={`星期${day}`}>{day}</th>)}</tr></thead>
          <tbody>{monthWeeks(month).map((week, row) => <tr key={row}>{week.map((date, weekday) => !date ? <td key={weekday} /> :
            <td key={weekday} aria-selected={date === value}>
              <button type="button" data-date={date} tabIndex={date === focused ? 0 : -1} aria-label={dateLabel(date)} aria-current={date === today ? 'date' : undefined}
                className={date === value ? 'range-edge' : ''} onClick={() => commit(date)} onKeyDown={event => onDateKey(event, date)} onFocus={() => setFocused(date)}>{Number(date.slice(8))}</button>
            </td>)}</tr>)}</tbody>
        </table>
      </div>
      <footer className="task-date-footer"><span>截止日期当天仍算按时完成</span>
        <button type="button" className="task-date-clear" disabled={!value} onClick={() => commit('')}>清除日期</button></footer>
    </div>}
  </div>;
}
