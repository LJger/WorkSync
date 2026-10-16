import { cloneElement, createContext, isValidElement, useCallback, useContext, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Bell, Check, CheckCircle2, Circle, CircleDot, Copy, Inbox, LoaderCircle, RefreshCw, TriangleAlert, X } from 'lucide-react';
import type { Member, Task, TaskStatus } from '../shared/types';
import { STATUS_LABELS } from '../shared/types';
import { addDays, localDate } from '../shared/dates';
import { errorMessage } from './api';

export function Button({ children, variant = 'secondary', loading, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; loading?: boolean;
}) {
  return <button type="button" {...props} disabled={props.disabled || loading} className={`button button-${variant} ${className}`}>
    {loading && <LoaderCircle size={16} className="spin" aria-hidden="true" />}{children}
  </button>;
}
export function IconButton({ label, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; children: ReactNode }) {
  return <Button variant="ghost" {...props} className={`icon-button ${props.className || ''}`} aria-label={label} title={label}>{children}</Button>;
}
export function Avatar({ member, small = false }: { member: Member; small?: boolean }) {
  const color = member.username.split('').reduce((sum, c) => sum + c.charCodeAt(0), 0) % 5;
  return <span className={`avatar avatar-${color}${small ? ' avatar-small' : ''}`} title={member.displayName} aria-hidden="true">{member.displayName.slice(0, 1)}</span>;
}
export function AvatarStack({ members, max = 3, labelled = true }: { members: Member[]; max?: number; labelled?: boolean }) {
  const hidden = members.length - max;
  const names = members.map(m => m.displayName).join('、');
  return <span className="avatar-stack" title={names} {...labelled ? { role: 'img', 'aria-label': `负责人：${names}` } : { 'aria-hidden': true }}>
    {members.slice(0, hidden > 0 ? max - 1 : max).map(m => <Avatar member={m} small key={m.id} />)}
    {hidden > 0 && <span className="avatar-more">+{hidden + 1}</span>}
  </span>;
}
export function StatusIcon({ status, size = 14 }: { status: TaskStatus; size?: number }) {
  const Icon = status === 'done' ? CheckCircle2 : status === 'in_progress' ? CircleDot : Circle;
  return <Icon size={size} aria-hidden="true" />;
}
export function StatusBadge({ status }: { status: TaskStatus }) {
  return <span className={`status status-${status}`}><StatusIcon status={status} />{STATUS_LABELS[status]}</span>;
}
export function StatusSelect({ task, onChange, disabled }: { task: Task; onChange: (status: TaskStatus) => void; disabled?: boolean }) {
  return <span className={`status-select status-${task.status}`}>
    <StatusIcon status={task.status} />
    <select aria-label={`更新「${task.title}」状态`} value={task.status} disabled={disabled || !!task.archivedAt}
      onClick={e => e.stopPropagation()} onChange={e => onChange(e.target.value as TaskStatus)}>
      {Object.entries(STATUS_LABELS).map(([value, text]) => <option key={value} value={value}>{text}</option>)}
    </select>
  </span>;
}
export function DueDate({ task }: { task: Task }) {
  if (!task.dueDate) return <span className="due-date muted">未设日期</span>;
  const today = localDate();
  const text = task.dueDate === today ? '今天' : task.dueDate === addDays(today, 1) ? '明天' : `${Number(task.dueDate.slice(5, 7))}月${Number(task.dueDate.slice(8))}日`;
  const soon = !task.archivedAt && task.status !== 'done' && [today, addDays(today, 1)].includes(task.dueDate);
  return <span className={`due-date ${task.overdue ? 'due-overdue' : soon ? 'due-soon' : ''}`} title={`截止日期 ${task.dueDate}`}>
    {task.overdue && <span className="due-dot" />} {text}{task.overdue && <span className="due-caption">逾期</span>}
  </span>;
}
export function Modal({ title, children, onClose, drawer = false, className = '', subtitle }: {
  title: string; subtitle?: string; children: ReactNode; onClose: () => void; drawer?: boolean; className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const onCloseRef = useRef(onClose); onCloseRef.current = onClose;
  useEffect(() => {
    const dialog = ref.current!;
    if (!dialog.open) dialog.showModal();
    return () => { if (dialog.open) dialog.close(); };
  }, []);
  return <dialog ref={ref} aria-labelledby={id} className={`modal ${drawer ? 'drawer' : ''} ${className}`}
    onCancel={event => { event.preventDefault(); onCloseRef.current(); }}
    onClick={event => { if (event.target === event.currentTarget) {
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onCloseRef.current();
    } }}>
    <div className="modal-shell">
      <header className="modal-header"><div><h2 id={id}>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><IconButton label="关闭" onClick={onClose}><X size={20} /></IconButton></header>
      {children}
    </div>
  </dialog>;
}
export function Field({ label, children, hint, required }: { label: string; children: ReactNode; hint?: string; required?: boolean }) {
  const fieldId = useId();
  const labelId = `${fieldId}-label`, hintId = `${fieldId}-hint`;
  const child = isValidElement<Record<string, unknown>>(children) ? children : null;
  const controlId = typeof child?.props.id === 'string' ? child.props.id : fieldId;
  const control = child ? cloneElement(child, { id: controlId, 'aria-labelledby': labelId, ...(hint ? { 'aria-describedby': hintId } : {}) }) : children;
  return <div className="field"><div className="field-label"><label id={labelId} htmlFor={controlId}>{label}</label>{required && <span className="required-mark" aria-hidden="true">*</span>}</div>{control}{hint && <span id={hintId} className="field-hint">{hint}</span>}</div>;
}
export function FormError({ error }: { error?: unknown }) {
  if (!error) return null;
  return <div className="form-error" role="alert"><TriangleAlert size={17} /><span>{typeof error === 'string' ? error : errorMessage(error)}</span></div>;
}
export function Loading({ label = '正在加载…' }: { label?: string }) {
  return <div className="loading-state" role="status"><LoaderCircle size={22} className="spin" /><span>{label}</span></div>;
}
export function ErrorPanel({ error, retry }: { error: unknown; retry: () => void }) {
  return <div className="error-panel" role="alert"><TriangleAlert size={24} /><h3>暂时无法加载</h3><p>{errorMessage(error)}</p><Button onClick={retry}><RefreshCw size={15} />重新加载</Button></div>;
}
export function EmptyState({ title, description, children, icon }: { title: string; description: string; children?: ReactNode; icon?: ReactNode }) {
  return <div className="empty-state"><span className="empty-icon">{icon || <Inbox size={30} strokeWidth={1.4} />}</span><h3>{title}</h3><p>{description}</p>{children}</div>;
}
export function PageHeader({ title, description, eyebrow, children }: { title: string; description: string; eyebrow?: string; children?: ReactNode }) {
  return <header className="page-header"><div>{eyebrow && <p className="page-eyebrow">{eyebrow}</p>}<h1>{title}</h1><p>{description}</p></div>{children && <div className="page-actions">{children}</div>}</header>;
}
export function useDebounced<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => { const timer = window.setTimeout(() => setDebounced(value), delay); return () => clearTimeout(timer); }, [value, delay]);
  return debounced;
}

interface ConfirmOptions { title: string; message: string; label?: string; danger?: boolean }
type ToastKind = 'success' | 'error' | 'info';
interface ToastAction { label: string; onClick: () => void }
interface UIContextValue {
  toast: (message: string, kind?: ToastKind, action?: ToastAction) => () => void;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  copy: (text: string, title?: string) => Promise<boolean>;
}
const UIContext = createContext<UIContextValue>(null!);
export const useUI = () => useContext(UIContext);

export function UIProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<{ id: number; message: string; kind: ToastKind; action?: ToastAction }[]>([]);
  const nextId = useRef(0);
  const timers = useRef(new Map<number, number>());
  const [confirmation, setConfirmation] = useState<(ConfirmOptions & { resolve: (value: boolean) => void }) | null>(null);
  const [copyFallback, setCopyFallback] = useState<{ title: string; text: string } | null>(null);
  const copyArea = useRef<HTMLTextAreaElement>(null);
  const dismissToast = useCallback((id: number) => {
    setToasts(current => current.filter(item => item.id !== id));
    window.clearTimeout(timers.current.get(id));
    timers.current.delete(id);
  }, []);
  const toast = useCallback((message: string, kind: ToastKind = 'success', action?: ToastAction) => {
    const id = ++nextId.current;
    setToasts(current => [...current.slice(-3), { id, message, kind, action }]);
    timers.current.set(id, window.setTimeout(() => dismissToast(id), kind === 'info' ? 8000 : kind === 'error' ? 6500 : 3500));
    return () => dismissToast(id);
  }, [dismissToast]);
  useEffect(() => {
    const activeTimers = timers.current;
    return () => activeTimers.forEach(clearTimeout);
  }, []);
  useEffect(() => { if (copyFallback) requestAnimationFrame(() => copyArea.current?.select()); }, [copyFallback]);
  const confirm = useCallback((options: ConfirmOptions) => new Promise<boolean>(resolve => {
    setConfirmation(previous => { previous?.resolve(false); return { ...options, resolve }; });
  }), []);
  const closeConfirm = (value: boolean) => { confirmation?.resolve(value); setConfirmation(null); };
  const copy = useCallback(async (text: string, title = '复制内容') => {
    let copied = false;
    try { if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); copied = true; } } catch { /* HTTP 或浏览器权限限制 */ }
    if (!copied) {
      const active = document.activeElement as HTMLElement | null;
      const textarea = document.createElement('textarea');
      textarea.value = text; textarea.style.cssText = 'position:fixed;left:-9999px;top:0;';
      textarea.setAttribute('aria-hidden', 'true'); document.body.appendChild(textarea); textarea.select();
      try { copied = document.execCommand('copy'); } catch { /* 显示手动复制回退 */ }
      textarea.remove(); active?.focus();
    }
    if (copied) toast('已复制到剪贴板');
    else setCopyFallback({ title, text });
    return copied;
  }, [toast]);
  return <UIContext.Provider value={{ toast, confirm, copy }}>
    {children}
    <div className="toast-stack" aria-live="polite">{toasts.map(item => <div className={`toast toast-${item.kind}`} key={item.id}>
      {item.kind === 'success' ? <CheckCircle2 size={18} /> : item.kind === 'info' ? <Bell size={18} /> : <TriangleAlert size={18} />}<span>{item.message}</span>
      {item.action && <button type="button" className="toast-action" onClick={() => { dismissToast(item.id); item.action!.onClick(); }}>{item.action.label}</button>}
      <IconButton label="关闭提示" onClick={() => dismissToast(item.id)}><X size={15} /></IconButton>
    </div>)}</div>
    {confirmation && <Modal title={confirmation.title} onClose={() => closeConfirm(false)} className="confirm-modal">
      <div className="modal-body"><p className="confirm-message">{confirmation.message}</p></div><footer className="modal-footer"><Button onClick={() => closeConfirm(false)}>取消</Button>
        <Button variant={confirmation.danger ? 'danger' : 'primary'} onClick={() => closeConfirm(true)}>{confirmation.label || '确认'}</Button></footer>
    </Modal>}
    {copyFallback && <Modal title={copyFallback.title} onClose={() => setCopyFallback(null)}>
      <div className="modal-body"><p className="helper-text">浏览器未允许自动复制，内容已选中，可按 Ctrl+C 或长按复制。</p><textarea className="copy-fallback" ref={copyArea} readOnly value={copyFallback.text} aria-label="待复制内容" /></div>
      <footer className="modal-footer"><Button variant="primary" onClick={() => setCopyFallback(null)}>完成</Button></footer>
    </Modal>}
  </UIContext.Provider>;
}
export function CopyButton({ text, label = '复制', title }: { text: string; label?: string; title?: string }) {
  const { copy } = useUI();
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return <Button onClick={async () => { if (await copy(text, title)) { setCopied(true); timer.current = window.setTimeout(() => setCopied(false), 1800); } }}>
    {copied ? <Check size={16} /> : <Copy size={16} />}{copied ? '已复制' : label}
  </Button>;
}
export function TextLinks({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s<>"']+)/g);
  return <span className="text-links">{parts.map((part, index) => {
    if (!/^https?:\/\//.test(part)) return <span key={index}>{part}</span>;
    const match = part.match(/[，。；！？）】]+$/);
    const suffix = match?.[0] || '';
    const href = suffix ? part.slice(0, -suffix.length) : part;
    return <span key={index}><a href={href} target="_blank" rel="noopener noreferrer">{href}</a>{suffix}</span>;
  })}</span>;
}
