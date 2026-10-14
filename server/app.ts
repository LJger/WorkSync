import Fastify, { type FastifyReply } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import staticFiles from '@fastify/static';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z, ZodError } from 'zod';
import type { Db } from './database.js';
import { AppError, fail } from './errors.js';
import { Store, publicUser } from './store.js';
import { DUMMY_HASH, hashPassword, newSessionToken, tokenHash, verifyPassword } from './security.js';
import { validDate } from '../shared/dates.js';
import type { User } from '../shared/types.js';

declare module 'fastify' {
  interface FastifyRequest { user: User | null }
}

const idParams = z.object({ id: z.string().min(1).max(100) });
const password = z.string().min(8, '密码至少需要 8 个字符').max(128, '密码不能超过 128 个字符');
const username = z.string().trim().toLowerCase().regex(/^[a-z0-9_.-]{3,32}$/, '用户名使用 3–32 位字母、数字、点、下划线或短横线');
const name = z.string().trim().min(1, '请填写姓名').max(40, '姓名不能超过 40 个字符');
const version = z.number().int().positive();
const date = z.string().refine(validDate, '请选择有效日期');
const taskInput = z.object({
  title: z.string().trim().min(1, '请填写任务标题').max(160, '标题不能超过 160 个字符'),
  description: z.string().max(10000, '任务说明不能超过 10000 个字符').default(''),
  assigneeId: z.string().min(1, '请选择负责人'),
  dueDate: date.nullable().default(null),
}).strict();
// 更新字段不能继承创建时的默认值，否则仅改状态也可能清空说明与截止日期。
const taskPatch = z.object({
  version,
  title: z.string().trim().min(1, '请填写任务标题').max(160).optional(),
  description: z.string().max(10000).optional(),
  assigneeId: z.string().min(1).optional(),
  dueDate: date.nullable().optional(),
  status: z.enum(['todo', 'in_progress', 'done']).optional(),
}).strict();
const pageFields = { page: z.coerce.number().int().min(1).max(100000).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(40) };
const taskFilters = z.object({
  scope: z.enum(['assigned', 'created', 'all']).default('assigned'),
  q: z.string().trim().max(200).optional(), status: z.enum(['todo', 'in_progress', 'done']).optional(),
  due: z.enum(['overdue', 'today', 'upcoming', 'none']).optional(), assigneeId: z.string().optional(),
  archived: z.enum(['true', 'false']).default('false').transform(v => v === 'true'), ...pageFields,
});
const sharedInput = z.object({
  title: z.string().trim().min(1, '请填写标题').max(120, '标题不能超过 120 个字符'),
  content: z.string().trim().min(1, '请填写共享内容').max(20000, '内容不能超过 20000 个字符'),
  categoryId: z.string().min(1).nullable().default(null),
}).strict();

export interface AppOptions {
  db: Db;
  clock?: () => Date;
  logger?: boolean;
  secureCookie?: boolean;
  appOrigin?: string;
  production?: boolean;
  publicDir?: string;
  disableRateLimit?: boolean;
}

export async function createApp(options: AppOptions) {
  const store = new Store(options.db, options.clock);
  const app = Fastify({
    bodyLimit: 128 * 1024,
    logger: options.logger ? {
      redact: ['req.headers.cookie', 'req.headers.authorization', 'password', 'passwordHash'],
      serializers: { req: req => ({ method: req.method, url: req.url?.split('?')[0], remoteAddress: req.ip }) },
    } : false,
  });
  app.decorateRequest('user', null);
  await app.register(cookie);
  await app.register(rateLimit, { global: false });

  const cookieOptions = {
    path: '/', httpOnly: true, sameSite: 'lax' as const, secure: options.secureCookie || false,
    maxAge: 7 * 24 * 60 * 60,
  };
  function createSession(user: User, reply: FastifyReply) {
    const token = newSessionToken();
    options.db.prepare('INSERT INTO sessions (token_hash,user_id,expires_at,created_at) VALUES (?,?,?,?)')
      .run(tokenHash(token), user.id, new Date(store.clock().getTime() + 7 * 86400000).toISOString(), store.now());
    reply.setCookie('worksync_session', token, cookieOptions);
  }

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.status(400).send({ code: 'VALIDATION_ERROR', message: error.issues[0]?.message || '请检查填写的信息。' });
    }
    if (error instanceof AppError) return reply.status(error.status).send({ code: error.code, message: error.message });
    const status = error && typeof error === 'object' && 'statusCode' in error && typeof error.statusCode === 'number' ? error.statusCode : 500;
    if (status === 429) return reply.status(429).send({ code: 'RATE_LIMITED', message: '尝试次数过多，请稍后再试。' });
    if (status < 500) return reply.status(status).send({ code: 'BAD_REQUEST', message: '请求格式不正确，请检查后重试。' });
    request.log.error(error);
    return reply.status(500).send({ code: 'SERVER_ERROR', message: '暂时无法完成操作，请稍后重试。' });
  });

  app.addHook('onRequest', async (request, reply) => {
    const pathname = request.url.split('?')[0];
    if (!pathname.startsWith('/api/')) return;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      const origin = request.headers.origin;
      const allowed = new Set([`${options.secureCookie ? 'https' : 'http'}://${request.headers.host}`]);
      if (options.appOrigin) allowed.add(options.appOrigin.replace(/\/$/, ''));
      if (!options.production) { allowed.add('http://localhost:5173'); allowed.add('http://127.0.0.1:5173'); }
      if (request.headers['sec-fetch-site'] === 'cross-site' || (origin && !allowed.has(origin))) {
        fail(403, 'INVALID_ORIGIN', '请求来源不受信任，请从应用页面重试。');
      }
    }
    if (pathname === '/api/health' || pathname === '/api/auth/login') return;
    const token = request.cookies.worksync_session;
    if (!token || token.length > 128) fail(401, 'UNAUTHENTICATED', '请先登录。');
    const row = options.db.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id
      WHERE s.token_hash=? AND s.expires_at>? AND u.active=1`).get(tokenHash(token), store.now()) as ReturnType<Store['rawUser']>;
    if (!row) { reply.clearCookie('worksync_session', { path: '/' }); fail(401, 'UNAUTHENTICATED', '登录已过期，请重新登录。'); }
    request.user = publicUser(row);
    if (request.user.mustChangePassword && !['/api/auth/me', '/api/auth/logout', '/api/auth/password'].includes(pathname)) {
      fail(403, 'PASSWORD_CHANGE_REQUIRED', '请先修改初始密码。');
    }
  });

  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'same-origin');
    if (request.url.startsWith('/api/')) reply.header('Cache-Control', 'no-store');
    else if (options.production) {
      reply.header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
    }
    return payload;
  });

  app.get('/api/health', async () => ({ ok: true }));
  app.post('/api/auth/login', { config: { rateLimit: { max: options.disableRateLimit ? 10000 : 12, timeWindow: '1 minute' } } }, async (request, reply) => {
    const input = z.object({ username: z.string().trim().max(32), password: z.string().min(1).max(128) }).parse(request.body);
    const row = store.findUser(input.username);
    const valid = await verifyPassword(input.password, row?.password_hash || DUMMY_HASH);
    if (!row || !row.active || !valid) fail(401, 'LOGIN_FAILED', '用户名或密码不正确，或账号已停用。');
    // 登录时轮换已有会话，避免固定会话。
    if (request.cookies.worksync_session) options.db.prepare('DELETE FROM sessions WHERE token_hash=?').run(tokenHash(request.cookies.worksync_session));
    const user = publicUser(row);
    createSession(user, reply);
    return { user };
  });
  app.get('/api/auth/me', async request => ({ user: request.user! }));
  app.post('/api/auth/logout', async (request, reply) => {
    if (request.cookies.worksync_session) options.db.prepare('DELETE FROM sessions WHERE token_hash=?').run(tokenHash(request.cookies.worksync_session));
    reply.clearCookie('worksync_session', { path: '/' });
    return { ok: true };
  });
  app.post('/api/auth/password', async (request, reply) => {
    const input = z.object({ oldPassword: z.string().max(128), newPassword: password }).strict().parse(request.body);
    const row = store.rawUser(request.user!.id)!;
    if (!await verifyPassword(input.oldPassword, row.password_hash)) fail(400, 'WRONG_PASSWORD', '原密码不正确。');
    if (input.oldPassword === input.newPassword) fail(400, 'SAME_PASSWORD', '新密码需要与原密码不同。');
    store.setPassword(row.id, await hashPassword(input.newPassword), false);
    const user = store.user(row.id);
    createSession(user, reply);
    return { user };
  });

  app.get('/api/members', async () => ({ items: store.members() }));
  app.get('/api/users', async request => ({ items: store.users(request.user!) }));
  app.post('/api/users', async (request, reply) => {
    store.requireAdmin(request.user!);
    const input = z.object({ username, displayName: name, password, role: z.enum(['admin', 'member']).default('member') }).strict().parse(request.body);
    const user = store.createUser({ ...input, passwordHash: await hashPassword(input.password) });
    reply.code(201);
    return { user };
  });
  app.patch('/api/users/:id', async request => {
    const { id } = idParams.parse(request.params);
    const input = z.object({ displayName: name.optional(), role: z.enum(['admin', 'member']).optional(), active: z.literal(true).optional() }).strict().parse(request.body);
    return { user: store.updateUser(request.user!, id, input) };
  });
  app.post('/api/users/:id/deactivate', async request => {
    const { id } = idParams.parse(request.params);
    const { transferToId } = z.object({ transferToId: z.string().optional() }).strict().parse(request.body);
    store.deactivateUser(request.user!, id, transferToId);
    return { ok: true };
  });
  app.post('/api/users/:id/password', async request => {
    store.requireAdmin(request.user!);
    const { id } = idParams.parse(request.params);
    const input = z.object({ password }).strict().parse(request.body);
    store.setPassword(id, await hashPassword(input.password), true);
    return { ok: true };
  });

  app.get('/api/tasks', async request => store.tasks(request.user!, taskFilters.parse(request.query)));
  app.get('/api/tasks/summary', async request => store.taskSummary(request.user!, taskFilters.parse(request.query)));
  app.get('/api/tasks/:id', async request => ({ task: store.task(request.user!, idParams.parse(request.params).id) }));
  app.post('/api/tasks', async (request, reply) => {
    const task = store.createTask(request.user!, taskInput.parse(request.body));
    reply.code(201); return { task };
  });
  app.patch('/api/tasks/:id', async request => ({ task: store.updateTask(request.user!, idParams.parse(request.params).id, taskPatch.parse(request.body)) }));
  app.post('/api/tasks/:id/archive', async request => {
    const input = z.object({ archived: z.boolean(), version, assigneeId: z.string().min(1).optional() }).strict().parse(request.body);
    return { task: store.archiveTask(request.user!, idParams.parse(request.params).id, input.version, input.archived, input.assigneeId) };
  });

  app.get('/api/notifications', async request => store.notifications(request.user!));
  app.post('/api/notifications/read', async request => {
    const { id } = z.object({ id: z.string().optional() }).strict().parse(request.body);
    store.readNotifications(request.user!, id); return { ok: true };
  });
  app.get('/api/reports/monthly', async request => {
    const input = z.object({
      month: z.string().regex(/^(19|20|21)\d{2}-(0[1-9]|1[0-2])$/),
      scope: z.enum(['personal', 'team']).default('personal'), memberId: z.string().optional(),
    }).parse(request.query);
    return store.report(request.user!, input.month, input.scope, input.memberId);
  });

  app.get('/api/shared-categories', async () => ({ items: store.categories() }));
  const categoryName = z.object({ name: z.string().trim().min(1, '请填写分类名称').max(30, '分类名称不能超过 30 个字符') }).strict();
  app.post('/api/shared-categories', async (request, reply) => {
    reply.code(201); return { category: store.saveCategory(request.user!, categoryName.parse(request.body).name) };
  });
  app.patch('/api/shared-categories/:id', async request => ({ category: store.saveCategory(request.user!, categoryName.parse(request.body).name, idParams.parse(request.params).id) }));
  app.delete('/api/shared-categories/:id', async request => {
    store.deleteCategory(request.user!, idParams.parse(request.params).id); return { ok: true };
  });
  app.get('/api/shared-info', async request => {
    const input = z.object({ q: z.string().trim().max(200).optional(), categoryId: z.string().optional(), ...pageFields }).parse(request.query);
    return store.sharedList(input);
  });
  app.get('/api/shared-info/:id', async request => ({ info: store.sharedInfo(idParams.parse(request.params).id) }));
  app.post('/api/shared-info', async (request, reply) => {
    reply.code(201); return { info: store.createShared(request.user!, sharedInput.parse(request.body)) };
  });
  app.patch('/api/shared-info/:id', async request => ({ info: store.updateShared(request.user!, idParams.parse(request.params).id, sharedInput.extend({ version }).parse(request.body)) }));
  app.post('/api/shared-info/:id/pin', async request => {
    const input = z.object({ pinned: z.boolean(), version }).strict().parse(request.body);
    return { info: store.pinShared(request.user!, idParams.parse(request.params).id, input.pinned, input.version) };
  });
  app.delete('/api/shared-info/:id', async request => {
    const input = z.object({ version }).strict().parse(request.body);
    store.deleteShared(request.user!, idParams.parse(request.params).id, input.version); return { ok: true };
  });

  const publicDir = options.publicDir || resolve('dist/public');
  if (existsSync(resolve(publicDir, 'index.html'))) {
    await app.register(staticFiles, { root: publicDir, prefix: '/', index: 'index.html', maxAge: 0 });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/')) return reply.code(404).send({ code: 'NOT_FOUND', message: '接口不存在。' });
      if (request.method !== 'GET' && request.method !== 'HEAD') return reply.code(404).send();
      if (request.url.startsWith('/assets/')) return reply.code(404).send();
      reply.header('Cache-Control', 'no-cache');
      return reply.sendFile('index.html');
    });
  }
  return { app, store };
}
