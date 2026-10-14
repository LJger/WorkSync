import type { MonthlyReport, Task } from './types.js';
import { STATUS_LABELS } from './types.js';
import { formatDateTime, localDate } from './dates.js';

export function reportText(report: MonthlyReport): string {
  const [year, month] = report.month.split('-');
  const title = `${year}年${Number(month)}月${report.scope === 'team' ? '团队' : '个人'}工作总结`;
  const end = report.current ? `${formatDateTime(report.asOf)}（上海时间）` : `${localDate(new Date(new Date(report.asOf).getTime() - 1))} 日末`;
  const lines = [title, ...(report.member ? [`成员：${report.member.displayName}`] : []), `统计截至：${end}`,
    `已完成 ${report.totals.completed} 项；未完成 ${report.totals.open} 项，其中逾期 ${report.totals.overdue} 项。`];
  const item = (task: Task, index: number, done: boolean) => {
    const meta = done ? `完成于 ${localDate(task.completedAt!)}` : `${STATUS_LABELS[task.status]}${task.dueDate ? `，截止 ${task.dueDate}` : '，未设截止日期'}${task.overdue ? '，已逾期' : ''}`;
    return [`${index + 1}. ${task.title}（${meta}）`, ...(task.description ? task.description.split('\n').map(line => `   ${line}`) : [])].join('\n');
  };
  if (!report.groups.length) lines.push('', '本月暂无完成事项或未完成事项。');
  for (const group of report.groups) {
    if (report.scope === 'team') lines.push('', `【${group.member.displayName}】`);
    lines.push('', `一、本月完成（${group.completed.length} 项）`, '', ...group.completed.map((task, i) => item(task, i, true)));
    if (!group.completed.length) lines.push('暂无完成事项。');
    lines.push('', `二、未完成事项（${group.open.length} 项）`, '', ...group.open.map((task, i) => item(task, i, false)));
    if (!group.open.length) lines.push('暂无未完成事项。');
  }
  return lines.join('\n');
}
