import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, CalendarCheck, Check, ShieldCheck, Users } from 'lucide-react';
import { Brand, PasswordInput, useAuth } from './auth';
import { Button, Field, FormError, StatusBadge } from './ui';
import { ThemeControl } from './theme';

// Decorative task cards borrowed from the board; the top one is "being dragged".
const showcaseCards = [
  { status: 'done', title: '更新团队共享资料', due: '已完成', owner: '周' },
  { status: 'todo', title: '整理项目交付清单', due: '明天', owner: '林' },
  { status: 'in_progress', title: '同步本周任务进展', due: '今天', owner: '陈' },
] as const;

export function LoginPage() {
  const auth = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const screen = useRef<HTMLDivElement>(null);

  // A light parallax on the card stack: mouse only, and never with reduced motion.
  useEffect(() => {
    const root = screen.current!;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0;
    const reset = () => { cancelAnimationFrame(frame); root.style.removeProperty('--px'); root.style.removeProperty('--py'); };
    const move = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse' || motion.matches) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        root.style.setProperty('--px', (event.clientX / window.innerWidth - .5).toFixed(3));
        root.style.setProperty('--py', (event.clientY / window.innerHeight - .5).toFixed(3));
      });
    };
    root.addEventListener('pointermove', move);
    root.addEventListener('pointerleave', reset);
    motion.addEventListener('change', reset);
    return () => { reset(); root.removeEventListener('pointermove', move); root.removeEventListener('pointerleave', reset); motion.removeEventListener('change', reset); };
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || auth.loading) return;
    setBusy(true); setError(null);
    try { await auth.login(username, password); } catch (e) { setError(e); } finally { setBusy(false); }
  }

  return <div className="login-screen" ref={screen}>
    <header className="login-topbar">
      <div className="login-brandbar"><Brand /><span>让工作自然衔接</span></div>
      <div className="login-theme"><ThemeControl /></div>
    </header>
    <div className="login-layout">
      <main className="login-form-area">
        <section className="login-card" aria-labelledby="login-title">
          <div className="login-mark" aria-hidden="true"><svg viewBox="0 0 40 40" fill="none"><path d="m9 12 5 17 6-11 6 11 5-17" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg></div>
          <h1 id="login-title">欢迎回来</h1>
          <p className="login-description">登录你的团队工作空间，继续今天的进展。</p>
          <form onSubmit={submit} className="login-fields">
            <Field label="用户名"><input value={username} onChange={event => setUsername(event.target.value)} required maxLength={32}
              autoComplete="username" autoFocus placeholder="输入你的用户名" disabled={busy} /></Field>
            <Field label="密码"><PasswordInput value={password} onChange={setPassword} minLength={1} placeholder="输入密码" disabled={busy} /></Field>
            <FormError error={error} />
            <Button type="submit" variant="primary" loading={busy} disabled={auth.loading} className="login-submit">登录<ArrowRight size={18} /></Button>
            <p className="login-help">没有账号或忘记密码？请联系团队管理员。</p>
          </form>
        </section>
        <p className="login-access-note"><ShieldCheck size={15} />仅限团队成员访问</p>
      </main>
      <section className="login-showcase" aria-label="WorkSync 介绍">
        <p className="login-eyebrow">团队工作空间</p>
        <h2>让想法接力，<br />让进展<em>同步</em>。</h2>
        <p>把任务安排好，把进展记下来。和团队一起，让每一份投入都有着落。</p>
        <div className="login-stack" aria-hidden="true">
          {showcaseCards.map(card => <div className="stack-card" key={card.title}>
            <StatusBadge status={card.status} /><strong>{card.title}</strong>
            <footer><span className="due-date">{card.due}</span><span className="avatar avatar-small">{card.owner}</span></footer>
          </div>)}
        </div>
        <ul className="login-points">
          <li><Users size={16} aria-hidden="true" />明确分工</li>
          <li><Check size={16} aria-hidden="true" />同步进展</li>
          <li><CalendarCheck size={16} aria-hidden="true" />回顾成果</li>
        </ul>
      </section>
    </div>
  </div>;
}
