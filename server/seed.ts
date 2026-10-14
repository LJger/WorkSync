import type { Db } from './database.js';
import { Store } from './store.js';
import { hashPassword } from './security.js';
import { addDays, localDate } from '../shared/dates.js';
import type { TaskStatus, User } from '../shared/types.js';

export const DEMO_PASSWORD = 'WorkSync2026!';

export async function seedDevelopment(db: Db, now = new Date()) {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number };
  if (n) throw new Error('数据库已有账号；演示初始化只允许用于空的开发数据库，不会覆盖已有数据。');
  const today = localDate(now);
  let time = new Date(`${addDays(today, -45)}T09:00:00+08:00`);
  const store = new Store(db, () => time);
  const hash = await hashPassword(DEMO_PASSWORD);
  const admin = store.createUser({ username: 'admin', displayName: '团队管理员', role: 'admin', passwordHash: hash, mustChangePassword: false });
  const lin = store.createUser({ username: 'lin', displayName: '林小满', role: 'member', passwordHash: hash, mustChangePassword: false });
  const chen = store.createUser({ username: 'chen', displayName: '陈一然', role: 'member', passwordHash: hash, mustChangePassword: false });
  const zhou = store.createUser({ username: 'zhou', displayName: '周予安', role: 'member', passwordHash: hash, mustChangePassword: false });
  const create = (title: string, assignee: User, creator: User, due: number | null, status: TaskStatus, description: string, offset = -3) => {
    time = new Date(`${addDays(today, offset - 2)}T09:20:00+08:00`);
    let task = store.createTask(creator, { title, description, assigneeId: assignee.id, dueDate: due === null ? null : addDays(today, due) });
    if (status !== 'todo') {
      time = new Date(`${addDays(today, offset)}T10:40:00+08:00`);
      task = store.updateTask(assignee, task.id, { version: task.version, status });
    }
    return task;
  };
  create('整理客户反馈，确认本周跟进事项', lin, admin, -2, 'in_progress', '汇总近期收到的反馈，整理问题、影响范围和建议处理方式。\n完成后把结论补充到任务说明。');
  create('完成本月交付清单初稿', lin, admin, 0, 'in_progress', '核对已完成事项与待交付内容，方便团队确认本月安排。');
  create('确认周会讨论议题', lin, lin, 0, 'todo', '收集团队需要协调的问题，优先讨论卡住的任务。');
  create('更新新成员常用信息', lin, lin, 1, 'todo', '检查团队共享区中的常用入口与联系说明，确认信息仍然有效。');
  create('梳理下周需要提前准备的事项', lin, admin, 3, 'todo', '把需要协作的工作提前列出来，并明确接收人。');
  create('整理本月工作回顾', lin, lin, 7, 'todo', '在月度总结中查看完成清单，补充仍需推进的工作。');
  create('收集团队对工作流程的建议', lin, admin, null, 'todo', '先记录大家日常遇到的小问题，再一起选择最值得改进的一项。');
  create('核对上周遗留事项', lin, admin, -4, 'done', '已确认遗留事项的处理结果，并把后续工作拆成独立任务。', -4);
  create('完成共享信息首轮整理', lin, lin, -6, 'done', '将常用文字信息按分类整理，重要事项已置顶。', -6);
  create('同步本周任务分工', lin, admin, -8, 'done', '本周任务已明确到人，截止日期已确认。', -7);
  create('准备客户沟通要点', chen, lin, 1, 'in_progress', '围绕当前进度、待确认事项与下一步安排准备简短提纲。');
  create('核对交付资料的完整性', chen, admin, 4, 'todo', '对照交付清单检查资料，缺失内容单独标记。');
  create('整理近期答疑记录', chen, chen, -2, 'done', '常见问题已整理为团队可复用的文字说明。', -2);
  create('更新团队值班安排', zhou, lin, 2, 'todo', '与相关成员确认安排，再更新到团队共享。');
  create('确认本周资源使用情况', zhou, admin, -1, 'in_progress', '检查是否有冲突，提前协调需要共用的资源。');
  create('汇总团队本周重点事项', admin, admin, 0, 'in_progress', '查看团队任务，重点跟进逾期及需要协调的工作。');
  create('检查团队公用信息是否过期', admin, admin, 2, 'todo', '按分类查看共享条目，更新过期说明。');
  create('完成上月事项归档', admin, admin, -8, 'done', '保留历史记录，将已结束的事项收起。', -7);
  time = new Date(`${addDays(today, -4)}T14:00:00+08:00`);
  const routine = store.saveCategory(admin, '团队约定');
  const contacts = store.saveCategory(admin, '常用入口');
  const reference = store.saveCategory(admin, '参考信息');
  const meeting = store.createShared(admin, { title: '每周例会安排', content: '时间：每周二 14:30–15:00\n讨论内容：本周重点、需要协调的问题、接下来的安排。\n\n需要团队一起讨论的事项，请提前整理成简短要点。', categoryId: routine.id });
  store.pinShared(admin, meeting.id, true, meeting.version);
  time = new Date(`${addDays(today, -2)}T15:30:00+08:00`);
  store.createShared(lin, { title: '任务更新的小约定', content: '开始处理时，切换为「进行中」。\n做完后及时标记「已完成」，月底就能直接回顾。\n如果截止时间需要调整，先与创建者沟通，再更新日期。\n不再需要继续的任务可以归档，历史记录仍会保留。', categoryId: routine.id });
  store.createShared(chen, { title: '常用资源入口（演示）', content: '以下为本地演示链接，可替换成团队实际使用的入口。\n\n需求记录：https://example.com/requests\n团队资料：https://example.com/resources', categoryId: contacts.id });
  store.createShared(zhou, { title: '月度回顾使用说明', content: '进入「月度总结」，选择需要回顾的月份。\n可以查看本月完成事项和月末仍未完成的任务，然后一键复制。\n\n历史月份按当时的负责人和状态记录，不会随之后的修改而改变。', categoryId: reference.id });
  time = now;
  store.processReminders();
  db.prepare("INSERT INTO app_settings(key,value) VALUES('demo_data','true')").run();
  return { admin, lin, chen, zhou };
}
