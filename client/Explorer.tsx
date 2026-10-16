import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, CalendarDays, Compass, FolderOpen, LayoutList, PencilLine, Plus, Search, Settings2, Users } from 'lucide-react';
import { useAuth } from './auth';
import { Modal } from './ui';

export function Explorer({ onClose }: { onClose: () => void }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const listId = useId();
  const actions = useMemo(() => [
    { id: 'create-task', title: '新建任务', description: '记下一件事，安排给自己或团队成员', path: '/tasks?task=new', icon: Plus, tone: 'teal', keywords: '创建 分配 待办 task todo', hint: '立即开始' },
    { id: 'reports', title: '月度总结', description: '看看这个月完成了什么，一键整理工作记录', path: '/reports', icon: CalendarDays, tone: 'amber', keywords: '月报 统计 汇报 完成 report', hint: '回顾成果' },
    { id: 'shared', title: '团队共享', description: '查找常用链接、团队约定和公用信息', path: '/shared', icon: FolderOpen, tone: 'blue', keywords: '共享 文字 分类 搜索 shared', hint: '发现信息' },
    { id: 'publish', title: '发布共享信息', description: '把实用的文字与链接分享给整个团队', path: '/shared?compose=1', icon: PencilLine, tone: 'teal', keywords: '新建 发布 共享 share', hint: '贡献内容' },
    { id: 'tasks', title: '我的任务', description: '切换列表或看板，跟进手头的工作', path: '/tasks', icon: LayoutList, tone: 'blue', keywords: '任务 看板 列表 工作 task board', hint: '继续推进' },
    ...(user?.role === 'admin' ? [
      { id: 'team', title: '团队任务', description: '查看全员分工，及时协调需要跟进的事情', path: '/tasks?scope=all', icon: Users, tone: 'teal', keywords: '团队 分配 全部 team', hint: '查看全局' },
      { id: 'members', title: '团队管理', description: '维护成员账号与共享信息分类', path: '/members', icon: Settings2, tone: 'blue', keywords: '成员 账号 权限 分类 admin', hint: '管理空间' },
    ] : []),
  ], [user?.role]);
  const matches = useMemo(() => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return actions.filter(action => terms.every(term => `${action.title} ${action.description} ${action.keywords}`.toLowerCase().includes(term)));
  }, [actions, query]);
  const selected = matches[active];
  useEffect(() => { requestAnimationFrame(() => input.current?.focus()); }, []);
  useEffect(() => { list.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }); }, [selected?.id]);
  function open(path: string) { onClose(); navigate(path); }
  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing || !matches.length) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setActive(current => (current + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length);
    } else if (event.key === 'Enter' && selected) { event.preventDefault(); open(selected.path); }
  }
  return <Modal title="探索工作空间" subtitle="从一个想法，走到下一步行动。" className="explorer" onClose={onClose}>
    <div className="explorer-body"><div className="explorer-search"><Search size={20} /><input ref={input} role="combobox" aria-label="搜索功能" aria-controls={listId} aria-autocomplete="list" aria-expanded="true"
      aria-activedescendant={selected ? `${listId}-${selected.id}` : undefined} autoComplete="off" autoFocus placeholder="想做什么？试试「月报」或「共享」"
      value={query} onChange={event => { setQuery(event.target.value); setActive(0); }} onKeyDown={onKeyDown} /></div>
      <div className="explorer-caption"><span>{query ? '找到这些入口' : '让工作自然衔接'}</span><small>{matches.length} 个入口</small></div>
      <div className="explorer-list" id={listId} role="listbox" aria-label="功能入口" ref={list}>
        {matches.map((action, index) => { const Icon = action.icon; return <button id={`${listId}-${action.id}`} key={action.id} role="option" aria-selected={active === index} tabIndex={-1} className="explorer-option"
          onPointerMove={() => setActive(index)} onClick={() => open(action.path)}>
          <span className={`explorer-icon explorer-icon-${action.tone}`}><Icon size={20} strokeWidth={1.7} /></span>
          <span className="explorer-option-copy"><strong>{action.title}</strong><small>{action.description}</small></span>
          <span className="explorer-option-hint">{action.hint}</span><ArrowRight className="explorer-option-arrow" size={17} />
        </button>; })}
      </div>
      {!matches.length && <div className="explorer-empty" role="status"><Compass size={28} /><strong>换个关键词试试</strong><span>可以搜索任务、月报、共享或成员。</span></div>}
    </div>
    <footer className="explorer-footer"><span><kbd>↑</kbd><kbd>↓</kbd> 选择入口</span><span><kbd>Enter</kbd> 打开</span><span><kbd>Esc</kbd> 关闭</span></footer>
  </Modal>;
}
