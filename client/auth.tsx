import { createContext, useContext, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Check, Eye, EyeOff, KeyRound, LockKeyhole, ShieldCheck } from 'lucide-react';
import type { User } from '../shared/types';
import { api, ApiError } from './api';
import { Button, Field, FormError, IconButton, Loading, Modal, useUI } from './ui';

interface AuthValue { user: User | null; loading: boolean; error: unknown; login: (username: string, password: string) => Promise<void>; logout: () => Promise<void>; setUser: (user: User) => void; retry: () => void }
const AuthContext = createContext<AuthValue>(null!);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ['session'], queryFn: async () => {
    try { return (await api<{ user: User }>('/auth/me')).user; }
    catch (error) { if (error instanceof ApiError && error.status === 401) return null; throw error; }
  }, retry: false, staleTime: 30_000, refetchInterval: 60_000 });
  const clearPrivate = () => client.removeQueries({ predicate: q => q.queryKey[0] !== 'session' });
  useEffect(() => {
    const expired = () => { client.removeQueries({ predicate: q => q.queryKey[0] !== 'session' }); client.setQueryData(['session'], null); };
    const passwordRequired = () => { void client.invalidateQueries({ queryKey: ['session'] }); };
    window.addEventListener('worksync:unauthorized', expired);
    window.addEventListener('worksync:password-required', passwordRequired);
    return () => { window.removeEventListener('worksync:unauthorized', expired); window.removeEventListener('worksync:password-required', passwordRequired); };
  }, [client]);
  return <AuthContext.Provider value={{ user: query.data || null, loading: query.isPending, error: query.error,
    retry: () => { void query.refetch(); },
    setUser: user => client.setQueryData(['session'], user),
    login: async (username, password) => { const { user } = await api<{ user: User }>('/auth/login', { method: 'POST', body: { username, password } }); clearPrivate(); client.setQueryData(['session'], user); },
    logout: async () => { await api('/auth/logout', { method: 'POST', body: {} }); clearPrivate(); client.setQueryData(['session'], null); },
  }}>{children}</AuthContext.Provider>;
}

export function Brand({ light = false }: { light?: boolean }) {
  return <span className={`brand ${light ? 'brand-light' : ''}`}><svg viewBox="0 0 40 40" aria-hidden="true"><rect width="40" height="40" rx="12" /><path d="m9 12 5 17 6-11 6 11 5-17" /></svg><span>WorkSync<span className="brand-dot">.</span></span></span>;
}

export function PasswordInput({ value, onChange, label = '密码', autoComplete = 'current-password', minLength = 8, autoFocus = false, id, 'aria-labelledby': labelledBy, 'aria-describedby': describedBy }: {
  value: string; onChange: (value: string) => void; label?: string; autoComplete?: string; minLength?: number; autoFocus?: boolean;
  id?: string; 'aria-labelledby'?: string; 'aria-describedby'?: string;
}) {
  const [visible, setVisible] = useState(false);
  return <div className="password-input"><input id={id} aria-labelledby={labelledBy} aria-describedby={describedBy} type={visible ? 'text' : 'password'} value={value} onChange={e => onChange(e.target.value)} required
    minLength={minLength} maxLength={128} autoComplete={autoComplete} aria-label={label} autoFocus={autoFocus} />
    <IconButton label={visible ? '隐藏密码' : '显示密码'} onClick={() => setVisible(!visible)}>{visible ? <EyeOff size={18} /> : <Eye size={18} />}</IconButton>
  </div>;
}

export function LoginPage() {
  const auth = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(null);
    try { await auth.login(username, password); } catch (e) { setError(e); } finally { setBusy(false); }
  }
  return <div className="login-page">
    <section className="login-story"><Brand light /><div className="login-story-main"><div className="story-marker"><span />为团队留下一份工作记录</div>
      <h1>今天的进展，<br />月底都记得。</h1><p>分配任务，跟进进度。<br />让完成的每一件事，都有迹可循。</p>
      <div className="story-timeline" aria-hidden="true"><div><span className="story-step done"><Check size={16} /></span><p>明确分工<small>把事情安排给合适的人</small></p></div>
        <div><span className="story-step active"><span /></span><p>一起推进<small>待办、进行中、已完成</small></p></div><div><span className="story-step" /><p>回顾成果<small>一份自动积累的月度记录</small></p></div>
      </div>
    </div><div className="login-story-footer">轻一点的协作，清楚一点的进展。</div></section>
    <main className="login-main"><div className="login-mobile-brand"><Brand /></div><form className="login-form" onSubmit={submit}>
      <div className="login-icon"><LockKeyhole size={23} /></div><h2>欢迎回来</h2><p className="login-description">登录你的团队工作空间</p>
      <Field label="用户名"><input value={username} onChange={e => setUsername(e.target.value)} required maxLength={32} autoComplete="username" autoFocus placeholder="输入用户名" /></Field>
      <Field label="密码"><PasswordInput value={password} onChange={setPassword} minLength={1} /></Field>
      <FormError error={error} /><Button type="submit" variant="primary" loading={busy} className="login-submit">登录<ArrowRight size={18} /></Button>
      <p className="login-help">还没有账号或忘记密码？请联系团队管理员。</p>
    </form><div className="login-footer"><ShieldCheck size={15} /><span>仅限团队成员访问</span></div></main>
  </div>;
}

export function PasswordForm({ onDone, forced = false }: { onDone?: () => void; forced?: boolean }) {
  const auth = useAuth();
  const { toast } = useUI();
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setError(null);
    if (repeat !== newPassword) { setError('两次输入的新密码不一致。'); return; }
    setBusy(true);
    try {
      const { user } = await api<{ user: User }>('/auth/password', { method: 'POST', body: { oldPassword, newPassword } });
      auth.setUser(user); toast('密码已更新'); onDone?.();
    } catch (e) { setError(e); } finally { setBusy(false); }
  }
  return <form onSubmit={submit} className="modal-form"><div className="modal-body form-stack">
    {forced && <p className="helper-text">首次登录或密码被重置后，请设置自己的新密码再进入工作空间。</p>}
    <Field label={forced ? '初始密码' : '原密码'}><PasswordInput value={oldPassword} onChange={setOldPassword} label={forced ? '初始密码' : '原密码'} minLength={1} autoFocus /></Field>
    <Field label="新密码" hint="至少 8 个字符，与原密码不同。"><PasswordInput value={newPassword} onChange={setNewPassword} label="新密码" autoComplete="new-password" /></Field>
    <Field label="再次输入新密码"><PasswordInput value={repeat} onChange={setRepeat} label="再次输入新密码" autoComplete="new-password" /></Field><FormError error={error} />
  </div><footer className="modal-footer">{!forced && <Button onClick={onDone}>取消</Button>}<Button type="submit" variant="primary" loading={busy}>保存新密码</Button></footer></form>;
}

export function ForcedPasswordPage() {
  const { logout } = useAuth();
  const { toast } = useUI();
  return <main className="setup-page"><Brand /><section className="setup-panel"><div className="setup-heading"><KeyRound size={25} /><h1>设置你的新密码</h1></div>
    <PasswordForm forced /><Button variant="ghost" onClick={() => void logout().catch(e => toast(String(e), 'error'))}>返回登录</Button></section></main>;
}
export function PasswordDialog({ onClose }: { onClose: () => void }) {
  return <Modal title="修改密码" onClose={onClose}><PasswordForm onDone={onClose} /></Modal>;
}
export function AuthLoading() { return <main className="startup-loading"><Brand /><Loading label="正在打开工作空间…" /></main>; }
