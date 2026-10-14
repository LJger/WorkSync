import { useState, type FormEvent } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ArrowDown, ChevronDown, ChevronUp, Copy, FolderOpen, Folders, Globe2, Pencil, Pin, Plus, Search, Settings2, Trash2, X } from 'lucide-react';
import type { Category, Page, SharedInfo } from '../shared/types';
import { formatDateTime } from '../shared/dates';
import { api, ApiError, errorMessage, queryString } from './api';
import { useAuth } from './auth';
import { Avatar, Button, EmptyState, ErrorPanel, Field, FormError, IconButton, Loading, Modal, PageHeader, TextLinks, useDebounced, useUI } from './ui';

export function SharedPage() {
  const { user } = useAuth();
  const { toast, confirm } = useUI();
  const client = useQueryClient();
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [editing, setEditing] = useState<SharedInfo | 'new' | null>(null);
  const q = useDebounced(search);
  const categories = useQuery({ queryKey: ['categories'], queryFn: () => api<{ items: Category[] }>('/shared-categories'), refetchInterval: 30_000 });
  const query = useInfiniteQuery({ queryKey: ['shared', { q, categoryId }], initialPageParam: 1,
    queryFn: ({ pageParam, signal }) => api<Page<SharedInfo>>(`/shared-info${queryString({ q, categoryId, page: pageParam, pageSize: 20 })}`, { signal }),
    getNextPageParam: page => page.page * page.pageSize < page.total ? page.page + 1 : undefined, refetchInterval: 30_000 });
  const refresh = () => Promise.all(['shared', 'categories'].map(key => client.invalidateQueries({ queryKey: [key] })));
  const pin = useMutation({ mutationFn: (info: SharedInfo) => api(`/shared-info/${info.id}/pin`, { method: 'POST', body: { pinned: !info.pinned, version: info.version } }),
    onSuccess: (_, info) => { toast(info.pinned ? '已取消置顶' : '信息已置顶'); void refresh(); }, onError: error => { toast(errorMessage(error), 'error'); void refresh(); } });
  const remove = useMutation({ mutationFn: (info: SharedInfo) => api(`/shared-info/${info.id}`, { method: 'DELETE', body: { version: info.version } }),
    onSuccess: () => { toast('共享信息已删除'); void refresh(); }, onError: error => { toast(errorMessage(error), 'error'); void refresh(); } });
  const deleteInfo = async (info: SharedInfo) => {
    if (await confirm({ title: '删除这条共享信息？', message: `「${info.title}」将从共享区移除，其他成员也将无法查看。`, label: '删除信息', danger: true })) remove.mutate(info);
  };
  const items = query.data?.pages.flatMap(page => page.items) || [];
  const selectedName = categoryId === 'uncategorized' ? '未分类' : categories.data?.items.find(c => c.id === categoryId)?.name || '全部信息';
  return <>
    <PageHeader title="团队共享" description="常用的信息放在一起，需要时随手找到。"><Button variant="primary" onClick={() => setEditing('new')}><Plus size={18} />发布信息</Button></PageHeader>
    <div className="shared-layout"><aside className="category-sidebar" aria-label="共享信息分类"><div className="category-heading"><span>信息分类</span>{user!.role === 'admin' && <Link to="/members?tab=categories" aria-label="管理分类" title="管理分类"><Settings2 size={15} /></Link>}</div>
      <button className={!categoryId ? 'active' : ''} onClick={() => setCategoryId('')}><Folders size={17} /><span>全部信息</span></button>
      {categories.data?.items.map(c => <button key={c.id} className={categoryId === c.id ? 'active' : ''} onClick={() => setCategoryId(c.id)}><FolderOpen size={17} /><span>{c.name}</span><small>{c.count}</small></button>)}
      <button className={categoryId === 'uncategorized' ? 'active' : ''} onClick={() => setCategoryId('uncategorized')}><FolderOpen size={17} /><span>未分类</span></button>
      {categories.isError && <span className="category-error">分类加载失败<button onClick={() => void categories.refetch()}>重试</button></span>}
      <div className="shared-visibility"><Globe2 size={19} /><p>团队成员都能查看，<br />每个人都可以贡献信息。</p></div>
    </aside><section className="shared-main"><div className="shared-toolbar"><div><h2>{selectedName}</h2><span>{query.data?.pages[0].total ?? '—'} 条信息</span></div>
      <div className="search-field"><Search size={17} /><input aria-label="搜索共享信息" value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索标题或正文…" />{search && <IconButton label="清空搜索" onClick={() => setSearch('')}><X size={14} /></IconButton>}</div></div>
      {query.isPending ? <Loading /> : query.isError ? <ErrorPanel error={query.error} retry={() => void query.refetch()} /> : !items.length ?
        <EmptyState title={q ? '没有找到相关信息' : '这里还没有共享信息'} description={q ? '试试更简短的关键词，或切换分类。' : '常用链接、团队约定或一段实用说明，都可以放在这里。'} icon={<FolderOpen size={30} strokeWidth={1.4} />}>
          <Button variant={q ? 'secondary' : 'primary'} onClick={() => q ? setSearch('') : setEditing('new')}>{q ? '清空搜索' : '发布第一条信息'}</Button>
        </EmptyState> : <div className="shared-list">{items.map(info => <SharedCard key={info.id} info={info} canEdit={user!.role === 'admin' || user!.id === info.authorId} admin={user!.role === 'admin'}
          edit={() => setEditing(info)} pin={() => pin.mutate(info)} remove={() => void deleteInfo(info)} pending={pin.isPending || remove.isPending} />)}</div>}
      {query.hasNextPage && <div className="load-more"><Button onClick={() => void query.fetchNextPage()} loading={query.isFetchingNextPage}><ArrowDown size={15} />加载更多</Button></div>}
    </section></div>
    {editing && <SharedEditor initial={editing === 'new' ? undefined : editing} categoryId={categoryId && categoryId !== 'uncategorized' ? categoryId : null} categories={categories.data?.items || []}
      onClose={() => setEditing(null)} onSaved={() => { void refresh(); setEditing(null); }} />}
  </>;
}

function SharedCard({ info, canEdit, admin, edit, pin, remove, pending }: { info: SharedInfo; canEdit: boolean; admin: boolean; edit: () => void; pin: () => void; remove: () => void; pending: boolean }) {
  const { copy } = useUI();
  const [expanded, setExpanded] = useState(false);
  const long = info.content.length > 220 || info.content.split('\n').length > 5;
  return <article className={`shared-card ${info.pinned ? 'shared-pinned' : ''}`}><header className="shared-card-header"><div>{info.pinned && <span className="pinned-label"><Pin size={12} />置顶</span>}<h3>{info.title}</h3></div>
    <div className="shared-card-actions"><IconButton label={`复制「${info.title}」`} onClick={() => void copy(info.content, '复制共享内容')}><Copy size={16} /></IconButton>
      {admin && <IconButton label={`${info.pinned ? '取消置顶' : '置顶'}「${info.title}」`} onClick={pin} disabled={pending} className={info.pinned ? 'is-pinned' : ''}><Pin size={16} /></IconButton>}
      {canEdit && <><IconButton label={`编辑「${info.title}」`} onClick={edit}><Pencil size={16} /></IconButton><IconButton label={`删除「${info.title}」`} onClick={remove} disabled={pending} className="danger-hover"><Trash2 size={16} /></IconButton></>}
    </div></header><div className={`shared-content ${!expanded && long ? 'content-collapsed' : ''}`}><TextLinks text={info.content} /></div>
    {long && <button className="expand-text" onClick={() => setExpanded(!expanded)}>{expanded ? '收起' : '展开全文'}{expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</button>}
    <footer className="shared-card-footer"><div><Avatar member={info.author} small /><span>{info.author.displayName} 发布</span><span className="shared-updated">更新于 {formatDateTime(info.updatedAt)}</span></div><span className="category-chip"><FolderOpen size={12} />{info.categoryName || '未分类'}</span></footer>
  </article>;
}

function SharedEditor({ initial, categoryId, categories, onClose, onSaved }: { initial?: SharedInfo; categoryId: string | null; categories: Category[]; onClose: () => void; onSaved: () => void }) {
  const { toast, confirm } = useUI();
  const [original, setOriginal] = useState(initial);
  const [title, setTitle] = useState(initial?.title || '');
  const [content, setContent] = useState(initial?.content || '');
  const [selectedCategory, setSelectedCategory] = useState(initial?.categoryId || categoryId || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const dirty = title !== (original?.title || '') || content !== (original?.content || '') || selectedCategory !== (original?.categoryId || categoryId || '');
  const close = async () => {
    if (busy) return;
    if (dirty && !await confirm({ title: '放弃未保存的内容？', message: '这次填写的共享信息还没有保存。', label: '放弃修改' })) return;
    onClose();
  };
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(null);
    try {
      const body = { title, content, categoryId: selectedCategory || null };
      if (original) await api(`/shared-info/${original.id}`, { method: 'PATCH', body: { ...body, version: original.version } });
      else await api('/shared-info', { method: 'POST', body });
      toast(original ? '共享信息已更新' : '信息已发布，团队成员均可查看'); onSaved();
    } catch (e) { setError(e); } finally { setBusy(false); }
  }
  async function reload() {
    if (!original) return;
    setBusy(true);
    try { const { info } = await api<{ info: SharedInfo }>(`/shared-info/${original.id}`); setOriginal(info); setTitle(info.title); setContent(info.content); setSelectedCategory(info.categoryId || ''); setError(null); }
    catch (e) { setError(e); } finally { setBusy(false); }
  }
  return <Modal title={initial ? '编辑共享信息' : '发布共享信息'} subtitle="团队所有成员都可以看到这条信息" className="shared-editor" onClose={() => void close()}>
    <form className="modal-form" onSubmit={save}><div className="modal-body form-stack"><Field label="标题" required><input autoFocus value={title} onChange={e => setTitle(e.target.value)} required maxLength={120} placeholder="用一个清楚的标题，方便大家查找" /></Field>
      <Field label="分类"><select value={selectedCategory} onChange={e => setSelectedCategory(e.target.value)}><option value="">未分类</option>{categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
      <Field label="共享内容" required hint="支持文字与链接，保留你输入的换行。"><textarea value={content} onChange={e => setContent(e.target.value)} required maxLength={20000} rows={9} placeholder="写下团队需要共同了解或经常查找的信息…" /></Field>
      <FormError error={error} />{error instanceof ApiError && error.status === 409 && <Button onClick={() => void reload()} loading={busy}>重新加载最新内容</Button>}
    </div><footer className="modal-footer"><Button onClick={() => void close()} disabled={busy}>取消</Button><Button type="submit" variant="primary" loading={busy}>{initial ? '保存更改' : '发布信息'}</Button></footer></form>
  </Modal>;
}
