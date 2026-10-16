import { useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, Check, Circle, CircleDot, Layers3, ListTodo, ShieldCheck } from 'lucide-react';
import { Brand, PasswordInput, useAuth } from './auth';
import { Button, Field, FormError } from './ui';
import { ThemeControl } from './theme';
import { GlassSurface, LiquidScene } from './LiquidGlass';

const styles = { business: '商务', minimal: '简约', tech: '科技' } as const;
type LoginStyle = keyof typeof styles;
const defaultStyle: LoginStyle = 'minimal';

function CollaborationBoard() {
  return <div className="login-workboard" aria-hidden="true">
    <div className="workboard-heading"><span><Layers3 size={17} />本周协作</span><small>协作示意</small></div>
    <div className="workboard-columns"><span>一起推进的事</span><span>当前进展</span></div>
    <div className="workboard-row"><Circle size={17} /><span>整理项目交付清单</span><span className="workboard-status">待办</span><i>林</i></div>
    <div className="workboard-row"><CircleDot size={17} /><span>同步本周任务进展</span><span className="workboard-status workboard-active">进行中</span><i>陈</i></div>
    <div className="workboard-row"><Check size={17} /><span>更新团队共享资料</span><span className="workboard-status workboard-done">已完成</span><i>周</i></div>
    <div className="workboard-footer"><span className="workboard-people"><i>林</i><i>陈</i><i>周</i></span><span>各自有分工，一起有进展。</span></div>
  </div>;
}

function CollaborationFlow() {
  return <div className="login-flow" aria-hidden="true">
    <svg className="login-flow-lines" viewBox="0 0 500 270" fill="none">
      <path d="M60 80H175Q195 80 195 100V165Q195 185 215 185H300Q320 185 320 165V105Q320 85 340 85H460" />
      <path d="M60 80V225H440M255 185V32H460" className="flow-line-secondary" />
      <circle cx="195" cy="130" r="4" /><circle cx="320" cy="145" r="4" /><circle cx="255" cy="82" r="3" />
    </svg>
    <div className="flow-node flow-task"><span><ListTodo size={19} /></span><div><small>从一个想法开始</small><strong>明确任务</strong></div></div>
    <div className="flow-node flow-progress"><span><CircleDot size={20} /></span><div><small>每一步都有回应</small><strong>同步进展</strong></div></div>
    <div className="flow-node flow-record"><span><Check size={20} /></span><div><small>让成果留下记录</small><strong>完成，归档</strong></div></div>
    <span className="flow-caption">任务、信息与团队，在这里连接。</span>
  </div>;
}

export function LoginPage({ preview = false }: { preview?: boolean }) {
  const auth = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const requestedStyle = params.get('style');
  const style: LoginStyle = preview && requestedStyle && Object.hasOwn(styles, requestedStyle) ? requestedStyle as LoginStyle : defaultStyle;
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const layout = useRef<HTMLDivElement>(null);
  const glass = useRef<HTMLDivElement>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || auth.loading) return;
    if (preview && auth.user) { navigate('/tasks'); return; }
    setBusy(true); setError(null);
    try {
      await auth.login(username, password);
      if (preview) navigate('/tasks', { replace: true });
    } catch (e) { setError(e); } finally { setBusy(false); }
  }

  return <div className={`login-screen login-${style}${preview ? ' login-preview' : ''}`} data-login-style={style}>
    {preview && <header className="login-review-bar">
      <span>登录页预览</span>
      <nav aria-label="登录页风格">{Object.entries(styles).map(([value, label]) => <button key={value} type="button" aria-pressed={style === value} disabled={busy}
        onClick={() => setParams({ style: value }, { replace: true })}>{label}</button>)}</nav>
      <Link to={auth.user ? '/tasks' : '/'}>{auth.user ? '返回工作空间' : '正式登录页'}<ArrowRight size={14} /></Link>
    </header>}
    <div className="login-layout" ref={layout}>
      {style === 'minimal' && <LiquidScene root={layout} card={glass} />}
      <header className="login-brandbar"><Brand /><span>让工作自然衔接</span></header>
      <div className="login-theme"><ThemeControl /></div>
      <section className="login-visual" aria-label="团队协作">
        <div className="login-visual-copy">
          <div className="login-product-label"><span />团队工作空间</div>
          {style === 'business' ? <h2>每一项工作，<br />都有清晰的下一步。</h2> : <h2>让想法接力，<br />让进展同步。</h2>}
          <p>把任务安排好，把进展记下来。<br />和团队一起，让每一份投入都有着落。</p>
        </div>
        {style === 'business' ? <CollaborationBoard /> : style === 'tech' ? <CollaborationFlow /> : null}
        <div className="login-visual-footer"><span>明确分工</span><span>同步进展</span><span>回顾成果</span></div>
      </section>
      <main className="login-form-area">
        <div className="login-form-container" ref={glass}>
          {style === 'minimal' && <GlassSurface card={glass} />}
          <div className="login-form-mark" aria-hidden="true">{style === 'minimal' ? <svg viewBox="0 0 40 40" fill="none"><path d="m9 12 5 17 6-11 6 11 5-17" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg> : <Layers3 size={25} strokeWidth={1.5} />}</div>
          <h1>欢迎回来</h1><p className="login-form-description">{style === 'minimal' ? '登录你的团队工作空间' : '登录你的团队工作空间，继续今天的进展。'}</p>
          <form onSubmit={submit} className="login-fields">
            <Field label="用户名"><input value={username} onChange={event => setUsername(event.target.value)} required={!(preview && auth.user)} maxLength={32}
              autoComplete="username" autoFocus={!preview} placeholder="输入你的用户名" disabled={busy || !!(preview && auth.user)} /></Field>
            <Field label="密码"><PasswordInput value={password} onChange={setPassword} minLength={1} placeholder="输入密码" disabled={busy || !!(preview && auth.user)} required={!(preview && auth.user)} /></Field>
            <FormError error={error} />
            <Button type="submit" variant="primary" loading={busy} disabled={auth.loading} className="login-submit">{preview && auth.user ? '进入工作空间' : '登录'}<ArrowRight size={18} /></Button>
            <p className="login-help">{preview && auth.user ? `当前已登录为 ${auth.user.displayName}，可直接返回工作空间。` : style === 'minimal' ? '账号或密码问题，请联系团队管理员。' : <>还没有账号或忘记密码？<br />请联系团队管理员。</>}</p>
          </form>
        </div>
        <p className="login-access-note"><ShieldCheck size={15} />仅限团队成员访问</p>
      </main>
    </div>
  </div>;
}
