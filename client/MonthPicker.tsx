import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { addMonths } from '../shared/dates';
import { usePopoverDismiss, usePopoverPosition } from './popover';

export const offsetMonth = (month: string, count: number) => addMonths(`${month}-01`, count).slice(0, 7);
const monthLabel = (month: string) => `${month.slice(0, 4)}年${Number(month.slice(5))}月`;
const keySteps: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -4, ArrowDown: 4 };

// A month picker that matches the task date filter: a pill trigger and a 4×3 month grid.
export function MonthPicker({ value, min, max, onChange }: { value: string; min: string; max: string; onChange: (month: string) => void }) {
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(Number(value.slice(0, 4)));
  const [focused, setFocused] = useState(value);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const focusRequest = useRef(false);
  const id = useId();
  const position = usePopoverPosition(open, trigger, panel);
  const minYear = Number(min.slice(0, 4)), maxYear = Number(max.slice(0, 4));

  function close(restoreFocus = false) {
    setOpen(false);
    if (restoreFocus) trigger.current?.focus({ preventScroll: true });
  }
  function commit(month: string) { onChange(month); close(true); }
  function show() {
    setYear(Number(value.slice(0, 4))); setFocused(value); focusRequest.current = true; setOpen(true);
  }
  function moveFocus(month: string) {
    setYear(Number(month.slice(0, 4))); setFocused(month); focusRequest.current = true;
  }
  function onMonthKey(event: KeyboardEvent<HTMLButtonElement>, month: string) {
    const step = keySteps[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const next = offsetMonth(month, step);
    if (next >= min && next <= max) moveFocus(next);
  }
  usePopoverDismiss(open, [panel, trigger], () => close(), () => close(true));
  useLayoutEffect(() => {
    if (!open || !position || !focusRequest.current) return;
    panel.current?.querySelector<HTMLButtonElement>(`[data-month="${focused}"]`)?.focus({ preventScroll: true });
    focusRequest.current = false;
  }, [open, position, focused, year]);

  return <div className="month-picker">
    <button type="button" ref={trigger} className="month-trigger" aria-label={`总结月份：${monthLabel(value)}`} aria-haspopup="dialog" aria-expanded={open}
      aria-controls={open ? id : undefined} onClick={() => open ? close() : show()}>
      <CalendarDays size={16} aria-hidden="true" /><span>{monthLabel(value)}</span><ChevronDown size={14} aria-hidden="true" />
    </button>
    {open && createPortal(<div ref={panel} id={id} role="dialog" aria-label="选择总结月份" className="month-popover"
      style={{ left: position?.left ?? 0, top: position?.top ?? 0, visibility: position ? 'visible' : 'hidden' }}>
      <header className="month-popover-heading">
        <button type="button" className="task-date-icon" aria-label="上一年" disabled={year <= minYear} onClick={() => setYear(year - 1)}><ChevronLeft size={17} /></button>
        <strong>{year} 年</strong>
        <button type="button" className="task-date-icon" aria-label="下一年" disabled={year >= maxYear} onClick={() => setYear(year + 1)}><ChevronRight size={17} /></button>
      </header>
      <div className="month-grid" role="group" aria-label={`${year} 年`}>
        {Array.from({ length: 12 }, (_, index) => {
          const month = `${year}-${String(index + 1).padStart(2, '0')}`;
          return <button type="button" key={month} data-month={month} aria-label={monthLabel(month)} aria-pressed={month === value}
            aria-current={month === max ? 'date' : undefined} disabled={month < min || month > max} tabIndex={month === focused ? 0 : -1}
            onClick={() => commit(month)} onKeyDown={event => onMonthKey(event, month)} onFocus={() => setFocused(month)}>{index + 1} 月</button>;
        })}
      </div>
      <footer className="month-popover-footer">
        <span>历史月份按当月结束时的记录还原</span>
        <button type="button" aria-pressed={value === max} onClick={() => commit(max)}>本月</button>
      </footer>
    </div>, document.body)}
  </div>;
}
