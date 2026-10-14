import { useEffect, useState, type FormEvent } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { Archive, ArchiveRestore, ArrowDown, ArrowUpRight, CalendarDays, Check, ChevronDown, CircleCheck, GripVertical, KanbanSquare, LayoutList, Plus, Search, SlidersHorizontal, X } from 'lucide-react';
import type { Member, Page, Task, TaskInput, TaskScope, TaskStatus, TaskSummary } from '../shared/types';
import { STATUS_LABELS } from '../shared/types';
import { formatDateTime, localDate } from '../shared/dates';
import { api, ApiError, errorMessage, queryString } from './api';
import { useAuth } from './auth';
import { Avatar, Button, DueDate, EmptyState, ErrorPanel, Field, FormError, IconButton, Loading, Modal, PageHeader, StatusBadge, StatusIcon, StatusSelect, useDebounced, useUI } from './ui';

export async function invalidateWork(client: QueryClient) {
  await Promise.all(['tasks', 'task', 'reports', 'notifications', 'users'].map(key => client.invalidateQueries({ queryKey: [key] })));
}
type Filters = { scope: TaskScope; q: string; status?: TaskStatus; due: string; archived: boolean; assigneeId: string };
const statuses: TaskStatus[] = ['todo', 'in_progress', 'done'];

function useTasks(filters: Filters, enabled: boolean, board = false) {
  return useInfiniteQuery({
    queryKey: ['tasks', board ? 'board' : 'list', filters], initialPageParam: 1, enabled,
    queryFn: ({ pageParam, signal }) => api<Page<Task>>(`/tasks${queryString({ ...filters, page: pageParam, pageSize: 30 })}`, { signal }),
    getNextPageParam: last => last.page * last.pageSize < last.total ? last.page + 1 : undefined,
    refetchInterval: 30_000,
  });
}

export function TasksPage() {
  const { user } = useAuth();
  const { toast } = useUI();
  const client = useQueryClient();
  const [params, setParams] = useSearchParams();
  const rawScope = params.get('scope');
  const scope: TaskScope = rawScope === 'created' ? 'created' : rawScope === 'all' && user!.role === 'admin' ? 'all' : 'assigned';
  const [view, setView] = useState<'list' | 'board'>(() => {
    try { return localStorage.getItem(`worksync:view:${user!.id}`) === 'board' && window.innerWidth > 700 ? 'board' : 'list'; } catch { return 'list'; }
  });
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<TaskStatus | ''>('');
  const [due, setDue] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [archived, setArchived] = useState(false);
  const [move, setMove] = useState<Task | null>(null);
  const [dragging, setDragging] = useState<Task | null>(null);
  const [reducedMotion, setReducedMotion] = useState(window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  const q = useDebounced(search);
  const filters: Filters = { scope, q, status: status || undefined, due, archived, assigneeId };
  const list = useTasks(filters, view === 'list');
  const summary = useQuery({ queryKey: ['tasks', 'summary', { ...filters, status: undefined }],
    queryFn: ({ signal }) => api<TaskSummary>(`/tasks/summary${queryString({ ...filters, status: undefined })}`, { signal }), refetchInterval: 30_000 });
  const members = useQuery({ queryKey: ['members'], queryFn: () => api<{ items: Member[] }>('/members') });
  const changeStatus = useMutation({
    mutationFn: ({ task, target }: { task: Task; target: TaskStatus }) => api<{ task: Task }>(`/tasks/${task.id}`, {
      method: 'PATCH', body: { version: task.version, status: target },
    }),
    onMutate: ({ task, target }) => setMove({ ...task, status: target, overdue: target !== 'done' && !!task.dueDate && task.dueDate < localDate() }),
    onSuccess: (_, { target }) => toast(target === 'done' ? '任务已完成，月度总结会自动记录' : `已切换为${STATUS_LABELS[target]}`),
    onError: error => toast(errorMessage(error), 'error'),
    onSettled: async () => { await invalidateWork(client); setMove(null); },
  });
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 7 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } }), useSensor(KeyboardSensor));
  const open = (id: string) => setParams(previous => { const next = new URLSearchParams(previous); next.set('task', id); return next; });
  const close = () => setParams(previous => { const next = new URLSearchParams(previous); next.delete('task'); return next; });
  const switchScope = (value: TaskScope) => { setAssigneeId(''); setParams(previous => { const next = new URLSearchParams(previous); next.set('scope', value); return next; }); };
  const switchView = (value: 'list' | 'board') => { setView(value); try { localStorage.setItem(`worksync:view:${user!.id}`, value); } catch { /* 不可持久化时仍可切换 */ } };
  const onStatus = (task: Task, target: TaskStatus) => { if (target !== task.status && !changeStatus.isPending) changeStatus.mutate({ task, target }); };
  const onDragEnd = (event: DragEndEvent) => {
    setDragging(null);
    const target = event.over?.id as TaskStatus | undefined;
    const task = event.active.data.current?.task as Task | undefined;
    if (task && target && statuses.includes(target)) onStatus(task, target);
  };
  const hasFilters = !!q || !!status || !!due || !!assigneeId || archived;
  const clearFilters = () => { setSearch(''); setStatus(''); setDue(''); setAssigneeId(''); setArchived(false); };
  const tasks = list.data?.pages.flatMap(page => page.items) || [];
  const count = summary.data;
  const selectedTask = params.get('task');

  return <>
    <PageHeader title={scope === 'all' ? '团队任务' : scope === 'created' ? '我创建的任务' : '我的任务'}
      description={scope === 'all' ? '看清团队分工，及时跟进需要协调的事情。' : scope === 'created' ? '跟进自己安排的工作，看看事情推进到哪里。' : '安排好手头的事，记下每一点进展。'}>
      <Button variant="primary" onClick={() => open('new')}><Plus size={18} />新建任务</Button>
    </PageHeader>

    <section className="task-overview" aria-label="任务概览">
      <div className="overview-item overview-active"><span className="overview-label">进行中</span><strong>{count?.inProgress ?? '—'}</strong><span className="overview-unit">项正在推进</span></div>
      <button className={`overview-item overview-today ${due === 'today' ? 'is-selected' : ''}`} onClick={() => setDue(due === 'today' ? '' : 'today')} aria-label="筛选今天截止的任务"><span className="overview-label">今天截止</span><strong>{count?.dueToday ?? '—'}</strong><ArrowUpRight size={16} /></button>
      <button className={`overview-item overview-late ${due === 'overdue' ? 'is-selected' : ''}`} onClick={() => setDue(due === 'overdue' ? '' : 'overdue')} aria-label="筛选逾期任务"><span className="overview-label">需要跟进</span><strong>{count?.overdue ?? '—'}</strong><span className="overview-unit">项已逾期</span><ArrowUpRight size={16} /></button>
      <div className="overview-note"><CircleCheck size={18} /><span>完成一件事，<br />月度记录就多一笔。</span></div>
    </section>

    <section className="tasks-workspace">
      <div className="workspace-topline"><div className="scope-tabs" aria-label="任务范围">
        <button className={scope === 'assigned' ? 'active' : ''} onClick={() => switchScope('assigned')}>我负责的</button>
        <button className={scope === 'created' ? 'active' : ''} onClick={() => switchScope('created')}>我创建的</button>
        {user!.role === 'admin' && <button className={scope === 'all' ? 'active' : ''} onClick={() => switchScope('all')}>整个团队</button>}
      </div><div className="view-switch" aria-label="任务视图"><button aria-label="列表视图" aria-pressed={view === 'list'} className={view === 'list' ? 'active' : ''} onClick={() => switchView('list')}><LayoutList size={17} /><span>列表</span></button>
        <button aria-label="看板视图" aria-pressed={view === 'board'} className={view === 'board' ? 'active' : ''} onClick={() => switchView('board')}><KanbanSquare size={17} /><span>看板</span></button></div></div>
      <div className="task-toolbar"><div className="search-field"><Search size={17} /><input aria-label="搜索任务" placeholder="搜索任务标题或说明…" value={search} onChange={e => setSearch(e.target.value)} />
        {search && <IconButton label="清空搜索" onClick={() => setSearch('')}><X size={14} /></IconButton>}</div>
        <div className="filter-controls">
          {view === 'list' && <label className="filter-select"><SlidersHorizontal size={14} /><select aria-label="按状态筛选" value={status} onChange={e => setStatus(e.target.value as TaskStatus | '')}><option value="">全部状态</option>{statuses.map(s => <option value={s} key={s}>{STATUS_LABELS[s]}</option>)}</select><ChevronDown size={13} /></label>}
          <label className="filter-select"><CalendarDays size={14} /><select aria-label="按截止日期筛选" value={due} onChange={e => setDue(e.target.value)}><option value="">全部日期</option><option value="today">今天截止</option><option value="upcoming">未来 7 天</option><option value="overdue">已逾期</option><option value="none">无截止日期</option></select><ChevronDown size={13} /></label>
          {scope !== 'assigned' && <label className="filter-select"><select aria-label="按负责人筛选" value={assigneeId} onChange={e => setAssigneeId(e.target.value)}><option value="">全部负责人</option>{members.data?.items.map(m => <option value={m.id} key={m.id}>{m.displayName}</option>)}</select><ChevronDown size={13} /></label>}
          <button className={`archive-toggle ${archived ? 'active' : ''}`} title="查看归档任务" aria-label="查看归档任务" aria-pressed={archived} onClick={() => setArchived(!archived)}><Archive size={16} /><span>归档</span></button>
        </div>
      </div>
      {archived && <div className="archive-banner"><Archive size={15} />正在查看归档任务，历史记录仍然保留。<button onClick={() => setArchived(false)}>返回当前任务</button></div>}
      {view === 'list' ? <>
        {list.isPending ? <Loading /> : list.isError ? <ErrorPanel error={list.error} retry={() => void list.refetch()} /> : !tasks.length ?
          <EmptyState title={hasFilters ? '没有符合条件的任务' : '从第一件要做的事开始'} description={hasFilters ? '试试调整筛选条件，或换一个关键词。' : '先写下任务标题，再安排给自己或团队成员。'}>
            <Button onClick={hasFilters ? clearFilters : () => open('new')} variant={hasFilters ? 'secondary' : 'primary'}>{hasFilters ? '清空筛选' : '新建任务'}</Button>
          </EmptyState> : <div className="task-table" role="table" aria-label="任务列表">
            <div className="task-table-head" role="row"><span role="columnheader">任务</span><span role="columnheader">状态</span><span role="columnheader">负责人</span><span role="columnheader">截止日期</span><span /></div>
            {tasks.map(original => { const task = move?.id === original.id ? move : original; return <div className={`task-row ${task.status === 'done' ? 'task-done' : ''} ${task.overdue ? 'task-late' : ''}`} role="row" key={task.id}>
              <div className="task-name-cell" role="cell"><button className={`complete-button ${task.status === 'done' ? 'completed' : ''}`} aria-label={task.status === 'done' ? `重新打开「${task.title}」` : `完成「${task.title}」`} disabled={!!task.archivedAt || changeStatus.isPending}
                onClick={() => onStatus(original, task.status === 'done' ? 'todo' : 'done')}>{task.status === 'done' && <Check size={13} />}</button>
                <button className="task-title-button" onClick={() => open(task.id)}><span>{task.title}</span>{task.description && <small>{task.description.split('\n')[0]}</small>}</button></div>
              <div role="cell" className="task-status-cell"><StatusSelect task={task} disabled={changeStatus.isPending} onChange={next => onStatus(original, next)} /></div>
              <div role="cell" className="assignee-cell"><Avatar member={task.assignee} small /><span>{task.assignee.displayName}</span></div>
              <div role="cell" className="task-date-cell"><DueDate task={task} /></div>
              <div role="cell" className="task-open-cell"><IconButton label={`查看「${task.title}」`} onClick={() => open(task.id)}><ArrowUpRight size={16} /></IconButton></div>
            </div>; })}
            <footer className="task-table-footer"><span>已显示 {tasks.length} / {list.data?.pages[0].total || 0} 项任务</span>{list.hasNextPage ? <Button variant="ghost" loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}><ArrowDown size={14} />加载更多</Button> : <span className="muted">状态更新后自动保存</span>}</footer>
          </div>}
      </> : <DndContext sensors={sensors} onDragStart={event => setDragging(event.active.data.current?.task as Task)} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}
        accessibility={{ screenReaderInstructions: { draggable: '按空格键拿起任务，使用方向键移动，空格键放下，Escape 取消。也可以直接使用卡片上的状态菜单。' } }}>
        <div className="kanban-board">{statuses.map(column => <BoardColumn key={column} status={column} filters={{ ...filters, status: column }} move={move} open={open} changeStatus={onStatus} disabled={changeStatus.isPending} />)}</div>
        <DragOverlay dropAnimation={reducedMotion ? null : { duration: 160, easing: 'ease-out' }}>{dragging && <div className="drag-preview"><StatusBadge status={dragging.status} /><strong>{dragging.title}</strong><DueDate task={dragging} /></div>}</DragOverlay>
      </DndContext>}
    </section>
    {selectedTask && <TaskDrawer id={selectedTask} onClose={close} />}
  </>;
}

function BoardColumn({ status, filters, move, open, changeStatus, disabled }: { status: TaskStatus; filters: Filters; move: Task | null; open: (id: string) => void; changeStatus: (task: Task, target: TaskStatus) => void; disabled: boolean }) {
  const query = useTasks(filters, true, true);
  const { setNodeRef, isOver } = useDroppable({ id: status, disabled: filters.archived || disabled });
  let items = query.data?.pages.flatMap(page => page.items) || [];
  if (move) {
    items = items.filter(t => t.id !== move.id);
    if (move.status === status && !(filters.due === 'overdue' && status === 'done')) items = [move, ...items];
  }
  return <section className={`kanban-column column-${status} ${isOver ? 'drop-active' : ''}`} ref={setNodeRef} aria-label={`${STATUS_LABELS[status]}看板列`}>
    <header className="column-header"><span><StatusIcon status={status} size={16} /><h2>{STATUS_LABELS[status]}</h2><span className="column-count">{query.data?.pages[0].total ?? '—'}</span></span></header>
    <div className="column-cards">{query.isPending ? <Loading /> : query.isError ? <ErrorPanel error={query.error} retry={() => void query.refetch()} /> : items.length ? items.map(task =>
      <BoardCard task={task} key={task.id} open={open} changeStatus={changeStatus} disabled={disabled} />) : <div className="empty-column">{status === 'done' ? '完成的任务会出现在这里' : '这一列还没有任务'}</div>}
      {query.hasNextPage && <Button variant="ghost" className="load-column" loading={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>加载更多</Button>}
    </div>
  </section>;
}
function BoardCard({ task, open, changeStatus, disabled }: { task: Task; open: (id: string) => void; changeStatus: (task: Task, target: TaskStatus) => void; disabled: boolean }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: task.id, data: { task }, disabled: disabled || !!task.archivedAt });
  return <article className={`board-card ${isDragging ? 'dragging' : ''} ${task.overdue ? 'card-overdue' : ''}`} ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform) }}>
    <div className="card-top"><StatusSelect task={task} disabled={disabled} onChange={target => changeStatus(task, target)} />
      {!task.archivedAt && <button className="drag-handle" {...attributes} {...listeners} aria-label={`拖动「${task.title}」`} title="拖动以切换状态"><GripVertical size={16} /></button>}</div>
    <button className="card-title" onClick={() => open(task.id)}>{task.title}</button>
    {task.description && <p className="card-description">{task.description}</p>}
    <footer className="card-footer"><DueDate task={task} /><span className="card-assignee" title={task.assignee.displayName}><Avatar member={task.assignee} small /></span></footer>
  </article>;
}

function TaskDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const isNew = id === 'new';
  const [reload, setReload] = useState(0);
  const query = useQuery({ queryKey: ['task', id], queryFn: () => api<{ task: Task }>(`/tasks/${id}`), enabled: !isNew, refetchOnWindowFocus: false, staleTime: Infinity });
  const members = useQuery({ queryKey: ['members'], queryFn: () => api<{ items: Member[] }>('/members') });
  if ((!isNew && query.isPending) || members.isPending) return <Modal title={isNew ? '新建任务' : '任务详情'} drawer onClose={onClose}><Loading /></Modal>;
  if (query.isError || members.isError) return <Modal title="任务详情" drawer onClose={onClose}><ErrorPanel error={query.error || members.error} retry={() => { void query.refetch(); void members.refetch(); }} /></Modal>;
  return <TaskEditor key={`${id}:${reload}`} initial={query.data?.task} members={members.data!.items} onClose={onClose} reload={async () => { await query.refetch(); setReload(v => v + 1); }} />;
}
function TaskEditor({ initial: initialData, members, onClose, reload }: { initial?: Task; members: Member[]; onClose: () => void; reload: () => Promise<void> }) {
  const [initial] = useState(initialData);
  const { user } = useAuth();
  const { toast, confirm } = useUI();
  const client = useQueryClient();
  const [title, setTitle] = useState(initial?.title || '');
  const [description, setDescription] = useState(initial?.description || '');
  const [assigneeId, setAssigneeId] = useState(initial?.assigneeId || user!.id);
  const [dueDate, setDueDate] = useState(initial?.dueDate || '');
  const [status, setStatus] = useState<TaskStatus>(initial?.status || 'todo');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const archived = !!initial?.archivedAt;
  const needsNewOwner = archived && initial?.status !== 'done' && !members.some(m => m.id === initial?.assigneeId);
  const conflict = error instanceof ApiError && error.status === 409;
  const dirty = title !== (initial?.title || '') || description !== (initial?.description || '') || assigneeId !== (initial?.assigneeId || user!.id) || dueDate !== (initial?.dueDate || '') || status !== (initial?.status || 'todo');
  const close = async () => {
    if (busy) return;
    if (dirty && !await confirm({ title: '放弃未保存的修改？', message: '这次填写的内容还没有保存。', label: '放弃修改' })) return;
    onClose();
  };
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(null);
    const body: TaskInput = { title, description, assigneeId, dueDate: dueDate || null };
    try {
      if (initial) await api(`/tasks/${initial.id}`, { method: 'PATCH', body: { ...body, status, version: initial.version } });
      else await api('/tasks', { method: 'POST', body });
      await invalidateWork(client); toast(initial ? '任务已更新' : '任务已创建'); onClose();
    } catch (e) { setError(e); } finally { setBusy(false); }
  }
  async function archive() {
    if (!initial) return;
    if (!archived && !await confirm({ title: '归档这项任务？', message: '任务会从日常待办中收起，并停止提醒。历史记录仍会保留，你可以随时恢复。', label: '归档任务' })) return;
    setBusy(true); setError(null);
    try {
      await api(`/tasks/${initial.id}/archive`, { method: 'POST', body: { archived: !archived, version: initial.version,
        ...(archived && assigneeId !== initial.assigneeId ? { assigneeId } : {}) } });
      await invalidateWork(client); toast(archived ? '任务已恢复' : '任务已归档'); onClose();
    } catch (e) { setError(e); } finally { setBusy(false); }
  }
  return <Modal title={initial ? '任务详情' : '新建任务'} subtitle={initial ? `由 ${initial.creator.displayName} 创建` : '先写下一件需要完成的事'} drawer onClose={() => void close()}>
    <form onSubmit={save} className="modal-form task-editor"><div className="modal-body form-stack">
      {archived && <div className="inline-notice"><Archive size={16} />这项任务已归档，恢复后可以继续编辑。</div>}
      {needsNewOwner && <div className="inline-notice">原负责人已停用，请选择一位有效成员接手后再恢复任务。</div>}
      <Field label="任务标题" required><textarea className="task-title-input" rows={2} autoFocus={!initial} value={title} onChange={e => setTitle(e.target.value)} placeholder="这件事需要完成什么？" maxLength={160} required readOnly={archived} /></Field>
      {initial && <Field label="任务状态"><select value={status} aria-label="任务状态" onChange={e => setStatus(e.target.value as TaskStatus)} disabled={archived}>{statuses.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}</select></Field>}
      <div className="form-grid"><Field label="负责人" required><select value={assigneeId} aria-label="负责人" onChange={e => setAssigneeId(e.target.value)} disabled={archived && !needsNewOwner} required>
        {initial && !members.some(m => m.id === initial.assigneeId) && <option value={initial.assigneeId}>{initial.assignee.displayName}（已停用）</option>}
        {members.map(m => <option key={m.id} value={m.id}>{m.displayName}{m.id === user!.id ? '（我）' : ''}</option>)}
      </select></Field><Field label="截止日期"><input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} disabled={archived} /></Field></div>
      <Field label="任务说明" hint="可补充背景、交付要求或需要参考的链接。"><textarea rows={7} value={description} onChange={e => setDescription(e.target.value)} maxLength={10000} placeholder="补充一点说明，协作时少一些来回确认…" readOnly={archived} /></Field>
      {initial && <dl className="task-metadata"><div><dt>创建时间</dt><dd>{formatDateTime(initial.createdAt)}</dd></div><div><dt>最近更新</dt><dd>{formatDateTime(initial.updatedAt)}</dd></div>{initial.completedAt && <div><dt>完成时间</dt><dd>{formatDateTime(initial.completedAt)}</dd></div>}</dl>}
      <FormError error={error} />{conflict && <Button onClick={() => void reload()}>重新加载最新内容</Button>}
    </div><footer className="modal-footer task-editor-footer"><div>{initial && !archived && <Button variant="ghost" disabled={busy} onClick={() => void archive()}><Archive size={16} />归档</Button>}</div><div className="footer-actions"><Button onClick={() => void close()} disabled={busy}>取消</Button>
      {archived ? <Button variant="primary" loading={busy} disabled={needsNewOwner && assigneeId === initial!.assigneeId} onClick={() => void archive()}><ArchiveRestore size={16} />恢复任务</Button> : <Button type="submit" variant="primary" loading={busy}>{initial ? '保存更改' : '创建任务'}</Button>}
    </div></footer></form>
  </Modal>;
}
