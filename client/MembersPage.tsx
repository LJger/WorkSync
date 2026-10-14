import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { FolderOpen, KeyRound, Pencil, Plus, ShieldCheck, Trash2, UserCheck, UserPlus, UserRoundX, Users } from 'lucide-react';
import type { AdminUser, Category, Role } from '../shared/types';
import { api, errorMessage } from './api';
import { PasswordInput, useAuth } from './auth';
import { Avatar, Button, EmptyState, ErrorPanel, Field, FormError, IconButton, Loading, Modal, PageHeader, useUI } from './ui';
import { invalidateWork } from './TasksPage';

type MemberEditor = { kind: 'create' } | { kind: 'edit' | 'password' | 'deactivate'; member: AdminUser };

export function MembersPage() {
  const { user } = useAuth();
  const { toast, confirm } = useUI();
  const client = useQueryClient();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'categories' ? 'categories' : 'members';
  const [editor, setEditor] = useState<MemberEditor | null>(null);
  const [category, setCategory] = useState<Category | 'new' | null>(null);
  const members = useQuery({ queryKey: ['users'], queryFn: () => api<{ items: AdminUser[] }>('/users') });
  const categories = useQuery({ queryKey: ['categories'], queryFn: () => api<{ items: Category[] }>('/shared-categories') });
  const refresh = async () => { await Promise.all([invalidateWork(client), client.invalidateQueries({ queryKey: ['members'] }), client.invalidateQueries({ queryKey: ['session'] })]); };
  const activate = useMutation({ mutationFn: (member: AdminUser) => api(`/users/${member.id}`, { method: 'PATCH', body: { active: true } }),
    onSuccess: () => { toast('账号已重新启用'); void refresh(); }, onError: error => toast(errorMessage(error), 'error') });
  const removeCategory = useMutation({ mutationFn: (item: Category) => api(`/shared-categories/${item.id}`, { method: 'DELETE' }),
    onSuccess: () => { toast('分类已删除，原有信息已移至未分类'); void client.invalidateQueries({ queryKey: ['categories'] }); void client.invalidateQueries({ queryKey: ['shared'] }); },
    onError: error => toast(errorMessage(error), 'error') });
  const rows = members.data?.items || [];
  const adminCount = rows.filter(m => m.active && m.role === 'admin').length;
  const deleteCategory = async (item: Category) => {
    if (await confirm({ title: '删除这个分类？', message: `「${item.name}」中的 ${item.count} 条信息会移至「未分类」，内容仍然保留。`, label: '删除分类', danger: true })) removeCategory.mutate(item);
  };
  return <>
    <PageHeader title="团队管理" description="管理团队成员与共享信息分类。"><Button variant="primary" onClick={() => tab === 'members' ? setEditor({ kind: 'create' }) : setCategory('new')}><Plus size={18} />{tab === 'members' ? '添加成员' : '新建分类'}</Button></PageHeader>
    <div className="management-tabs scope-tabs"><button className={tab === 'members' ? 'active' : ''} onClick={() => setParams({})}><Users size={17} />团队成员</button><button className={tab === 'categories' ? 'active' : ''} onClick={() => setParams({ tab: 'categories' })}><FolderOpen size={17} />共享分类</button></div>
    {tab === 'members' ? members.isPending ? <Loading /> : members.isError ? <ErrorPanel error={members.error} retry={() => void members.refetch()} /> : <section className="members-panel">
      <header className="panel-heading"><h2>成员列表 <span>{rows.length}</span></h2><p>{rows.filter(m => m.active).length} 位启用成员</p></header>
      <div className="table-scroll"><table className="members-table"><thead><tr><th>成员</th><th>角色</th><th>未完成任务</th><th>账号状态</th><th>管理</th></tr></thead><tbody>{rows.map(member => {
        const protectedAdmin = member.active && member.role === 'admin' && adminCount === 1;
        return <tr key={member.id} className={!member.active ? 'member-inactive' : ''}><td><div className="member-cell"><Avatar member={member} /><div><strong>{member.displayName}{member.id === user!.id && <span className="me-label">我</span>}</strong><small>@{member.username}</small></div></div></td>
          <td><span className={`role-badge ${member.role === 'admin' ? 'role-admin' : ''}`}>{member.role === 'admin' && <ShieldCheck size={13} />}{member.role === 'admin' ? '管理员' : '成员'}</span></td><td>{member.openTaskCount}<span className="muted"> 项</span></td>
          <td><span className={`account-status ${member.active ? 'account-active' : ''}`}><span />{member.active ? member.mustChangePassword ? '待修改初始密码' : '正常' : '已停用'}</span></td>
          <td><div className="table-actions"><IconButton label={`编辑成员「${member.displayName}」`} onClick={() => setEditor({ kind: 'edit', member })}><Pencil size={16} /></IconButton>
            {member.id !== user!.id && <IconButton label={`重置「${member.displayName}」的密码`} onClick={() => setEditor({ kind: 'password', member })}><KeyRound size={16} /></IconButton>}
            {member.active ? <IconButton label={protectedAdmin ? '至少保留一位管理员' : `停用「${member.displayName}」`} disabled={protectedAdmin} className="danger-hover" onClick={() => setEditor({ kind: 'deactivate', member })}><UserRoundX size={16} /></IconButton>
              : <IconButton label={`启用「${member.displayName}」`} disabled={activate.isPending} onClick={() => activate.mutate(member)}><UserCheck size={16} /></IconButton>}
          </div></td></tr>;
      })}</tbody></table></div>
      <footer className="management-note"><ShieldCheck size={16} />成员只能查看自己负责或创建的任务，管理员可以查看全部任务与团队总结。</footer>
    </section> : categories.isPending ? <Loading /> : categories.isError ? <ErrorPanel error={categories.error} retry={() => void categories.refetch()} /> :
      <section className="categories-panel"><header className="panel-heading"><h2>共享信息分类</h2><p>每条信息可选择一个分类</p></header>
        {!categories.data?.items.length ? <EmptyState title="还没有分类" description="可以按常用入口、团队约定等方式整理信息。"><Button onClick={() => setCategory('new')}>新建分类</Button></EmptyState> : categories.data.items.map(item =>
          <div className="category-management-row" key={item.id}><span className="category-folder"><FolderOpen size={20} /></span><div><h3>{item.name}</h3><p>{item.count} 条共享信息</p></div><div className="table-actions"><IconButton label={`编辑分类「${item.name}」`} onClick={() => setCategory(item)}><Pencil size={16} /></IconButton><IconButton label={`删除分类「${item.name}」`} disabled={removeCategory.isPending} className="danger-hover" onClick={() => void deleteCategory(item)}><Trash2 size={16} /></IconButton></div></div>)}
        <footer className="management-note"><FolderOpen size={16} />删除分类不会删除信息，原有条目将移至「未分类」。</footer>
      </section>}
    {editor && <MemberModal editor={editor} members={rows} onClose={() => setEditor(null)} onSaved={() => { setEditor(null); void refresh(); }} />}
    {category && <CategoryModal initial={category === 'new' ? undefined : category} onClose={() => setCategory(null)} onSaved={() => { setCategory(null); void client.invalidateQueries({ queryKey: ['categories'] }); void client.invalidateQueries({ queryKey: ['shared'] }); }} />}
  </>;
}

function MemberModal({ editor, members, onClose, onSaved }: { editor: MemberEditor; members: AdminUser[]; onClose: () => void; onSaved: () => void }) {
  const { toast } = useUI();
  const original = editor.kind === 'create' ? null : editor.member;
  const [username, setUsername] = useState(original?.username || '');
  const [displayName, setDisplayName] = useState(original?.displayName || '');
  const [role, setRole] = useState<Role>(original?.role || 'member');
  const [password, setPassword] = useState('');
  const [transferToId, setTransferToId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const titles = { create: '添加团队成员', edit: '编辑成员信息', password: '重置成员密码', deactivate: '停用成员账号' };
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(null);
    try {
      if (editor.kind === 'create') await api('/users', { method: 'POST', body: { username, displayName, role, password } });
      if (editor.kind === 'edit') await api(`/users/${original!.id}`, { method: 'PATCH', body: { displayName, role } });
      if (editor.kind === 'password') await api(`/users/${original!.id}/password`, { method: 'POST', body: { password } });
      if (editor.kind === 'deactivate') await api(`/users/${original!.id}/deactivate`, { method: 'POST', body: transferToId ? { transferToId } : {} });
      toast(editor.kind === 'create' ? '成员账号已创建' : editor.kind === 'password' ? '密码已重置，成员需要重新登录并修改密码' : editor.kind === 'deactivate' ? '账号已停用，未完成任务已按安排转交' : '成员信息已更新'); onSaved();
    } catch (e) { setError(e); } finally { setBusy(false); }
  }
  return <Modal title={titles[editor.kind]} subtitle={original?.displayName} onClose={() => { if (!busy) onClose(); }}>
    <form className="modal-form" onSubmit={submit}><div className="modal-body form-stack">
      {editor.kind === 'create' && <Field label="用户名" required hint="3–32 位字母、数字、点、下划线或短横线。"><input value={username} onChange={e => setUsername(e.target.value)} required pattern="[a-zA-Z0-9_.\-]{3,32}" autoComplete="off" autoFocus /></Field>}
      {(editor.kind === 'create' || editor.kind === 'edit') && <><Field label="显示姓名" required><input value={displayName} onChange={e => setDisplayName(e.target.value)} maxLength={40} required /></Field><Field label="角色"><select value={role} onChange={e => setRole(e.target.value as Role)}><option value="member">成员</option><option value="admin">管理员</option></select></Field></>}
      {(editor.kind === 'create' || editor.kind === 'password') && <Field label="临时密码" required hint="请将临时密码告知成员。成员首次登录后需要设置新密码。"><PasswordInput label="临时密码" value={password} onChange={setPassword} autoComplete="new-password" /></Field>}
      {editor.kind === 'deactivate' && <><div className="deactivate-summary"><UserRoundX size={23} /><p>停用后，该成员将无法继续登录。已完成记录、历史总结和发布的共享信息仍然保留。</p></div>
        <Field label="未完成任务的接收人" required={!!original!.openTaskCount} hint={`当前有 ${original!.openTaskCount} 项未完成任务。若停用时存在未完成任务，必须选择接收人。`}><select value={transferToId} onChange={e => setTransferToId(e.target.value)} required={!!original!.openTaskCount}><option value="">选择一位团队成员</option>{members.filter(m => m.active && m.id !== original!.id).map(m => <option value={m.id} key={m.id}>{m.displayName}</option>)}</select></Field></>}
      <FormError error={error} /></div><footer className="modal-footer"><Button onClick={onClose} disabled={busy}>取消</Button><Button type="submit" loading={busy} variant={editor.kind === 'deactivate' ? 'danger' : 'primary'}>{editor.kind === 'create' ? '创建账号' : editor.kind === 'password' ? '重置密码' : editor.kind === 'deactivate' ? '确认停用' : '保存更改'}</Button></footer>
    </form>
  </Modal>;
}
function CategoryModal({ initial, onClose, onSaved }: { initial?: Category; onClose: () => void; onSaved: () => void }) {
  const { toast } = useUI();
  const [name, setName] = useState(initial?.name || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(null);
    try { await api(`/shared-categories${initial ? `/${initial.id}` : ''}`, { method: initial ? 'PATCH' : 'POST', body: { name } }); toast(initial ? '分类已更新' : '分类已创建'); onSaved(); }
    catch (e) { setError(e); } finally { setBusy(false); }
  }
  return <Modal title={initial ? '编辑分类' : '新建分类'} onClose={() => { if (!busy) onClose(); }}><form className="modal-form" onSubmit={submit}><div className="modal-body form-stack"><Field label="分类名称" required><input value={name} onChange={e => setName(e.target.value)} required maxLength={30} autoFocus placeholder="例如：常用入口" /></Field><FormError error={error} /></div>
    <footer className="modal-footer"><Button onClick={onClose} disabled={busy}>取消</Button><Button type="submit" variant="primary" loading={busy}>{initial ? '保存更改' : '创建分类'}</Button></footer></form></Modal>;
}
