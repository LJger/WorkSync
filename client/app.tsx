import { useEffect, useRef, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Bell, CalendarDays, CheckCheck, ChevronDown, ChevronRight, CircleDot, FolderOpen, KeyRound, LayoutList, LogOut, Menu, TriangleAlert, Users, X } from 'lucide-react';
import type { Notification } from '../shared/types';
import { formatDateTime, localDate } from '../shared/dates';
import { api, errorMessage } from './api';
import { AuthLoading, Brand, ForcedPasswordPage, LoginPage, PasswordDialog, useAuth } from './auth';
import { Avatar, Button, EmptyState, ErrorPanel, IconButton, Loading, useUI } from './ui';
import { TasksPage } from './TasksPage';
import { ReportsPage } from './ReportsPage';
import { SharedPage } from './SharedPage';
import { MembersPage } from './MembersPage';

export function App() {
  const auth = useAuth();
  if (auth.loading) return <AuthLoading />;
  if (!auth.user && auth.error) return <main className="startup-loading"><Brand /><ErrorPanel error={auth.error} retry={auth.retry} /></main>;
  if (!auth.user) return <LoginPage />;
  if (auth.user.mustChangePassword) return <ForcedPasswordPage />;
  return <Workspace />;
}

function Workspace() {
  const { user, logout } = useAuth();
  const { toast } = useUI();
  const location = useLocation();
  const navigate = useNavigate();
  const client = useQueryClient();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mobile, setMobile] = useState(window.matchMedia('(max-width: 800px)').matches);
  const sidebarRef = useRef<HTMLElement>(null);
  const [popover, setPopover] = useState<'notifications' | 'account' | null>(null);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [day, setDay] = useState(localDate());
  const headerRef = useRef<HTMLDivElement>(null);
  const notifications = useQuery({ queryKey: ['notifications'], queryFn: () => api<{ items: Notification[]; unread: number }>('/notifications'), refetchInterval: 30_000 });
  const markRead = useMutation({ mutationFn: (id?: string) => api('/notifications/read', { method: 'POST', body: id ? { id } : {} }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['notifications'] }), onError: error => toast(errorMessage(error), 'error') });
  useEffect(() => { setMobileOpen(false); setPopover(null); }, [location.pathname]);
  useEffect(() => { const timer = setInterval(() => setDay(localDate()), 60_000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    const query = window.matchMedia('(max-width: 800px)');
    const changed = () => { setMobile(query.matches); if (!query.matches) setMobileOpen(false); };
    query.addEventListener('change', changed);
    return () => query.removeEventListener('change', changed);
  }, []);
  useEffect(() => {
    if (!mobile || !mobileOpen) return;
    const sidebar = sidebarRef.current!;
    const focusable = () => [...sidebar.querySelectorAll<HTMLElement>('a[href], button:not(:disabled)')];
    focusable()[0]?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const nodes = focusable();
      if (event.shiftKey && document.activeElement === nodes[0]) { event.preventDefault(); nodes.at(-1)?.focus(); }
      else if (!event.shiftKey && document.activeElement === nodes.at(-1)) { event.preventDefault(); nodes[0]?.focus(); }
    };
    sidebar.addEventListener('keydown', trap);
    return () => { sidebar.removeEventListener('keydown', trap); document.querySelector<HTMLButtonElement>('[aria-label="打开导航"]')?.focus(); };
  }, [mobile, mobileOpen]);
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (headerRef.current && !headerRef.current.contains(event.target as Node)) setPopover(null); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setPopover(null); setMobileOpen(false); } };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, []);
  const section = location.pathname.startsWith('/reports') ? '月度总结' : location.pathname.startsWith('/shared') ? '团队共享' : location.pathname.startsWith('/members') ? '团队管理' : '任务管理';
  const dateLabel = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: 'long', day: 'numeric', weekday: 'long' }).format(new Date(`${day}T12:00:00+08:00`));
  return <div className="app-layout">
    <a className="skip-link" href="#main-content">跳到主要内容</a>
    {mobileOpen && <button className="sidebar-scrim" aria-label="关闭导航" onClick={() => setMobileOpen(false)} />}
    <aside ref={sidebarRef} className={`sidebar ${mobileOpen ? 'sidebar-open' : ''}`} inert={mobile && !mobileOpen} role={mobile ? 'dialog' : undefined} aria-modal={mobile && mobileOpen ? true : undefined} aria-label={mobile ? '导航' : undefined}><div className="sidebar-brand"><Brand /><IconButton label="关闭导航" className="mobile-only" onClick={() => setMobileOpen(false)}><X size={19} /></IconButton></div>
      <div className="workspace-label"><span className="workspace-monogram"><Users size={16} /></span><span>团队工作空间<small>一起把事情推进</small></span></div>
      <nav className="main-nav" aria-label="主导航"><NavLink to="/tasks" onClick={() => setMobileOpen(false)}><LayoutList size={19} /><span>任务管理</span></NavLink>
        <NavLink to="/reports" onClick={() => setMobileOpen(false)}><CalendarDays size={19} /><span>月度总结</span></NavLink><NavLink to="/shared" onClick={() => setMobileOpen(false)}><FolderOpen size={19} /><span>团队共享</span></NavLink>
        {user!.role === 'admin' && <><div className="nav-divider" /><NavLink to="/members" onClick={() => setMobileOpen(false)}><Users size={19} /><span>团队管理</span></NavLink></>}
      </nav>
      <div className="sidebar-bottom"><div className="sidebar-month"><span className="sidebar-month-icon"><CalendarDays size={19} /></span><div><strong>{Number(day.slice(5, 7))} 月工作回顾</strong><p>回顾本月的进展</p></div><button aria-label="回顾本月工作" onClick={() => navigate('/reports')}><ArrowRight size={16} /></button></div><p className="sidebar-caption">少一些遗漏，多一点从容。</p></div>
    </aside>
    <div className="workspace-content" inert={mobile && mobileOpen}><header className="topbar"><div className="breadcrumb"><IconButton label="打开导航" className="mobile-only" onClick={() => setMobileOpen(true)}><Menu size={21} /></IconButton><span>工作空间</span><ChevronRight size={14} /><strong>{section}</strong></div>
      <div className="topbar-right" ref={headerRef}><span className="topbar-date">{dateLabel}</span>
        <div className="notification-anchor"><button className={`notification-trigger ${popover === 'notifications' ? 'active' : ''}`} aria-label={`通知${notifications.data?.unread ? `，${notifications.data.unread} 条未读` : ''}`} aria-expanded={popover === 'notifications'} onClick={() => setPopover(popover === 'notifications' ? null : 'notifications')}><Bell size={20} />{!!notifications.data?.unread && <span>{notifications.data.unread > 99 ? '99+' : notifications.data.unread}</span>}</button>
          {popover === 'notifications' && <section className="notifications-popover" aria-label="站内通知"><header><h2>通知<span>{notifications.data?.unread || 0} 条未读</span></h2><IconButton label="全部标为已读" disabled={!notifications.data?.unread || markRead.isPending} onClick={() => markRead.mutate(undefined)}><CheckCheck size={18} /></IconButton></header>
            <div className="notifications-list">{notifications.isPending ? <Loading /> : notifications.isError ? <ErrorPanel error={notifications.error} retry={() => void notifications.refetch()} /> : !notifications.data?.items.length ? <EmptyState title="暂时没有新通知" description="任务分配和到期提醒会出现在这里。" icon={<Bell size={25} />} /> : notifications.data.items.map(item => <button className={`notification-item ${item.readAt ? '' : 'unread'}`} key={item.id} onClick={() => { markRead.mutate(item.id); setPopover(null); navigate(`/tasks?task=${item.taskId}`); }}>
              <span className={`notification-kind kind-${item.kind}`}>{item.kind === 'overdue' ? <TriangleAlert size={17} /> : item.kind === 'due_soon' ? <CalendarDays size={17} /> : <CircleDot size={17} />}</span>
              <span className="notification-copy"><strong>{item.title}</strong><span>{item.message}</span><small>{formatDateTime(item.createdAt)}</small></span>{!item.readAt && <span className="unread-dot" />}
            </button>)}</div><footer>站内提醒，打开工作空间时查看。</footer>
          </section>}
        </div>
        <div className="account-anchor"><button className="account-trigger" aria-label="账号菜单" aria-expanded={popover === 'account'} onClick={() => setPopover(popover === 'account' ? null : 'account')}><Avatar member={user!} /><span>{user!.displayName}</span><ChevronDown size={13} /></button>
          {popover === 'account' && <div className="account-menu"><div><strong>{user!.displayName}</strong><small>@{user!.username} · {user!.role === 'admin' ? '管理员' : '团队成员'}</small></div><button onClick={() => { setPasswordOpen(true); setPopover(null); }}><KeyRound size={16} />修改密码</button><button onClick={() => void logout().catch(error => toast(errorMessage(error), 'error'))}><LogOut size={16} />退出登录</button></div>}
        </div>
      </div>
    </header><main className="main-content" id="main-content"><Routes><Route path="/" element={<Navigate to="/tasks" replace />} /><Route path="/tasks" element={<TasksPage />} /><Route path="/reports" element={<ReportsPage />} /><Route path="/shared" element={<SharedPage />} />
      <Route path="/members" element={user!.role === 'admin' ? <MembersPage /> : <Navigate to="/tasks" replace />} /><Route path="*" element={<Navigate to="/tasks" replace />} /></Routes></main></div>
    {passwordOpen && <PasswordDialog onClose={() => setPasswordOpen(false)} />}
  </div>;
}
