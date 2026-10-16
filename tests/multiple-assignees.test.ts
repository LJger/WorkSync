import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { openDatabase, type Db } from '../server/database.js';
import { createApp } from '../server/app.js';
import { tokenHash } from '../server/security.js';
import { reportText } from '../shared/report-text.js';
import type { Task, User } from '../shared/types.js';

let db: Db, service: Awaited<ReturnType<typeof createApp>>, admin: User, creator: User, one: User, two: User, outsider: User;
let now: Date;
beforeEach(async () => {
  db = openDatabase(':memory:'); now = new Date('2026-10-15T04:00:00Z');
  service = await createApp({ db, clock: () => now, disableRateLimit: true });
  const user = (name: string, role: 'admin' | 'member' = 'member') => service.store.createUser({ username: name, displayName: name, role, passwordHash: 'unused-fixture-hash', mustChangePassword: false });
  admin = user('admin', 'admin'); creator = user('creator'); one = user('one'); two = user('two'); outsider = user('outsider');
});
afterEach(async () => { await service.app.close(); db.close(); });

async function as(user: User, method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown) {
  const token = randomUUID();
  db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)').run(tokenHash(token), user.id, '2028-01-01T00:00:00Z', now.toISOString());
  return service.app.inject({ method, url, payload: payload as Record<string, unknown>, headers: { cookie: `worksync_session=${token}` } });
}
const create = (ids = [one.id, two.id]) => service.store.createTask(creator, { title: '共同任务', description: '所有人共享一套进度', assigneeIds: ids, dueDate: '2026-10-16' });

describe('多人任务与写权限', () => {
  it('成员都能查看，各范围和分页不重复；只有创建者及管理员可以写', async () => {
    let task = create();
    create([one.id]);
    for (const owner of [one, two]) expect((await as(owner, 'GET', `/api/tasks/${task.id}`)).statusCode).toBe(200);
    expect(service.store.tasks(one, { pageSize: 1 }).total).toBe(2);
    expect(service.store.tasks(one, { pageSize: 1, page: 2 }).items).toHaveLength(1);
    expect(service.store.tasks(two).total).toBe(1);
    expect(service.store.tasks(creator, { scope: 'created', assigneeId: two.id }).total).toBe(1);
    expect(service.store.tasks(admin, { scope: 'all' }).total).toBe(2);
    expect(service.store.taskSummary(admin, { scope: 'all' }).total).toBe(2);
    expect((await as(outsider, 'GET', `/api/tasks/${task.id}`)).statusCode).toBe(404);
    for (const user of [one, two]) {
      for (const patch of [{ title: '不允许' }, { status: 'done' }, { assigneeIds: [user.id] }, { dueDate: null }])
        expect((await as(user, 'PATCH', `/api/tasks/${task.id}`, { ...patch, version: task.version })).statusCode).toBe(403);
      expect((await as(user, 'POST', `/api/tasks/${task.id}/archive`, { archived: true, version: task.version })).statusCode).toBe(403);
    }
    task = service.store.updateTask(creator, task.id, { version: task.version, status: 'done' });
    task = service.store.archiveTask(admin, task.id, task.version, true);
    expect((await as(one, 'POST', `/api/tasks/${task.id}/archive`, { archived: false, version: task.version })).statusCode).toBe(403);
    expect(service.store.archiveTask(creator, task.id, task.version, false).archivedAt).toBeNull();
  });

  it('负责人必须非空且有效，重复成员只保存一次', async () => {
    for (const ids of [[], ['missing']]) expect((await as(creator, 'POST', '/api/tasks', { title: '错误分配', assigneeIds: ids })).statusCode).toBe(400);
    service.store.deactivateUser(admin, outsider.id);
    expect((await as(creator, 'POST', '/api/tasks', { title: '停用成员', assigneeIds: [one.id, outsider.id] })).statusCode).toBe(400);
    const response = await as(creator, 'POST', '/api/tasks', { title: '去重', assigneeIds: [one.id, one.id, two.id] });
    expect(response.statusCode).toBe(201);
    const task = response.json().task as Task;
    expect(task.assigneeIds).toHaveLength(2);
    expect(task.assignees.map(person => person.id)).toEqual(task.assigneeIds);
    expect(db.prepare('SELECT * FROM task_assignees WHERE task_id=?').all(task.id)).toHaveLength(2);
    expect((await as(creator, 'PATCH', `/api/tasks/${task.id}`, { version: task.version, assigneeIds: [] })).statusCode).toBe(400);
  });

  it('只通知新增负责人，移除者失去访问权，提醒对每人去重', () => {
    let task = create();
    for (const user of [one, two]) expect(service.store.notifications(user).items.map(item => item.kind)).toEqual(['assigned']);
    expect(service.store.notifications(creator).items).toHaveLength(0);
    task = service.store.updateTask(creator, task.id, { version: task.version, assigneeIds: [two.id, one.id] });
    expect(service.store.notifications(two).items).toHaveLength(1);
    service.store.processReminders(); service.store.processReminders();
    for (const user of [one, two]) expect(service.store.notifications(user).items.filter(item => item.kind === 'due_soon')).toHaveLength(1);
    task = service.store.updateTask(creator, task.id, { version: task.version, assigneeIds: [two.id, outsider.id] });
    expect(() => service.store.task(one, task.id)).toThrow('没有查看权限');
    expect(service.store.notifications(one).items).toHaveLength(0);
    expect(service.store.notifications(two).items.filter(item => item.kind === 'assigned')).toHaveLength(1);
    expect(service.store.notifications(outsider).items.filter(item => item.kind === 'assigned')).toHaveLength(1);
    service.store.archiveTask(creator, task.id, task.version, true);
    expect(service.store.notifications(two).items).toHaveLength(0);
    expect(service.store.notifications(outsider).items).toHaveLength(0);
  });

  it('多人写入失败时整项任务与分配通知回滚', () => {
    db.exec(`CREATE TRIGGER reject_second_owner BEFORE INSERT ON task_assignees
      WHEN EXISTS (SELECT 1 FROM task_assignees WHERE task_id=NEW.task_id)
      BEGIN SELECT RAISE(ABORT, 'owner failure'); END;`);
    expect(() => create()).toThrow('owner failure');
    for (const table of ['tasks', 'task_assignees', 'task_snapshots', 'notifications']) expect(db.prepare(`SELECT * FROM ${table}`).all()).toHaveLength(0);
  });

  it('停用只替换该成员，保留其他负责人；恢复未完成任务必须先调整停用成员', () => {
    const current = create();
    let archived = create(); archived = service.store.archiveTask(creator, archived.id, archived.version, true);
    service.store.deactivateUser(admin, one.id, two.id);
    expect(service.store.task(creator, current.id).assigneeIds).toEqual([two.id]);
    expect(service.store.task(creator, archived.id).assigneeIds).toContain(one.id);
    expect(() => service.store.archiveTask(creator, archived.id, archived.version, false)).toThrow('有效的负责人');
    const restored = service.store.archiveTask(creator, archived.id, archived.version, false, [two.id, outsider.id]);
    expect(restored.assigneeIds).toEqual(expect.arrayContaining([two.id, outsider.id]));
    expect(restored.archivedAt).toBeNull();
    expect(service.store.users(admin).find(user => user.id === two.id)?.openTaskCount).toBe(2);
  });

  it('个人都计入，团队去重，后续调整不改变历史月报', () => {
    let task = create();
    expect(service.store.report(admin, '2026-10', 'team').totals.open).toBe(1);
    task = service.store.updateTask(creator, task.id, { version: task.version, status: 'done' });
    for (const user of [one, two]) expect(service.store.report(user, '2026-10', 'personal').totals.completed).toBe(1);
    const team = service.store.report(admin, '2026-10', 'team');
    expect(team.groups).toHaveLength(2); expect(team.totals.completed).toBe(1);
    expect(reportText(team)).toContain('团队总数按任务去重');
    now = new Date('2026-11-01T04:00:00Z');
    const past = service.store.report(admin, '2026-10', 'team');
    service.store.updateTask(creator, task.id, { version: task.version, assigneeIds: [outsider.id], title: '下月更改', status: 'todo' });
    expect(service.store.report(admin, '2026-10', 'team')).toEqual(past);
    expect(service.store.report(outsider, '2026-11', 'personal').totals.open).toBe(1);
  });
});
