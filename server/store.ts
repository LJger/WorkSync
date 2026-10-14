import { randomUUID } from 'node:crypto';
import type { Db } from './database.js';
import { fail } from './errors.js';
import { addDays, localDate, monthBounds } from '../shared/dates.js';
import type {
  AdminUser, Category, Member, MonthlyReport, Notification, Page, Role, SharedInfo,
  SharedInput, Task, TaskInput, TaskPatch, TaskScope, TaskStatus, TaskSummary, User,
} from '../shared/types.js';

interface UserRow {
  id: string; username: string; display_name: string; password_hash: string;
  role: Role; active: number; must_change_password: number; created_at: string;
  open_task_count?: number;
}
interface TaskRow {
  id: string; title: string; description: string; creator_id: string; assignee_id: string;
  status: TaskStatus; due_date: string | null; completed_at: string | null; archived_at: string | null;
  created_at: string; updated_at: string; version: number;
  creator_username: string; creator_name: string; assignee_username: string; assignee_name: string;
}
interface SharedRow {
  id: string; title: string; content: string; author_id: string; category_id: string | null;
  category_name: string | null; pinned: number; created_at: string; updated_at: string; version: number;
  author_username: string; author_name: string;
}
export interface TaskFilters {
  scope?: TaskScope; q?: string; status?: TaskStatus; due?: string;
  assigneeId?: string; archived?: boolean; page?: number; pageSize?: number;
}

const taskSelect = `SELECT t.*, c.username AS creator_username, c.display_name AS creator_name,
  a.username AS assignee_username, a.display_name AS assignee_name
  FROM tasks t JOIN users c ON c.id=t.creator_id JOIN users a ON a.id=t.assignee_id`;
const sharedSelect = `SELECT s.*, u.username AS author_username, u.display_name AS author_name,
  c.name AS category_name FROM shared_info s JOIN users u ON u.id=s.author_id
  LEFT JOIN shared_categories c ON c.id=s.category_id`;

export function publicUser(row: UserRow): User {
  return { id: row.id, username: row.username, displayName: row.display_name, role: row.role,
    active: !!row.active, mustChangePassword: !!row.must_change_password, createdAt: row.created_at };
}
function member(user: User): Member { return { id: user.id, username: user.username, displayName: user.displayName }; }
function like(value: string): string { return `%${value.replace(/[\\%_]/g, '\\$&')}%`; }

export class Store {
  constructor(public db: Db, public clock: () => Date = () => new Date()) {}
  now(): string { return this.clock().toISOString(); }
  today(): string { return localDate(this.clock()); }

  rawUser(id: string): UserRow | undefined {
    return this.db.prepare('SELECT * FROM users WHERE id=?').get(id) as UserRow | undefined;
  }
  user(id: string): User {
    const row = this.rawUser(id);
    if (!row) fail(404, 'NOT_FOUND', '成员不存在。');
    return publicUser(row);
  }
  findUser(username: string): UserRow | undefined {
    return this.db.prepare('SELECT * FROM users WHERE username=? COLLATE NOCASE').get(username) as UserRow | undefined;
  }
  requireAdmin(user: User): void {
    if (user.role !== 'admin') fail(403, 'FORBIDDEN', '仅管理员可以执行此操作。');
  }
  requireActiveAssignee(id: string): void {
    const row = this.rawUser(id);
    if (!row?.active) fail(400, 'INVALID_ASSIGNEE', '请选择一位有效的团队成员。');
  }
  createUser(input: { username: string; displayName: string; passwordHash: string; role: Role; mustChangePassword?: boolean }): User {
    if (this.findUser(input.username)) fail(409, 'USERNAME_EXISTS', '这个用户名已经被使用。');
    const id = randomUUID();
    this.db.prepare(`INSERT INTO users (id, username, display_name, password_hash, role, must_change_password, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, input.username.toLowerCase(), input.displayName, input.passwordHash,
      input.role, input.mustChangePassword === false ? 0 : 1, this.now());
    return this.user(id);
  }
  members(): Member[] {
    return (this.db.prepare('SELECT * FROM users WHERE active=1 ORDER BY display_name, username').all() as UserRow[])
      .map(row => member(publicUser(row)));
  }
  users(actor: User): AdminUser[] {
    this.requireAdmin(actor);
    return (this.db.prepare(`SELECT u.*, (SELECT COUNT(*) FROM tasks t WHERE t.assignee_id=u.id
      AND t.status!='done' AND t.archived_at IS NULL) AS open_task_count FROM users u
      ORDER BY active DESC, role ASC, created_at ASC`).all() as UserRow[])
      .map(row => ({ ...publicUser(row), openTaskCount: row.open_task_count || 0 }));
  }
  updateUser(actor: User, id: string, input: { displayName?: string; role?: Role; active?: boolean }): User {
    this.requireAdmin(actor);
    return this.db.transaction(() => {
      const existing = this.user(id);
      if (existing.role === 'admin' && existing.active && input.role === 'member') this.protectLastAdmin();
      this.db.prepare('UPDATE users SET display_name=?, role=?, active=? WHERE id=?')
        .run(input.displayName ?? existing.displayName, input.role ?? existing.role,
          input.active === true ? 1 : Number(existing.active), id);
      return this.user(id);
    })();
  }
  private protectLastAdmin(): void {
    const { n } = this.db.prepare("SELECT COUNT(*) AS n FROM users WHERE active=1 AND role='admin'").get() as { n: number };
    if (n <= 1) fail(400, 'LAST_ADMIN', '团队至少需要保留一位有效管理员。');
  }
  deactivateUser(actor: User, id: string, transferToId?: string): void {
    this.requireAdmin(actor);
    this.db.transaction(() => {
      const target = this.user(id);
      if (!target.active) return;
      if (target.role === 'admin') this.protectLastAdmin();
      const tasks = this.db.prepare("SELECT id, version FROM tasks WHERE assignee_id=? AND status!='done' AND archived_at IS NULL")
        .all(id) as { id: string; version: number }[];
      if (tasks.length) {
        if (!transferToId || transferToId === id) fail(400, 'TRANSFER_REQUIRED', '请为未完成任务选择另一位接收人。');
        this.requireActiveAssignee(transferToId);
        for (const task of tasks) this.updateTask(actor, task.id, { assigneeId: transferToId, version: task.version });
      }
      this.db.prepare('UPDATE users SET active=0 WHERE id=?').run(id);
      this.db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
      this.db.prepare('UPDATE notifications SET dismissed_at=? WHERE recipient_id=? AND dismissed_at IS NULL').run(this.now(), id);
    })();
  }
  setPassword(id: string, hash: string, mustChange: boolean): void {
    this.db.transaction(() => {
      this.user(id);
      this.db.prepare('UPDATE users SET password_hash=?, must_change_password=? WHERE id=?').run(hash, Number(mustChange), id);
      this.db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
    })();
  }

  private taskFromRow(row: TaskRow): Task {
    return { id: row.id, title: row.title, description: row.description,
      creatorId: row.creator_id, assigneeId: row.assignee_id,
      creator: { id: row.creator_id, username: row.creator_username, displayName: row.creator_name },
      assignee: { id: row.assignee_id, username: row.assignee_username, displayName: row.assignee_name },
      status: row.status, dueDate: row.due_date, completedAt: row.completed_at, archivedAt: row.archived_at,
      createdAt: row.created_at, updatedAt: row.updated_at, version: row.version,
      overdue: !!row.due_date && row.due_date < this.today() && row.status !== 'done' && !row.archived_at };
  }
  private rawTask(id: string): Task {
    const row = this.db.prepare(`${taskSelect} WHERE t.id=?`).get(id) as TaskRow | undefined;
    if (!row) fail(404, 'NOT_FOUND', '任务不存在或你没有查看权限。');
    return this.taskFromRow(row);
  }
  task(actor: User, id: string): Task {
    const task = this.rawTask(id);
    if (actor.role !== 'admin' && task.creatorId !== actor.id && task.assigneeId !== actor.id)
      fail(404, 'NOT_FOUND', '任务不存在或你没有查看权限。');
    return task;
  }
  private taskWhere(actor: User, filters: TaskFilters): { sql: string; params: (string | number)[] } {
    const where: string[] = [];
    const params: (string | number)[] = [];
    const scope = filters.scope || 'assigned';
    if (scope === 'all') this.requireAdmin(actor);
    else { where.push(scope === 'created' ? 't.creator_id=?' : 't.assignee_id=?'); params.push(actor.id); }
    where.push(filters.archived ? 't.archived_at IS NOT NULL' : 't.archived_at IS NULL');
    if (filters.status) { where.push('t.status=?'); params.push(filters.status); }
    if (filters.assigneeId) { where.push('t.assignee_id=?'); params.push(filters.assigneeId); }
    if (filters.q) { where.push("(t.title LIKE ? ESCAPE '\\' OR t.description LIKE ? ESCAPE '\\')"); params.push(like(filters.q), like(filters.q)); }
    if (filters.due === 'overdue') { where.push("t.status!='done' AND t.due_date<?"); params.push(this.today()); }
    if (filters.due === 'today') { where.push('t.due_date=?'); params.push(this.today()); }
    if (filters.due === 'upcoming') { where.push('t.due_date>? AND t.due_date<=?'); params.push(this.today(), addDays(this.today(), 7)); }
    if (filters.due === 'none') where.push('t.due_date IS NULL');
    return { sql: where.length ? ` WHERE ${where.join(' AND ')}` : '', params };
  }
  tasks(actor: User, filters: TaskFilters = {}): Page<Task> {
    const { sql, params } = this.taskWhere(actor, filters);
    const page = filters.page || 1, pageSize = filters.pageSize || 40;
    const { total } = this.db.prepare(`SELECT COUNT(*) AS total FROM tasks t${sql}`).get(...params) as { total: number };
    const items = (this.db.prepare(`${taskSelect}${sql} ORDER BY CASE WHEN t.status='done' THEN 1 ELSE 0 END,
      CASE WHEN t.status='done' THEN NULL ELSE t.due_date IS NULL END,
      CASE WHEN t.status='done' THEN NULL ELSE t.due_date END ASC,
      CASE WHEN t.status='done' THEN t.completed_at ELSE t.created_at END DESC, t.id
      LIMIT ? OFFSET ?`).all(...params, pageSize, (page - 1) * pageSize) as TaskRow[]).map(row => this.taskFromRow(row));
    return { items, total, page, pageSize };
  }
  taskSummary(actor: User, filters: TaskFilters): TaskSummary {
    const { sql, params } = this.taskWhere(actor, { ...filters, status: undefined });
    const row = this.db.prepare(`SELECT COUNT(*) AS total,
      COALESCE(SUM(t.status='todo'),0) AS todo, COALESCE(SUM(t.status='in_progress'),0) AS inProgress,
      COALESCE(SUM(t.status='done'),0) AS done,
      COALESCE(SUM(t.status!='done' AND t.due_date<? AND t.archived_at IS NULL),0) AS overdue,
      COALESCE(SUM(t.status!='done' AND t.due_date=? AND t.archived_at IS NULL),0) AS dueToday
      FROM tasks t${sql}`).get(this.today(), this.today(), ...params) as TaskSummary;
    return row;
  }
  private snapshot(id: string, actorId: string): Task {
    const task = this.rawTask(id);
    this.db.prepare('INSERT INTO task_snapshots (task_id, version, recorded_at, actor_id, payload) VALUES (?, ?, ?, ?, ?)')
      .run(id, task.version, this.now(), actorId, JSON.stringify(task));
    return task;
  }
  createTask(actor: User, input: TaskInput): Task {
    return this.db.transaction(() => {
      this.requireActiveAssignee(input.assigneeId);
      const id = randomUUID(), now = this.now();
      this.db.prepare(`INSERT INTO tasks (id,title,description,creator_id,assignee_id,due_date,created_at,updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(id, input.title, input.description || '', actor.id, input.assigneeId, input.dueDate || null, now, now);
      const task = this.snapshot(id, actor.id);
      if (actor.id !== task.assigneeId) this.assignmentNotice(task, actor);
      return task;
    })();
  }
  updateTask(actor: User, id: string, input: TaskPatch): Task {
    return this.db.transaction(() => {
      const old = this.task(actor, id);
      if (old.version !== input.version) fail(409, 'VERSION_CONFLICT', '任务已被其他人更新，请重新加载后再保存。');
      if (old.archivedAt) fail(400, 'TASK_ARCHIVED', '请先恢复任务，再修改内容。');
      if (input.assigneeId && input.assigneeId !== old.assigneeId) this.requireActiveAssignee(input.assigneeId);
      const status = input.status ?? old.status;
      if (status !== 'done') this.requireActiveAssignee(input.assigneeId ?? old.assigneeId);
      const now = this.now();
      const completedAt = status === 'done' ? old.status === 'done' ? old.completedAt : now : null;
      this.db.prepare(`UPDATE tasks SET title=?, description=?, assignee_id=?, status=?, due_date=?, completed_at=?,
        updated_at=?, version=version+1 WHERE id=? AND version=?`).run(input.title ?? old.title, input.description ?? old.description,
        input.assigneeId ?? old.assigneeId, status, input.dueDate === undefined ? old.dueDate : input.dueDate,
        completedAt, now, id, old.version);
      const task = this.snapshot(id, actor.id);
      this.clearStaleNotifications(task);
      if (old.assigneeId !== task.assigneeId && actor.id !== task.assigneeId) this.assignmentNotice(task, actor);
      return task;
    })();
  }
  archiveTask(actor: User, id: string, version: number, archived: boolean, assigneeId?: string): Task {
    return this.db.transaction(() => {
      const old = this.task(actor, id);
      if (old.version !== version) fail(409, 'VERSION_CONFLICT', '任务已更新，请重新加载后再操作。');
      if (!!old.archivedAt === archived) return old;
      if (archived && assigneeId) fail(400, 'INVALID_UPDATE', '归档时不能同时更换负责人。');
      const owner = assigneeId || old.assigneeId;
      if (!archived && (assigneeId || old.status !== 'done')) this.requireActiveAssignee(owner);
      this.db.prepare('UPDATE tasks SET archived_at=?, assignee_id=?, updated_at=?, version=version+1 WHERE id=?')
        .run(archived ? this.now() : null, owner, this.now(), id);
      const task = this.snapshot(id, actor.id);
      this.clearStaleNotifications(task);
      if (old.assigneeId !== task.assigneeId && actor.id !== task.assigneeId) this.assignmentNotice(task, actor);
      return task;
    })();
  }

  private notice(task: Task, kind: Notification['kind'], key: string, message: string): void {
    this.db.prepare(`INSERT OR IGNORE INTO notifications
      (id,recipient_id,task_id,kind,message,due_date,dedupe_key,created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(randomUUID(), task.assigneeId, task.id, kind, message, task.dueDate, key, this.now());
  }
  private assignmentNotice(task: Task, actor: User): void {
    if (task.archivedAt) return;
    this.notice(task, 'assigned', `assigned:${task.id}:${task.version}:${task.assigneeId}`, `${actor.displayName} 将任务分配给你`);
  }
  private clearStaleNotifications(task: Task): void {
    this.db.prepare(`UPDATE notifications SET dismissed_at=? WHERE task_id=? AND dismissed_at IS NULL
      AND (recipient_id!=? OR ?=1 OR (kind!='assigned' AND (?=1 OR COALESCE(due_date,'')!=COALESCE(?,''))))`)
      .run(this.now(), task.id, task.assigneeId, Number(!!task.archivedAt), Number(task.status === 'done'), task.dueDate);
  }
  processReminders(): void {
    this.db.transaction(() => {
      const tomorrow = addDays(this.today(), 1);
      const tasks = this.db.prepare(`${taskSelect} WHERE t.archived_at IS NULL AND t.status!='done'
        AND a.active=1 AND (t.due_date=? OR t.due_date<?)`).all(tomorrow, this.today()) as TaskRow[];
      for (const row of tasks) {
        const task = this.taskFromRow(row);
        const kind = task.overdue ? 'overdue' : 'due_soon';
        this.notice(task, kind, `${kind}:${task.id}:${task.assigneeId}:${task.dueDate}`,
          task.overdue ? `截止日期为 ${task.dueDate}，任务尚未完成` : `任务将于 ${task.dueDate} 截止，请提前安排`);
      }
      this.db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(this.now());
    })();
  }
  notifications(actor: User): { items: Notification[]; unread: number } {
    const base = `FROM notifications n JOIN tasks t ON t.id=n.task_id WHERE n.recipient_id=?
      AND n.dismissed_at IS NULL AND (t.assignee_id=? OR t.creator_id=? OR ?='admin')`;
    const params = [actor.id, actor.id, actor.id, actor.role];
    const items = this.db.prepare(`SELECT n.id, n.task_id AS taskId, n.kind, n.message, t.title,
      n.created_at AS createdAt, n.read_at AS readAt ${base} ORDER BY n.created_at DESC, n.id DESC LIMIT 100`)
      .all(...params) as Notification[];
    const { unread } = this.db.prepare(`SELECT COUNT(*) AS unread ${base} AND n.read_at IS NULL`).get(...params) as { unread: number };
    return { items, unread };
  }
  readNotifications(actor: User, id?: string): void {
    if (id) this.db.prepare('UPDATE notifications SET read_at=? WHERE id=? AND recipient_id=? AND read_at IS NULL')
      .run(this.now(), id, actor.id);
    else this.db.prepare('UPDATE notifications SET read_at=? WHERE recipient_id=? AND read_at IS NULL').run(this.now(), actor.id);
  }

  report(actor: User, month: string, scope: 'personal' | 'team', memberId?: string): MonthlyReport {
    if (scope === 'team' || (memberId && memberId !== actor.id)) this.requireAdmin(actor);
    if (month > this.today().slice(0, 7)) fail(400, 'FUTURE_MONTH', '请选择当前月份或过去月份。');
    const current = month === this.today().slice(0, 7);
    const bounds = monthBounds(month);
    const asOf = current ? this.now() : bounds.end;
    const selectedMember = scope === 'personal' ? member(this.user(memberId || actor.id)) : null;
    const rows = this.db.prepare(`SELECT s.payload FROM task_snapshots s JOIN
      (SELECT task_id, MAX(version) AS version FROM task_snapshots WHERE recorded_at ${current ? '<=' : '<'} ? GROUP BY task_id) latest
      ON s.task_id=latest.task_id AND s.version=latest.version`).all(asOf) as { payload: string }[];
    const groups = new Map<string, MonthlyReport['groups'][number]>();
    for (const row of rows) {
      const task = JSON.parse(row.payload) as Task;
      if (selectedMember && task.assigneeId !== selectedMember.id) continue;
      const completed = task.status === 'done' && !!task.completedAt && task.completedAt >= bounds.start && task.completedAt < bounds.end;
      const open = task.status !== 'done' && !task.archivedAt;
      if (!completed && !open) continue;
      task.overdue = open && !!task.dueDate && task.dueDate < localDate(asOf);
      let group = groups.get(task.assigneeId);
      if (!group) { group = { member: task.assignee, completed: [], open: [], overdue: 0 }; groups.set(task.assigneeId, group); }
      if (completed) group.completed.push(task);
      else { group.open.push(task); if (task.overdue) group.overdue++; }
    }
    for (const group of groups.values()) {
      group.completed.sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || '') || a.id.localeCompare(b.id));
      group.open.sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999') || a.id.localeCompare(b.id));
    }
    const list = [...groups.values()].sort((a, b) => a.member.username.localeCompare(b.member.username));
    return { month, scope, current, asOf, member: list[0]?.member && selectedMember ? list[0].member : selectedMember, groups: list,
      totals: list.reduce((t, g) => ({ completed: t.completed + g.completed.length, open: t.open + g.open.length,
        overdue: t.overdue + g.overdue }), { completed: 0, open: 0, overdue: 0 }) };
  }

  categories(): Category[] {
    return this.db.prepare(`SELECT c.id, c.name, COUNT(s.id) AS count FROM shared_categories c
      LEFT JOIN shared_info s ON s.category_id=c.id GROUP BY c.id ORDER BY c.name`).all() as Category[];
  }
  saveCategory(actor: User, name: string, id?: string): Category {
    this.requireAdmin(actor);
    if (id && !this.db.prepare('SELECT id FROM shared_categories WHERE id=?').get(id)) fail(404, 'NOT_FOUND', '分类不存在。');
    const existing = this.db.prepare('SELECT id FROM shared_categories WHERE name=? COLLATE NOCASE').get(name) as { id: string } | undefined;
    if (existing && existing.id !== id) fail(409, 'CATEGORY_EXISTS', '已有同名分类。');
    const key = id || randomUUID();
    if (id) this.db.prepare('UPDATE shared_categories SET name=? WHERE id=?').run(name, id);
    else this.db.prepare('INSERT INTO shared_categories (id,name) VALUES (?,?)').run(key, name);
    return this.categories().find(c => c.id === key)!;
  }
  deleteCategory(actor: User, id: string): void {
    this.requireAdmin(actor);
    this.db.transaction(() => {
      this.db.prepare('UPDATE shared_info SET category_id=NULL, version=version+1, updated_at=? WHERE category_id=?').run(this.now(), id);
      this.db.prepare('DELETE FROM shared_categories WHERE id=?').run(id);
    })();
  }
  private sharedFromRow(row: SharedRow): SharedInfo {
    return { id: row.id, title: row.title, content: row.content, authorId: row.author_id,
      author: { id: row.author_id, username: row.author_username, displayName: row.author_name },
      categoryId: row.category_id, categoryName: row.category_name, pinned: !!row.pinned,
      createdAt: row.created_at, updatedAt: row.updated_at, version: row.version };
  }
  sharedInfo(id: string): SharedInfo {
    const row = this.db.prepare(`${sharedSelect} WHERE s.id=?`).get(id) as SharedRow | undefined;
    if (!row) fail(404, 'NOT_FOUND', '这条共享信息不存在。');
    return this.sharedFromRow(row);
  }
  sharedList(filters: { q?: string; categoryId?: string; page?: number; pageSize?: number }): Page<SharedInfo> {
    const where: string[] = [], params: (string | number)[] = [];
    if (filters.q) { where.push("(s.title LIKE ? ESCAPE '\\' OR s.content LIKE ? ESCAPE '\\')"); params.push(like(filters.q), like(filters.q)); }
    if (filters.categoryId === 'uncategorized') where.push('s.category_id IS NULL');
    else if (filters.categoryId) { where.push('s.category_id=?'); params.push(filters.categoryId); }
    const sql = where.length ? ` WHERE ${where.join(' AND ')}` : '';
    const { total } = this.db.prepare(`SELECT COUNT(*) AS total FROM shared_info s${sql}`).get(...params) as { total: number };
    const page = filters.page || 1, pageSize = filters.pageSize || 20;
    const items = (this.db.prepare(`${sharedSelect}${sql} ORDER BY s.pinned DESC, s.updated_at DESC, s.id
      LIMIT ? OFFSET ?`).all(...params, pageSize, (page - 1) * pageSize) as SharedRow[]).map(row => this.sharedFromRow(row));
    return { items, total, page, pageSize };
  }
  private requireCategory(id: string | null): void {
    if (id && !this.db.prepare('SELECT id FROM shared_categories WHERE id=?').get(id)) fail(400, 'INVALID_CATEGORY', '分类已不存在，请重新选择。');
  }
  createShared(actor: User, input: SharedInput): SharedInfo {
    this.requireCategory(input.categoryId);
    const id = randomUUID(), now = this.now();
    this.db.prepare(`INSERT INTO shared_info (id,title,content,author_id,category_id,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?)`).run(id, input.title, input.content, actor.id, input.categoryId, now, now);
    return this.sharedInfo(id);
  }
  updateShared(actor: User, id: string, input: SharedInput & { version: number }): SharedInfo {
    return this.db.transaction(() => {
      const old = this.sharedInfo(id);
      if (actor.role !== 'admin' && old.authorId !== actor.id) fail(403, 'FORBIDDEN', '只有作者和管理员可以修改这条信息。');
      if (input.version !== old.version) fail(409, 'VERSION_CONFLICT', '信息已被更新，请重新加载后再保存。');
      this.requireCategory(input.categoryId);
      this.db.prepare('UPDATE shared_info SET title=?,content=?,category_id=?,version=version+1,updated_at=? WHERE id=?')
        .run(input.title, input.content, input.categoryId, this.now(), id);
      return this.sharedInfo(id);
    })();
  }
  pinShared(actor: User, id: string, pinned: boolean, version: number): SharedInfo {
    this.requireAdmin(actor);
    const old = this.sharedInfo(id);
    if (version !== old.version) fail(409, 'VERSION_CONFLICT', '信息已更新，请刷新后再操作。');
    this.db.prepare('UPDATE shared_info SET pinned=?, version=version+1, updated_at=? WHERE id=?').run(Number(pinned), this.now(), id);
    return this.sharedInfo(id);
  }
  deleteShared(actor: User, id: string, version: number): void {
    const old = this.sharedInfo(id);
    if (actor.role !== 'admin' && old.authorId !== actor.id) fail(403, 'FORBIDDEN', '只有作者和管理员可以删除这条信息。');
    if (version !== old.version) fail(409, 'VERSION_CONFLICT', '信息已更新，请刷新后再操作。');
    this.db.prepare('DELETE FROM shared_info WHERE id=?').run(id);
  }
}
