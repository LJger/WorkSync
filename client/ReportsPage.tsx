import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { CalendarDays, Check, ChevronLeft, ChevronRight, CircleDot, FileText, History, LockKeyhole, TriangleAlert } from 'lucide-react';
import type { AdminUser, MonthlyReport, ReportGroup, Task } from '../shared/types';
import { formatDateTime, localDate } from '../shared/dates';
import { reportText } from '../shared/report-text';
import { api, queryString } from './api';
import { useAuth } from './auth';
import { Avatar, CopyButton, EmptyState, ErrorPanel, IconButton, Loading, PageHeader, StatusBadge, TextLinks } from './ui';

function offsetMonth(month: string, offset: number): string {
  const [year, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(year, m - 1 + offset, 1));
  return d.toISOString().slice(0, 7);
}

export function ReportsPage() {
  const { user } = useAuth();
  const currentMonth = localDate().slice(0, 7);
  const [month, setMonth] = useState(currentMonth);
  const [selection, setSelection] = useState('me');
  const users = useQuery({ queryKey: ['users'], queryFn: () => api<{ items: AdminUser[] }>('/users'), enabled: user!.role === 'admin' });
  const scope = selection === 'team' ? 'team' : 'personal';
  const memberId = selection === 'me' ? user!.id : selection === 'team' ? undefined : selection;
  const report = useQuery({ queryKey: ['reports', month, scope, memberId],
    queryFn: ({ signal }) => api<MonthlyReport>(`/reports/monthly${queryString({ month, scope, memberId })}`, { signal }),
    refetchInterval: month === currentMonth ? 30_000 : false });
  const data = report.data;
  const title = `${Number(month.slice(5))}月的工作记录`;
  const current = month === currentMonth;
  return <>
    <PageHeader title="月度总结" description="回顾做过的事，也看清接下来要推进的事。">
      {data && <CopyButton text={reportText(data)} label="复制总结" title="复制月度总结" />}
    </PageHeader>
    <div className="report-controls"><div className="month-switch"><IconButton label="上一个月" onClick={() => setMonth(offsetMonth(month, -1))} disabled={month <= '1900-01'}><ChevronLeft size={18} /></IconButton>
      <label className="month-input"><CalendarDays size={17} /><input type="month" aria-label="总结月份" value={month} max={currentMonth} min="1900-01" onChange={e => { if (/^(19|20|21)\d{2}-(0[1-9]|1[0-2])$/.test(e.target.value) && e.target.value <= currentMonth) setMonth(e.target.value); }} /></label>
      <IconButton label="下一个月" disabled={current} onClick={() => setMonth(offsetMonth(month, 1))}><ChevronRight size={18} /></IconButton>
    </div><div className="report-scope">{user!.role === 'admin' ? <select aria-label="总结范围" value={selection} onChange={e => setSelection(e.target.value)}><option value="me">我的总结</option><option value="team">团队汇总</option>
      <optgroup label="成员总结">{users.data?.items.filter(u => u.id !== user!.id).map(u => <option key={u.id} value={u.id}>{u.displayName}{u.active ? '' : '（已停用）'}</option>)}</optgroup>
    </select> : <span><Avatar member={user!} small />我的总结</span>}</div></div>
    {report.isPending ? <Loading label="正在整理工作记录…" /> : report.isError ? <ErrorPanel error={report.error} retry={() => void report.refetch()} /> : data && <>
      <section className="report-sheet">
        <header className="report-title"><div><span className="report-period">{month.slice(0, 4)} 年</span><h2>{title}</h2><p>{data.scope === 'team' ? '团队成员的工作汇总' : `${data.member?.displayName || user!.displayName}的个人总结`}</p></div>
          <div className={`report-stamp ${current ? 'stamp-current' : ''}`}>{current ? <History size={16} /> : <LockKeyhole size={16} />}<span>{current ? '持续记录中' : '历史记录'}<small>{current ? '根据任务状态自动整理' : '按当月结束时的情况还原'}</small></span></div>
        </header>
        <div className="report-totals"><div><span className="report-total-icon total-done"><Check size={20} /></span><span><small>本月完成</small><strong>{data.totals.completed}<em>项</em></strong></span></div>
          <div><span className="report-total-icon total-open"><CircleDot size={20} /></span><span><small>尚未完成</small><strong>{data.totals.open}<em>项</em></strong></span></div>
          <div><span className="report-total-icon total-late"><TriangleAlert size={19} /></span><span><small>其中逾期</small><strong>{data.totals.overdue}<em>项</em></strong></span></div></div>
        {!data.groups.length ? <EmptyState title="这个月份还没有工作记录" description={current ? '任务完成后会自动出现在这里，未完成的工作也会一并整理。' : '这个月尚无可回顾的任务记录。'} icon={<FileText size={30} strokeWidth={1.4} />}>
          {current && <Link className="button button-primary" to="/tasks?task=new">创建第一项任务</Link>}
        </EmptyState> : <div className="report-groups">{data.groups.map(group => <MemberReport group={group} key={group.member.id} showName={scope === 'team'} />)}</div>}
        <footer className="report-footnote"><History size={14} /><span>{current ? `统计截至 ${formatDateTime(data.asOf)}，本月记录会随任务更新。` : `统计截至 ${localDate(new Date(new Date(data.asOf).getTime() - 1))} 日末，后续修改不会改变本月记录。`} 事项按统计时点的负责人归属。</span></footer>
      </section>
    </>}
  </>;
}

function MemberReport({ group, showName }: { group: ReportGroup; showName: boolean }) {
  return <section className="member-report">
    {showName && <header className="member-report-header"><Avatar member={group.member} /><h3>{group.member.displayName}</h3><span>完成 {group.completed.length} 项 · 未完成 {group.open.length} 项</span></header>}
    <div className="report-section"><h3><span className="section-mark mark-done" />本月完成<span>{group.completed.length}</span></h3>
      {group.completed.length ? <ul className="report-task-list">{group.completed.map(task => <ReportTask task={task} done key={task.id} />)}</ul> : <p className="report-empty-line">本月暂无已完成事项。</p>}</div>
    <div className="report-section"><h3><span className="section-mark mark-open" />未完成事项<span>{group.open.length}</span></h3>
      {group.open.length ? <ul className="report-task-list">{group.open.map(task => <ReportTask task={task} key={task.id} />)}</ul> : <p className="report-empty-line">没有未完成事项。</p>}</div>
  </section>;
}
function ReportTask({ task, done = false }: { task: Task; done?: boolean }) {
  return <li className={`report-task ${done ? 'report-task-done' : ''}`}><span className="report-task-marker">{done ? <Check size={15} /> : <span />}</span>
    <div className="report-task-content"><h4>{task.title}</h4>{task.description && <p><TextLinks text={task.description} /></p>}</div>
    <div className="report-task-meta">{done ? <span>{localDate(task.completedAt!).slice(5).replace('-', '/')} 完成</span> : <><StatusBadge status={task.status} /><span className={task.overdue ? 'text-danger' : ''}>{task.dueDate ? `${task.dueDate.replaceAll('-', '/')} 截止${task.overdue ? ' · 已逾期' : ''}` : '未设截止日期'}</span></>}</div>
  </li>;
}
