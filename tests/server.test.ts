import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { createApp } from '../server/app.js';
import { openDatabase, SCHEMA_VERSION, type Db } from '../server/database.js';
import { Store } from '../server/store.js';
import { hashPassword, tokenHash } from '../server/security.js';
import { backupDatabase, createJobs } from '../server/jobs.js';
import { restoreDatabase } from '../server/maintenance.js';
import { localDate, monthBounds, validDate } from '../shared/dates.js';
import { reportText } from '../shared/report-text.js';
import type { MonthlyReport, Task, User } from '../shared/types.js';

let directory: string, filename: string, db: Db, store: Store;
let app: Awaited<ReturnType<typeof createApp>>['app'];
let clock: Date;
let admin: User, alice: User, bob: User, carol: User;
let hash: string;
const password = 'A-team-password-2026!';
beforeAll(async () => { hash = await hashPassword(password); });
beforeEach(async () => {
  directory = await mkdtemp(resolve(tmpdir(), 'worksync-test-'));
  filename = resolve(directory, 'worksync.sqlite');
  db = openDatabase(filename);
  clock = new Date('2026-10-15T04:00:00.000Z');
  ({ app, store } = await createApp({ db, clock: () => clock, disableRateLimit: true, publicDir: resolve(directory, 'no-public') }));
  const create = (username: string, displayName: string, role: 'admin' | 'member' = 'member') => store.createUser({ username, displayName, role, passwordHash: hash, mustChangePassword: false });
  admin = create('admin', '管理员', 'admin'); alice = create('alice', '甲'); bob = create('bob', '乙'); carol = create('carol', '丙');
});
afterEach(async () => { await app.close(); if (db.open) db.close(); await rm(directory, { recursive: true, force: true }); });

async function as(user: User, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown) {
  // 业务测试注入有期限的服务端会话；登录、轮换、过期在独立测试中经过真实登录接口。
  const token = randomUUID();
  db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)')
    .run(tokenHash(token), user.id, new Date(clock.getTime() + 7 * 86400000).toISOString(), clock.toISOString());
  return app.inject({ method, url, payload: payload as Record<string, unknown>, headers: { cookie: `worksync_session=${token}` } });
}
async function login(username = 'alice', value = password) {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password: value } });
  const raw = res.headers['set-cookie'];
  return { res, cookie: (Array.isArray(raw) ? raw[0] : raw || '').split(';')[0] };
}
function createTask(assignee = alice, creator = alice, extra: Partial<{ title: string; description: string; dueDate: string | null }> = {}) {
  return store.createTask(creator, { title: '需要完成的工作', description: '保留这段说明', assigneeIds: [assignee.id], dueDate: '2026-10-16', ...extra });
}
function change(user: User, task: Task, patch: Parameters<Store['updateTask']>[2]) { return store.updateTask(user, task.id, patch); }

const legacyNoticeColumns = 'id, recipient_id, task_id, kind, message, due_date, dedupe_key, created_at, read_at, dismissed_at';
// Build actual legacy task columns and payloads, rather than only lowering user_version.
function makeVersionTwoFixture(database: Db) {
  database.pragma('foreign_keys = OFF');
  try {
    database.transaction(() => {
      database.exec(`CREATE TABLE tasks_v2 (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
        creator_id TEXT NOT NULL REFERENCES users(id), assignee_id TEXT NOT NULL REFERENCES users(id),
        status TEXT NOT NULL DEFAULT 'todo' CHECK(status IN ('todo','in_progress','done')),
        due_date TEXT, completed_at TEXT, archived_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1);
        INSERT INTO tasks_v2 SELECT t.id,t.title,t.description,t.creator_id,a.user_id,t.status,t.due_date,
          t.completed_at,t.archived_at,t.created_at,t.updated_at,t.version FROM tasks t JOIN task_assignees a ON a.task_id=t.id;
        DROP TABLE task_assignees;
        DROP TABLE tasks;
        ALTER TABLE tasks_v2 RENAME TO tasks;
        CREATE INDEX tasks_assignee ON tasks(assignee_id,archived_at,status,due_date);
        CREATE INDEX tasks_creator ON tasks(creator_id,archived_at);
        PRAGMA user_version = 2;`);
      const update = database.prepare('UPDATE task_snapshots SET payload=? WHERE task_id=? AND version=?');
      for (const row of database.prepare('SELECT task_id,version,payload FROM task_snapshots').all() as { task_id: string; version: number; payload: string }[]) {
        const { assigneeIds, assignees, ...task } = JSON.parse(row.payload) as Task;
        update.run(JSON.stringify({ ...task, assigneeId: assigneeIds[0], assignee: assignees[0] }), row.task_id, row.version);
      }
    })();
  } finally { database.pragma('foreign_keys = ON'); }
}

function makeVersionOneFixture(database: Db) {
  makeVersionTwoFixture(database);
  database.transaction(() => {
    database.exec(`
      CREATE TABLE notifications_v1 (
        id TEXT PRIMARY KEY,
        recipient_id TEXT NOT NULL REFERENCES users(id),
        task_id TEXT NOT NULL REFERENCES tasks(id),
        kind TEXT NOT NULL CHECK (kind IN ('assigned', 'due_soon', 'overdue')),
        message TEXT NOT NULL,
        due_date TEXT,
        dedupe_key TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        read_at TEXT,
        dismissed_at TEXT
      );
      INSERT INTO notifications_v1 (${legacyNoticeColumns})
        SELECT ${legacyNoticeColumns} FROM notifications WHERE task_id IS NOT NULL;
      DROP TABLE notifications;
      ALTER TABLE notifications_v1 RENAME TO notifications;
      CREATE INDEX notifications_recipient ON notifications(recipient_id, dismissed_at, created_at);
      PRAGMA user_version = 1;
    `);
  })();
}

describe('身份、会话与权限', () => {
  it('生产服务提供首页与单页路由，同时保留 API 和资源的正确响应', async () => {
    const publicDir = resolve(directory, 'public');
    await mkdir(publicDir);
    await writeFile(resolve(publicDir, 'index.html'), '<!doctype html><html lang="zh-CN"><title>WorkSync</title><body>WorkSync app</body></html>');
    const production = await createApp({ db, production: true, publicDir });
    try {
      for (const url of ['/', '/tasks', '/reports', '/shared']) {
        const response = await production.app.inject({ url });
        expect(response.statusCode).toBe(200);
        expect(response.headers['content-type']).toContain('text/html');
        expect(response.payload).toContain('WorkSync app');
      }
      expect((await production.app.inject({ url: '/assets/missing.js' })).statusCode).toBe(404);
      expect((await production.app.inject({ url: '/api/health' })).json()).toEqual({ ok: true });
    } finally { await production.app.close(); }
  });
  it('未登录不能读取私有或共享信息，登录不返回密码哈希', async () => {
    for (const url of ['/api/tasks', '/api/shared-info', '/api/users', '/api/reports/monthly?month=2026-10']) expect((await app.inject({ url })).statusCode).toBe(401);
    expect((await login('unknown', password)).res.statusCode).toBe(401);
    const { res, cookie } = await login();
    expect(res.statusCode).toBe(200);
    expect(res.payload).not.toContain('password_hash');
    expect(String(res.headers['set-cookie'])).toContain('HttpOnly');
    expect(String(res.headers['set-cookie'])).toContain('SameSite=Lax');
    expect((await app.inject({ url: '/api/auth/me', headers: { cookie } })).json().user.id).toBe(alice.id);
    const badOrigin = await app.inject({ method: 'POST', url: '/api/tasks', headers: { cookie, origin: 'https://untrusted.example' }, payload: { title: '跨站请求', assigneeIds: [alice.id] } });
    expect(badOrigin.statusCode).toBe(403);
  });
  it('会话到期或退出后不能继续使用', async () => {
    const session = await login();
    clock = new Date(clock.getTime() + 7 * 86400000);
    expect((await app.inject({ url: '/api/auth/me', headers: { cookie: session.cookie } })).statusCode).toBe(401);
    const next = await login();
    expect((await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie: next.cookie }, payload: {} })).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/tasks', headers: { cookie: next.cookie } })).statusCode).toBe(401);
  });
  it('新成员及重置密码后必须改密码，修改会轮换所有旧会话', async () => {
    const created = await as(admin, 'POST', '/api/users', { username: 'newmember', displayName: '新成员', password, role: 'member' });
    expect(created.statusCode).toBe(201);
    const id = created.json().user.id;
    const first = await login('newmember');
    expect((await app.inject({ url: '/api/tasks', headers: { cookie: first.cookie } })).json().code).toBe('PASSWORD_CHANGE_REQUIRED');
    const changed = await app.inject({ method: 'POST', url: '/api/auth/password', headers: { cookie: first.cookie }, payload: { oldPassword: password, newPassword: 'Updated-password-2026!' } });
    expect(changed.statusCode).toBe(200);
    expect(changed.json().user.mustChangePassword).toBe(false);
    expect((await app.inject({ url: '/api/auth/me', headers: { cookie: first.cookie } })).statusCode).toBe(401);
    const session = await login('newmember', 'Updated-password-2026!');
    expect((await app.inject({ url: '/api/tasks', headers: { cookie: session.cookie } })).statusCode).toBe(200);
    expect((await as(admin, 'POST', `/api/users/${id}/password`, { password: 'Reset-password-2026!' })).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/tasks', headers: { cookie: session.cookie } })).statusCode).toBe(401);
    expect((await login('newmember', 'Updated-password-2026!')).res.statusCode).toBe(401);
    expect((await login('newmember', 'Reset-password-2026!')).res.json().user.mustChangePassword).toBe(true);
    expect((await as(alice, 'POST', '/api/users', { username: 'forbidden', displayName: '越权', password })).statusCode).toBe(403);
  });
});

describe('任务分配、隔离与并发', () => {
  it('创建者可编辑，负责人只能更新状态，无关成员不能读取、修改或聚合查询', async () => {
    const created = await as(alice, 'POST', '/api/tasks', { title: '私有协作任务', description: '说明不会消失', assigneeIds: [bob.id], dueDate: '2026-10-16' });
    expect(created.statusCode).toBe(201);
    const task = created.json().task as Task;
    expect((await as(alice, 'GET', `/api/tasks/${task.id}`)).statusCode).toBe(200);
    expect((await as(bob, 'GET', `/api/tasks/${task.id}`)).statusCode).toBe(200);
    expect((await as(carol, 'GET', `/api/tasks/${task.id}`)).statusCode).toBe(404);
    expect((await as(carol, 'PATCH', `/api/tasks/${task.id}`, { version: 1, title: '越权' })).statusCode).toBe(404);
    expect((await as(alice, 'GET', '/api/tasks?scope=assigned')).json().total).toBe(0);
    expect((await as(alice, 'GET', '/api/tasks?scope=created')).json().total).toBe(1);
    expect((await as(bob, 'GET', '/api/tasks')).json().total).toBe(1);
    expect((await as(carol, 'GET', '/api/tasks?scope=all')).statusCode).toBe(403);
    expect((await as(carol, 'GET', '/api/tasks/summary?scope=all')).statusCode).toBe(403);
    expect((await as(admin, 'GET', '/api/tasks?scope=all')).json().total).toBe(1);
    expect((await as(bob, 'PATCH', `/api/tasks/${task.id}`, { version: 1, title: '越权' })).statusCode).toBe(403);
    expect((await as(bob, 'PATCH', `/api/tasks/${task.id}`, { version: 1, status: 'in_progress', dueDate: null })).statusCode).toBe(403);
    expect((await as(bob, 'POST', `/api/tasks/${task.id}/archive`, { version: 1, archived: true })).statusCode).toBe(403);
    const changed = await as(bob, 'PATCH', `/api/tasks/${task.id}`, { version: 1, status: 'in_progress' });
    expect(changed.statusCode).toBe(200);
    expect(changed.json().task.description).toBe('说明不会消失');
    expect(changed.json().task.dueDate).toBe('2026-10-16');
    expect(changed.json().task.creatorId).toBe(alice.id);
    const stale = await as(alice, 'PATCH', `/api/tasks/${task.id}`, { version: 1, title: '旧版本' });
    expect(stale.statusCode).toBe(409);
    expect(store.task(admin, task.id).title).toBe('私有协作任务');
    expect((db.prepare('SELECT COUNT(*) AS n FROM task_snapshots WHERE task_id=?').get(task.id) as { n: number }).n).toBe(2);
  });
  it('转交后原负责人失去访问权，其通知不泄露后续信息', async () => {
    const task = createTask(bob, alice);
    expect(store.notifications(bob).unread).toBe(1);
    const moved = await as(alice, 'PATCH', `/api/tasks/${task.id}`, { assigneeIds: [carol.id], version: 1 });
    expect(moved.statusCode).toBe(200);
    expect((await as(bob, 'GET', `/api/tasks/${task.id}`)).statusCode).toBe(404);
    expect(store.notifications(bob).items).toHaveLength(0);
    expect(store.notifications(carol).items).toHaveLength(1);
    expect((await as(alice, 'GET', `/api/tasks/${task.id}`)).statusCode).toBe(200);
    expect((await as(bob, 'GET', `/api/reports/monthly?month=2026-10&memberId=${carol.id}`)).statusCode).toBe(403);
    expect((await as(bob, 'GET', '/api/reports/monthly?month=2026-10&scope=team')).statusCode).toBe(403);
  });
  it('归档隐藏待办、停止提醒，并允许恢复；完成归档保留月报', async () => {
    let task = createTask(alice, alice, { dueDate: '2026-10-14' });
    store.processReminders();
    task = store.archiveTask(alice, task.id, task.version, true);
    expect(store.tasks(alice).total).toBe(0);
    expect(store.tasks(alice, { archived: true }).total).toBe(1);
    expect(store.notifications(alice).items).toHaveLength(0);
    expect(store.report(alice, '2026-10', 'personal').totals.open).toBe(0);
    expect((await as(alice, 'PATCH', `/api/tasks/${task.id}`, { version: task.version, title: '不可编辑' })).statusCode).toBe(400);
    task = store.archiveTask(alice, task.id, task.version, false);
    expect(store.tasks(alice).total).toBe(1);
    task = change(alice, task, { version: task.version, status: 'done' });
    store.archiveTask(alice, task.id, task.version, true);
    expect(store.report(alice, '2026-10', 'personal').totals.completed).toBe(1);
  });
  it('接口拒绝无效日期、历史完成时间、非法状态和停用负责人', async () => {
    for (const dueDate of ['2026-02-30', '2026-13-01', 'not-a-date']) {
      expect((await as(alice, 'POST', '/api/tasks', { title: '日期测试', assigneeIds: [alice.id], dueDate })).statusCode).toBe(400);
    }
    const task = createTask();
    expect((await as(alice, 'PATCH', `/api/tasks/${task.id}`, { version: 1, completedAt: '2025-01-01' })).statusCode).toBe(400);
    expect((await as(alice, 'PATCH', `/api/tasks/${task.id}`, { version: 1, status: 'approved' })).statusCode).toBe(400);
    store.deactivateUser(admin, bob.id);
    expect((await as(alice, 'POST', '/api/tasks', { title: '已停用成员', assigneeIds: [bob.id] })).statusCode).toBe(400);
    expect((await as(alice, 'GET', '/api/tasks?q=%25')).json().total).toBe(0);
  });
});

describe('指定截止日期筛选', () => {
  it('单日、跨月区间、分页和统计使用相同边界，并保留任务可见范围', async () => {
    createTask(alice, alice, { dueDate: '2026-10-30' });
    const first = createTask(alice, alice, { title: '范围开始', dueDate: '2026-10-31' });
    change(alice, first, { version: first.version, status: 'in_progress' });
    const last = createTask(alice, alice, { title: '范围结束', dueDate: '2026-11-01' });
    change(alice, last, { version: last.version, status: 'done' });
    createTask(alice, alice, { dueDate: '2026-11-02' });
    createTask(alice, alice, { dueDate: null });
    const archived = createTask(alice, alice, { dueDate: '2026-10-31' });
    store.archiveTask(alice, archived.id, archived.version, true);
    createTask(bob, bob, { title: '其他成员的私有任务', dueDate: '2026-10-31' });
    createTask(bob, alice, { title: '交给同事的任务', dueDate: '2026-10-31' });
    const range = 'dueFrom=2026-10-31&dueTo=2026-11-01';
    const page1 = (await as(alice, 'GET', `/api/tasks?${range}&pageSize=1`)).json();
    const page2 = (await as(alice, 'GET', `/api/tasks?${range}&pageSize=1&page=2`)).json();
    expect(page1.total).toBe(2); expect(page2.total).toBe(2);
    expect([page1.items[0].id, page2.items[0].id]).toEqual([first.id, last.id]);
    const summary = (await as(alice, 'GET', `/api/tasks/summary?${range}&status=done`)).json();
    expect(summary).toMatchObject({ total: 2, inProgress: 1, done: 1, todo: 0 });
    expect((await as(alice, 'GET', `/api/tasks?${range}&status=done`)).json().items.map((item: Task) => item.id)).toEqual([last.id]);
    expect((await as(alice, 'GET', '/api/tasks?dueFrom=2026-10-31&dueTo=2026-10-31')).json().items.map((item: Task) => item.id)).toEqual([first.id]);
    expect((await as(alice, 'GET', `/api/tasks?${range}&archived=true`)).json().items[0].id).toBe(archived.id);
    expect((await as(alice, 'GET', `/api/tasks?${range}&scope=created`)).json().total).toBe(3);
    expect((await as(alice, 'GET', `/api/tasks?${range}&scope=all`)).statusCode).toBe(403);
    expect((await as(admin, 'GET', `/api/tasks?${range}&scope=all`)).json().total).toBe(4);
    clock = new Date('2026-10-30T16:00:00.000Z');
    expect((await as(alice, 'GET', '/api/tasks?due=today')).json().items[0].id).toBe(first.id);
  });

  it('列表和概览都拒绝不完整、无效、反向或混用预设的范围', async () => {
    for (const endpoint of ['/api/tasks', '/api/tasks/summary']) {
      for (const query of [
        'dueFrom=2026-10-15', 'dueTo=2026-10-15', 'dueFrom=&dueTo=',
        'dueFrom=2026-02-30&dueTo=2026-03-01',
        'dueFrom=2026-10-16&dueTo=2026-10-15',
        'dueFrom=2026-10-15T10:00&dueTo=2026-10-16',
        'due=today&dueFrom=2026-10-15&dueTo=2026-10-16',
        'due=none&dueFrom=2026-10-15&dueTo=2026-10-16',
      ]) {
        const response = await as(alice, 'GET', `${endpoint}?${query}`);
        expect(response.statusCode, `${endpoint}?${query}`).toBe(400);
        expect(response.json().code).toBe('VALIDATION_ERROR');
      }
      expect((await as(alice, 'GET', `${endpoint}?dueFrom=2024-02-29&dueTo=2024-02-29`)).statusCode).toBe(200);
    }
  });
});

describe('月度总结', () => {
  it('完成事项按月末负责人归属，次月改名和转交不会改变上月结果', async () => {
    let task = createTask(alice, alice, { title: '十月完成事项' });
    clock = new Date('2026-10-30T02:00:00Z');
    task = change(alice, task, { status: 'done', version: task.version });
    clock = new Date('2026-10-31T15:59:58Z');
    task = change(alice, task, { assigneeIds: [bob.id], version: task.version });
    clock = new Date('2026-11-01T03:00:00Z');
    const before = store.report(bob, '2026-10', 'personal');
    expect(before.totals.completed).toBe(1);
    expect(before.groups[0].completed[0].assigneeIds[0]).toBe(bob.id);
    expect(store.report(alice, '2026-10', 'personal').totals.completed).toBe(0);
    task = change(admin, task, { title: '十一月的新标题', assigneeIds: [carol.id], status: 'in_progress', version: task.version });
    expect(store.report(bob, '2026-10', 'personal')).toEqual(before);
    expect((await as(bob, 'GET', `/api/tasks/${task.id}`)).statusCode).toBe(404);
    const apiReport = await as(bob, 'GET', '/api/reports/monthly?month=2026-10');
    expect(apiReport.statusCode).toBe(200);
    expect(apiReport.json().groups[0].completed[0].title).toBe('十月完成事项');
    expect(reportText(before)).toContain('十月完成事项');
    expect(reportText(before)).not.toContain('十一月的新标题');
  });
  it('跨月未完成事项会继续列入，截止日按上海日期判断', () => {
    clock = new Date('2026-09-05T03:00:00Z');
    let task = createTask(alice, alice, { dueDate: '2026-09-30' });
    clock = new Date('2026-10-05T03:00:00Z');
    const september = store.report(alice, '2026-09', 'personal');
    expect(september.totals).toEqual({ completed: 0, open: 1, overdue: 1 });
    expect(store.report(alice, '2026-10', 'personal').totals.open).toBe(1);
    task = change(alice, task, { version: task.version, status: 'done' });
    expect(store.report(alice, '2026-09', 'personal')).toEqual(september);
    expect(store.report(alice, '2026-10', 'personal').totals.completed).toBe(1);
  });
  it('恰好在月界完成的任务计入下个月，支持跨年和闰月', () => {
    let task = createTask();
    clock = new Date('2026-10-31T16:00:00.000Z');
    task = change(alice, task, { version: task.version, status: 'done' });
    expect(store.report(alice, '2026-10', 'personal').totals).toEqual({ completed: 0, open: 1, overdue: 1 });
    expect(store.report(alice, '2026-11', 'personal').totals.completed).toBe(1);
    expect(localDate(clock)).toBe('2026-11-01');
    expect(monthBounds('2026-12').end).toBe('2026-12-31T16:00:00.000Z');
    expect(monthBounds('2028-02').end).toBe('2028-02-29T16:00:00.000Z');
    expect(validDate('2028-02-29')).toBe(true);
    expect(validDate('2026-02-29')).toBe(false);
  });
  it('反复完成和重新打开按统计时状态计算，不重复计数', () => {
    let task = createTask();
    task = change(alice, task, { version: task.version, status: 'done' });
    task = change(alice, task, { version: task.version, status: 'in_progress' });
    expect(store.report(alice, '2026-10', 'personal').totals).toEqual({ completed: 0, open: 1, overdue: 0 });
    clock = new Date('2026-10-16T03:00:00Z');
    task = change(alice, task, { version: task.version, status: 'done' });
    const firstCompletedAt = task.completedAt;
    clock = new Date('2026-10-17T03:00:00Z');
    task = change(alice, task, { version: task.version, title: '修正标题', status: 'done' });
    expect(task.completedAt).toBe(firstCompletedAt);
    expect(store.report(alice, '2026-10', 'personal').totals.completed).toBe(1);
    expect(() => store.report(alice, '2026-11', 'personal')).toThrow('请选择当前月份或过去月份');
  });
});

describe('站内提醒', () => {
  it('只在到期前一天及逾期时各提醒一次，服务重建后不重复', () => {
    let task = createTask(bob, alice);
    store.processReminders(); store.processReminders();
    expect(store.notifications(bob).items.map(n => n.kind).sort()).toEqual(['assigned', 'due_soon']);
    clock = new Date('2026-10-16T15:59:59Z');
    store.processReminders();
    expect(store.notifications(bob).items.filter(n => n.kind === 'overdue')).toHaveLength(0);
    clock = new Date('2026-10-16T16:00:00Z');
    store.processReminders();
    new Store(db, () => clock).processReminders();
    expect(store.notifications(bob).items.filter(n => n.kind === 'overdue')).toHaveLength(1);
    task = change(alice, task, { version: task.version, status: 'done' });
    expect(store.notifications(bob).items.filter(n => n.kind !== 'assigned')).toHaveLength(0);
  });
  it('改期和转交清理旧提醒，已完成、归档、无日期的任务不误提醒', () => {
    let task = createTask(bob, alice, { dueDate: '2026-10-14' });
    store.processReminders();
    task = change(alice, task, { version: task.version, dueDate: '2026-10-20' });
    expect(store.notifications(bob).items.filter(n => n.kind === 'overdue')).toHaveLength(0);
    clock = new Date('2026-10-19T01:00:00Z');
    store.processReminders();
    expect(store.notifications(bob).items.filter(n => n.kind === 'due_soon')).toHaveLength(1);
    task = change(alice, task, { version: task.version, assigneeIds: [carol.id] });
    store.processReminders();
    expect(store.notifications(bob).items).toHaveLength(0);
    expect(store.notifications(carol).items.map(n => n.kind).sort()).toEqual(['assigned', 'due_soon']);
    createTask(alice, alice, { dueDate: null });
    let done = createTask(alice, alice, { dueDate: '2026-10-01' });
    done = change(alice, done, { version: done.version, status: 'done' });
    const archived = createTask(alice, alice, { dueDate: '2026-10-01' });
    store.archiveTask(alice, archived.id, archived.version, true);
    store.processReminders();
    expect(store.notifications(alice).items).toHaveLength(0);
  });
});

describe('成员管理', () => {
  it('停用在事务内转交所有未完成任务，已完成与归档保留原归属', async () => {
    const open = createTask(alice, bob);
    let done = createTask(alice, bob);
    done = change(bob, done, { version: done.version, status: 'done' });
    let archived = createTask(alice, bob);
    archived = store.archiveTask(bob, archived.id, archived.version, true);
    const session = await login();
    expect((await as(admin, 'POST', `/api/users/${alice.id}/deactivate`, {})).statusCode).toBe(400);
    expect(store.user(alice.id).active).toBe(true);
    expect(store.task(admin, open.id).assigneeIds[0]).toBe(alice.id);
    expect((await as(admin, 'POST', `/api/users/${alice.id}/deactivate`, { transferToId: carol.id })).statusCode).toBe(200);
    expect(store.task(admin, open.id).assigneeIds[0]).toBe(carol.id);
    expect(store.task(admin, done.id).assigneeIds[0]).toBe(alice.id);
    expect(store.task(admin, archived.id).assigneeIds[0]).toBe(alice.id);
    expect((await app.inject({ url: '/api/auth/me', headers: { cookie: session.cookie } })).statusCode).toBe(401);
    expect(store.report(admin, '2026-10', 'personal', alice.id).totals.completed).toBe(1);
    expect((await as(admin, 'PATCH', `/api/users/${alice.id}`, { active: true })).statusCode).toBe(200);
    expect((await login()).res.statusCode).toBe(200);
  });
  it('不能停用或降级最后一位管理员', async () => {
    expect((await as(admin, 'POST', `/api/users/${admin.id}/deactivate`, {})).json().code).toBe('LAST_ADMIN');
    expect((await as(admin, 'PATCH', `/api/users/${admin.id}`, { role: 'member' })).json().code).toBe('LAST_ADMIN');
    expect(store.user(admin.id).role).toBe('admin');
    expect(store.user(admin.id).active).toBe(true);
  });
  it('恢复停用成员的未完成归档任务时，必须明确选择有效接收人', async () => {
    let task = createTask(alice, bob);
    task = store.archiveTask(bob, task.id, task.version, true);
    store.deactivateUser(admin, alice.id);
    expect((await as(bob, 'POST', `/api/tasks/${task.id}/archive`, { version: task.version, archived: false })).statusCode).toBe(400);
    const restored = await as(bob, 'POST', `/api/tasks/${task.id}/archive`, { version: task.version, archived: false, assigneeIds: [carol.id] });
    expect(restored.statusCode).toBe(200);
    expect(restored.json().task.assigneeIds[0]).toBe(carol.id);
    expect(restored.json().task.archivedAt).toBeNull();
    expect(store.notifications(carol).items[0].kind).toBe('assigned');
  });
});

describe('共享信息与分类', () => {
  it('共享内容全员可读，只有作者与管理员可改，只有管理员可置顶', async () => {
    const created = await as(alice, 'POST', '/api/shared-info', { title: '团队约定', content: '全部成员可见的关键词', categoryId: null });
    expect(created.statusCode).toBe(201);
    let info = created.json().info;
    expect((await as(carol, 'GET', '/api/shared-info?q=关键词')).json().total).toBe(1);
    expect((await as(bob, 'PATCH', `/api/shared-info/${info.id}`, { title: '越权', content: '越权', categoryId: null, version: info.version })).statusCode).toBe(403);
    expect((await as(bob, 'DELETE', `/api/shared-info/${info.id}`, { version: info.version })).statusCode).toBe(403);
    expect((await as(alice, 'POST', `/api/shared-info/${info.id}/pin`, { pinned: true, version: info.version })).statusCode).toBe(403);
    const pinned = await as(admin, 'POST', `/api/shared-info/${info.id}/pin`, { pinned: true, version: info.version });
    expect(pinned.json().info.pinned).toBe(true);
    expect((await as(alice, 'PATCH', `/api/shared-info/${info.id}`, { title: '旧版本', content: '不能覆盖', categoryId: null, version: info.version })).statusCode).toBe(409);
    info = pinned.json().info;
    expect((await as(alice, 'PATCH', `/api/shared-info/${info.id}`, { title: '更新后的约定', content: '新的内容', categoryId: null, version: info.version })).statusCode).toBe(200);
    expect(store.notifications(bob).items).toHaveLength(1);
    expect(store.notifications(bob).items[0]).toMatchObject({ kind: 'shared_published', sharedInfoId: info.id, taskId: null });
  });
  it('分类由管理员维护，删除后信息进入未分类且版本更新', async () => {
    expect((await as(alice, 'POST', '/api/shared-categories', { name: '禁止创建' })).statusCode).toBe(403);
    const category = store.saveCategory(admin, '团队约定');
    const info = store.createShared(alice, { title: '保留正文', content: '<script>alert(1)</script>\nhttps://example.com', categoryId: category.id });
    expect(store.categories()[0].count).toBe(1);
    expect((await as(admin, 'POST', '/api/shared-categories', { name: '团队约定' })).statusCode).toBe(409);
    expect((await as(admin, 'DELETE', `/api/shared-categories/${category.id}`)).statusCode).toBe(200);
    const fresh = store.sharedInfo(info.id);
    expect(fresh.categoryId).toBeNull(); expect(fresh.content).toBe(info.content); expect(fresh.version).toBe(2);
    expect(store.sharedList({ categoryId: 'uncategorized' }).total).toBe(1);
    expect(store.sharedList({ q: '%' }).total).toBe(0);
  });
});

describe('共享信息提醒', () => {
  it('发布后通知其他有效成员，并隔离接收人和已读状态', async () => {
    store.deactivateUser(admin, carol.id);
    const response = await as(alice, 'POST', '/api/shared-info', { title: '新的团队约定', content: '请大家查看。', categoryId: null });
    expect(response.statusCode).toBe(201);
    const info = response.json().info;
    expect(store.notifications(alice).items).toHaveLength(0);
    expect(store.notifications(carol).items).toHaveLength(0);
    for (const recipient of [bob, admin]) {
      const result = (await as(recipient, 'GET', '/api/notifications')).json();
      expect(result.unread).toBe(1);
      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({ taskId: null, sharedInfoId: info.id, kind: 'shared_published', title: info.title, readAt: null });
    }
    const notice = store.notifications(bob).items[0];
    await as(alice, 'POST', '/api/notifications/read', { id: notice.id });
    expect(store.notifications(bob).unread).toBe(1);
    await as(bob, 'POST', '/api/notifications/read', { id: notice.id });
    expect(store.notifications(bob).unread).toBe(0);
    expect(store.notifications(bob).items[0].readAt).toBe(clock.toISOString());
    expect(store.notifications(admin).unread).toBe(1);
    await as(admin, 'POST', '/api/notifications/read', {});
    expect(store.notifications(admin).unread).toBe(0);
  });

  it('编辑和置顶不重复通知，删除共享信息只清理其自己的通知', async () => {
    createTask(bob, alice);
    let info = store.createShared(alice, { title: '发布一次', content: '原内容', categoryId: null });
    const notice = store.notifications(bob).items.find(item => item.kind === 'shared_published')!;
    info = store.pinShared(admin, info.id, true, info.version);
    info = store.updateShared(alice, info.id, { ...info, content: '编辑后的内容', title: '更新后的标题' });
    new Store(db, () => clock).processReminders();
    expect(store.notifications(bob).items.filter(item => item.kind === 'shared_published')).toEqual([{ ...notice, title: '更新后的标题' }]);
    expect((await as(bob, 'DELETE', `/api/shared-info/${info.id}`, { version: info.version })).statusCode).toBe(403);
    const taskNotices = store.notifications(bob).items.filter(item => item.taskId !== null);
    expect((await as(alice, 'DELETE', `/api/shared-info/${info.id}`, { version: info.version })).statusCode).toBe(200);
    expect(store.notifications(bob).items).toEqual(taskNotices);
    expect(store.notifications(admin).items).toHaveLength(0);
    expect((await as(bob, 'GET', `/api/shared-info/${info.id}`)).statusCode).toBe(404);
  });

  it('部分通知写入失败时，整次发布和已写入通知一起回滚', async () => {
    db.exec(`CREATE TRIGGER fail_shared_notice BEFORE INSERT ON notifications
      WHEN NEW.kind='shared_published' AND EXISTS (SELECT 1 FROM notifications WHERE kind='shared_published')
      BEGIN SELECT RAISE(ABORT, 'simulated delivery failure'); END;`);
    const response = await as(alice, 'POST', '/api/shared-info', { title: '不应留下的发布', content: '回滚测试', categoryId: null });
    expect(response.statusCode).toBe(500);
    expect(store.sharedList({}).total).toBe(0);
    expect(db.prepare('SELECT id FROM notifications').all()).toHaveLength(0);
    db.exec('DROP TRIGGER fail_shared_notice');
    expect((await as(alice, 'POST', '/api/shared-info', { title: '重新发布', content: '恢复后成功', categoryId: null })).statusCode).toBe(201);
    expect(db.prepare('SELECT id FROM notifications').all()).toHaveLength(3);
  });
});

describe('通知数据库升级', () => {
  it('升级 v1 保留通知、已读、去重和历史内容，重复启动不重复迁移', async () => {
    const task = createTask(bob, alice);
    store.processReminders();
    store.readNotifications(bob, store.notifications(bob).items.find(item => item.kind === 'assigned')!.id);
    const removed = createTask(bob, alice);
    store.archiveTask(alice, removed.id, removed.version, true);
    const oldInfo = store.createShared(alice, { title: '旧共享信息', content: '升级前已存在', categoryId: null });
    makeVersionOneFixture(db);
    const oldRows = db.prepare(`SELECT ${legacyNoticeColumns} FROM notifications ORDER BY id`).all();
    await app.close(); db.close();
    db = openDatabase(filename);
    store = new Store(db, () => clock);
    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION);
    expect(db.pragma('foreign_key_check')).toEqual([]);
    expect(db.prepare(`SELECT ${legacyNoticeColumns} FROM notifications ORDER BY id`).all()).toEqual(oldRows);
    expect(store.task(bob, task.id).description).toBe(task.description);
    expect(store.sharedInfo(oldInfo.id).content).toBe('升级前已存在');
    expect(store.notifications(bob).items.every(item => item.sharedInfoId === null)).toBe(true);
    store.processReminders();
    expect(db.prepare(`SELECT ${legacyNoticeColumns} FROM notifications ORDER BY id`).all()).toEqual(oldRows);
    const newInfo = store.createShared(alice, { title: '升级后发布', content: '有通知', categoryId: null });
    expect(store.notifications(bob).items.filter(item => item.kind === 'shared_published').map(item => item.sharedInfoId)).toEqual([newInfo.id]);
    const upgradedRows = db.prepare('SELECT * FROM notifications ORDER BY id').all();
    db.close(); db = openDatabase(filename);
    expect(db.prepare('SELECT * FROM notifications ORDER BY id').all()).toEqual(upgradedRows);
  });

  it('恢复旧备份时升级临时副本、保留原备份并清除旧会话', async () => {
    const task = createTask(bob, alice);
    await login();
    makeVersionOneFixture(db);
    const backup = await backupDatabase(store, resolve(directory, 'backups'));
    await app.close(); db.close();
    await restoreDatabase(backup, filename);
    db = openDatabase(filename);
    store = new Store(db, () => clock);
    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION);
    expect(store.task(bob, task.id).title).toBe(task.title);
    expect(db.prepare('SELECT * FROM sessions').all()).toHaveLength(0);
    expect(store.notifications(bob).items[0]).toMatchObject({ kind: 'assigned', taskId: task.id, sharedInfoId: null });
    store.createShared(alice, { title: '恢复后发布', content: '继续协作', categoryId: null });
    expect(store.notifications(bob).items.some(item => item.kind === 'shared_published')).toBe(true);
    const original = new Database(backup, { readonly: true });
    try { expect(original.pragma('user_version', { simple: true })).toBe(1); }
    finally { original.close(); }
  });

  it('旧备份升级失败时保留当前数据库，清理临时副本', async () => {
    const task = createTask();
    const backup = await backupDatabase(store, resolve(directory, 'backups'));
    const malformed = new Database(backup);
    try {
      makeVersionOneFixture(malformed);
      malformed.exec('ALTER TABLE notifications DROP COLUMN message');
    } finally { malformed.close(); }
    await expect(restoreDatabase(backup, filename)).rejects.toThrow(/message/);
    expect(store.task(alice, task.id).title).toBe(task.title);
    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION);
    expect((await readdir(directory)).filter(name => name.includes('.restore-'))).toEqual([]);
  });
});

describe('备份与恢复', () => {
  it('使用 SQLite 一致性备份，恢复内容和历史，清除旧会话并保留恢复前副本', async () => {
    const task = createTask();
    const info = store.createShared(alice, { title: '需要恢复的内容', content: '保留正文', categoryId: null });
    await login();
    const backup = await backupDatabase(store, resolve(directory, 'backups'));
    change(alice, task, { version: task.version, title: '备份后的修改' });
    store.deleteShared(alice, info.id, info.version);
    await app.close(); db.close();
    const result = await restoreDatabase(backup, filename);
    expect(result.previousBackup).toBeTruthy();
    const restored = openDatabase(filename);
    try {
      const next = new Store(restored, () => clock);
      expect(next.task(admin, task.id).title).toBe(task.title);
      expect(next.sharedInfo(info.id).content).toBe(info.content);
      expect(next.report(alice, '2026-10', 'personal').totals.open).toBe(1);
      expect((restored.prepare('SELECT COUNT(*) AS n FROM sessions').get() as { n: number }).n).toBe(0);
      expect(restored.pragma('quick_check', { simple: true })).toBe('ok');
    } finally { restored.close(); }
  });
  it('自动备份在上海时间 03:00 后补备，最多保留 7 份', async () => {
    const backups = resolve(directory, 'daily');
    clock = new Date('2026-10-14T18:59:00Z');
    const errors: unknown[] = [];
    const jobs = createJobs(store, backups, error => errors.push(error));
    try {
      await jobs.tick();
      expect(db.prepare("SELECT value FROM app_settings WHERE key='last_backup_date'").get()).toBeUndefined();
      clock = new Date('2026-10-14T19:00:00Z');
      await jobs.tick(); await jobs.tick();
      expect((await readdir(backups)).filter(f => f.endsWith('.sqlite'))).toHaveLength(1);
      for (let i = 0; i < 8; i++) { clock = new Date(clock.getTime() + 86400000); await jobs.tick(); }
      expect((await readdir(backups)).filter(f => f.endsWith('.sqlite'))).toHaveLength(7);
      expect(errors).toEqual([]);
    } finally { await jobs.stop(); }
  });
  it('服务未停止或备份损坏时拒绝恢复', async () => {
    const backup = await backupDatabase(store, resolve(directory, 'backups'));
    await writeFile(resolve(directory, 'server.pid'), String(process.pid));
    await expect(restoreDatabase(backup, filename)).rejects.toThrow('请先停止');
    await rm(resolve(directory, 'server.pid'));
    const invalid = resolve(directory, 'bad.sqlite');
    await writeFile(invalid, 'invalid database');
    await expect(restoreDatabase(invalid, filename)).rejects.toThrow();
    expect(store.user(admin.id).active).toBe(true);
  });
});
