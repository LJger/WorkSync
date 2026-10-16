import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { addDays, calendarRange, localDate } from '../../shared/dates.js';
import type { Member, Notification, SharedInfo, Task } from '../../shared/types.js';

const baseURL = 'http://127.0.0.1:4173';
const password = 'WorkSync2026!';

async function login(page: Page, username = 'lin', value = password, forced = false) {
  await page.goto('/tasks');
  await page.getByLabel('用户名', { exact: true }).fill(username);
  await page.getByLabel('密码', { exact: true }).fill(value);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('heading', { name: forced ? '设置你的新密码' : '我的任务', exact: true })).toBeVisible();
}
async function createTask(page: Page, title: string, assigneeLabel?: string) {
  await page.getByRole('button', { name: '新建任务', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新建任务', exact: true });
  await dialog.getByLabel('任务标题', { exact: false }).fill(title);
  await dialog.getByLabel('任务说明', { exact: false }).fill('浏览器验收记录：完成后整理到本月总结。');
  await dialog.getByLabel('截止日期', { exact: true }).fill(addDays(localDate(), 1));
  if (assigneeLabel) await dialog.getByLabel('负责人', { exact: true }).selectOption({ label: assigneeLabel });
  const saved = page.waitForResponse(response => response.url().endsWith('/api/tasks') && response.request().method() === 'POST');
  await dialog.getByRole('button', { name: '创建任务', exact: true }).click();
  const response = await saved;
  expect(response.status()).toBe(201);
  const task = (await response.json()).task as Task;
  await expect(dialog).not.toBeVisible();
  return task;
}

async function beginTaskDrag(page: Page, title: string) {
  await expect(page.locator('.drag-preview')).toHaveCount(0);
  const handle = page.getByRole('button', { name: `拖动「${title}」`, exact: true });
  await expect(handle).toBeEnabled();
  await handle.scrollIntoViewIfNeeded();
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 10, box.y + box.height / 2, { steps: 3 });
  await expect(page.locator('.drag-preview')).toBeVisible();
}

async function beginKeyboardTaskDrag(page: Page, title: string) {
  const handle = page.getByRole('button', { name: `拖动「${title}」`, exact: true });
  await handle.focus();
  await page.keyboard.press('Space');
  await expect(handle).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.drag-preview')).toBeVisible();
  // dnd-kit defers its document keyboard listener until after the activation event.
  await page.evaluate(() => new Promise<void>(resolve => setTimeout(resolve, 0)));
}

async function moveTaskOverArchive(page: Page) {
  const archive = page.getByRole('button', { name: '查看归档任务', exact: true });
  const box = (await archive.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 15 });
  await expect(archive).toHaveClass(/drop-active/);
  await expect(page.getByText('松手归档', { exact: true })).toBeVisible();
}

async function dropTaskOnArchive(page: Page, title: string) {
  await beginTaskDrag(page, title);
  await moveTaskOverArchive(page);
  await page.mouse.up();
}

async function publishInfo(page: Page, title: string, content: string): Promise<SharedInfo> {
  await page.getByRole('link', { name: '团队共享', exact: true }).click();
  await page.getByRole('button', { name: '发布信息', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '发布共享信息', exact: true });
  await editor.getByLabel('标题', { exact: true }).fill(title);
  await editor.getByLabel('共享内容', { exact: false }).fill(content);
  const saved = page.waitForResponse(response => response.url().endsWith('/api/shared-info') && response.request().method() === 'POST');
  await editor.getByRole('button', { name: '发布信息', exact: true }).click();
  const response = await saved;
  expect(response.status()).toBe(201);
  await expect(editor).not.toBeVisible();
  return (await response.json()).info;
}

async function pollNotifications(page: Page, elapsed = 10_001) {
  const refreshed = page.waitForResponse(response => response.url().endsWith('/api/notifications') && response.request().method() === 'GET');
  await page.clock.fastForward(elapsed);
  await refreshed;
  // React Query batches notifications on a timer after the network response.
  // Keep the clock running so both those updates and browser interactions settle.
  await page.clock.runFor(100);
}

test.beforeEach(async ({ request }) => { expect((await request.post('/__e2e/reset')).ok()).toBe(true); });

test('创建、完成任务并生成可复制的个人月报', async ({ page, context }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await login(page);
  const task = await createTask(page, '浏览器验收：整理周会安排');
  const row = page.getByRole('row').filter({ hasText: task.title });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: `完成「${task.title}」`, exact: true }).click();
  await expect(row.getByLabel(`更新「${task.title}」状态`, { exact: true })).toHaveValue('done');
  await page.getByRole('link', { name: '月度总结', exact: true }).click();
  await expect(page.getByRole('heading', { name: task.title, exact: true })).toBeVisible();
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByRole('button', { name: '复制总结', exact: true }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain(task.title);
  expect(errors).toEqual([]);
});

test('创建者与接收人能访问，无关成员不能通过页面或 API 获取任务', async ({ page, browser }) => {
  await login(page);
  const task = await createTask(page, '浏览器验收：限定成员可见', '陈一然');
  await page.getByRole('button', { name: '我创建的', exact: true }).click();
  await expect(page.getByRole('row').filter({ hasText: task.title })).toBeVisible();
  const bobContext = await browser.newContext({ baseURL });
  const carolContext = await browser.newContext({ baseURL });
  try {
    const bob = await bobContext.newPage();
    await login(bob, 'chen');
    await expect(bob.getByRole('row').filter({ hasText: task.title })).toBeVisible();
    await bob.getByRole('button', { name: /^通知/ }).click();
    await expect(bob.getByRole('region', { name: '站内通知' }).getByText(task.title, { exact: true })).toBeVisible();
    const carol = await carolContext.newPage();
    await login(carol, 'zhou');
    expect((await carol.request.get(`/api/tasks/${task.id}`)).status()).toBe(404);
    await carol.goto(`/tasks?task=${task.id}`);
    await expect(carol.getByRole('dialog', { name: '任务详情' })).toContainText('任务不存在或你没有查看权限');
    await expect(carol.getByText(task.title, { exact: true })).toHaveCount(0);
  } finally { await bobContext.close(); await carolContext.close(); }
});

test('看板支持拖动和状态菜单，状态变更不清空任务说明及日期', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: '看板视图', exact: true }).click();
  const title = '确认周会讨论议题';
  const handle = page.getByRole('button', { name: `拖动「${title}」`, exact: true });
  const target = page.getByRole('region', { name: '进行中看板列', exact: true });
  await expect(handle).toBeVisible();
  const from = await handle.boundingBox();
  const to = await target.boundingBox();
  await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2);
  await page.mouse.down();
  await page.mouse.move(from!.x + from!.width / 2 + 10, from!.y + from!.height / 2, { steps: 3 });
  await page.mouse.move(to!.x + to!.width / 2, to!.y + 100, { steps: 18 });
  await page.mouse.up();
  await expect(target.getByRole('button', { name: title, exact: true })).toBeVisible();
  await target.getByLabel(`更新「${title}」状态`, { exact: true }).selectOption('done');
  await expect(page.getByRole('region', { name: '已完成看板列', exact: true }).getByRole('button', { name: title, exact: true })).toBeVisible();
  await page.getByRole('button', { name: '列表视图', exact: true }).click();
  const row = page.getByRole('row').filter({ hasText: title });
  await expect(row).toContainText('收集团队需要协调的问题');
  await expect(row).toContainText('今天');
});

test('看板三种状态可拖入归档图标，松手直接归档并可恢复', async ({ page, context }, testInfo) => {
  await login(page);
  const user = (await (await context.request.get('/api/auth/me')).json()).user;
  const tasks: Task[] = [];
  for (const status of ['todo', 'in_progress', 'done'] as const) {
    let task = (await (await context.request.post('/api/tasks', { data: {
      title: `拖放归档验收：${status}`, description: '归档保留说明、截止日期和状态', assigneeId: user.id, dueDate: localDate(),
    } })).json()).task as Task;
    if (status !== 'todo') task = (await (await context.request.patch(`/api/tasks/${task.id}`, { data: { version: task.version, status } })).json()).task;
    tasks.push(task);
  }
  await page.getByRole('button', { name: '看板视图', exact: true }).click();
  await page.getByRole('textbox', { name: '搜索任务', exact: true }).fill('拖放归档验收');
  const cards = page.locator('.board-card');
  const archive = page.getByRole('button', { name: '查看归档任务', exact: true });
  await expect(cards).toHaveCount(3);
  const archiveRequests: string[] = [];
  page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/archive')) archiveRequests.push(request.url()); });
  for (const [index, task] of tasks.entries()) {
    const saved = page.waitForResponse(response => response.url().endsWith(`/tasks/${task.id}/archive`));
    await beginTaskDrag(page, task.title);
    await moveTaskOverArchive(page);
    if (index === 0) await page.screenshot({ path: testInfo.outputPath('board-archive-drop.png'), fullPage: true });
    await page.mouse.up();
    const response = await saved;
    expect(response.status()).toBe(200);
    const result = (await response.json()).task as Task;
    expect(result.archivedAt).not.toBeNull();
    expect(result).toMatchObject({ status: task.status, completedAt: task.completedAt, dueDate: task.dueDate, description: task.description, version: task.version + 1 });
    await expect(cards).toHaveCount(2 - index);
    await expect(archive).toBeEnabled();
    await expect(archive).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(archiveRequests).toHaveLength(index + 1);
  }
  await expect(page.locator('.overview-active strong')).toHaveText('0');
  await archive.click();
  await expect(cards).toHaveCount(3);
  await expect(page.getByRole('button', { name: /^拖动「/ })).toHaveCount(0);
  for (const task of tasks) await expect(page.getByLabel(`更新「${task.title}」状态`, { exact: true })).toBeDisabled();
  await page.getByRole('button', { name: tasks[2].title, exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '任务详情', exact: true });
  await drawer.getByRole('button', { name: '恢复任务', exact: true }).click();
  await expect(drawer).toHaveCount(0);
  await expect(cards).toHaveCount(2);
  await archive.click();
  await expect(cards).toHaveCount(1);
  await expect(page.getByRole('region', { name: '已完成看板列', exact: true }).getByRole('button', { name: tasks[2].title, exact: true })).toBeVisible();
});

test('归档仅在目标内放下才提交，支持取消和键盘拖动', async ({ page }) => {
  await login(page);
  const task = await createTask(page, '归档命中验收');
  await page.getByRole('button', { name: '看板视图', exact: true }).click();
  await page.getByRole('textbox', { name: '搜索任务', exact: true }).fill(task.title);
  await expect(page.locator('.board-card')).toHaveCount(1);
  const archive = page.getByRole('button', { name: '查看归档任务', exact: true });
  const mutations: string[] = [];
  page.on('request', request => { if (request.method() !== 'GET' && request.url().includes(`/api/tasks/${task.id}`)) mutations.push(request.url()); });
  await beginTaskDrag(page, task.title);
  const box = (await archive.boundingBox())!;
  // The card still overlaps the icon here, but the pointer is outside its hit area.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height + 4, { steps: 15 });
  await expect(archive).not.toHaveClass(/drop-active/);
  await page.mouse.up();
  await expect(page.locator('.drag-preview')).toHaveCount(0);
  await beginTaskDrag(page, task.title);
  await moveTaskOverArchive(page);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(page.locator('.drag-preview')).toHaveCount(0);
  for (let attempt = 0; attempt < 5; attempt++) {
    await beginKeyboardTaskDrag(page, task.title);
    await page.keyboard.press('ArrowUp');
    await expect(archive).toHaveClass(/drop-active/);
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('region', { name: '待办看板列', exact: true })).toHaveClass(/drop-active/);
    await page.keyboard.press('Escape');
    await expect(page.locator('.drag-preview')).toHaveCount(0);
  }
  expect((await (await page.request.get(`/api/tasks/${task.id}`)).json()).task).toMatchObject({ version: task.version, archivedAt: null });
  expect(mutations).toHaveLength(0);
  await beginKeyboardTaskDrag(page, task.title);
  await page.keyboard.press('ArrowUp');
  await expect(archive).toHaveClass(/drop-active/);
  await page.keyboard.press('Space');
  await expect(page.locator('.board-card')).toHaveCount(0);
  await expect(archive).toBeFocused();
  expect(mutations).toEqual([`${baseURL}/api/tasks/${task.id}/archive`]);
});

test('拖拽归档失败保留任务，冲突刷新最新版本，请求期间阻止重复提交', async ({ page }) => {
  await login(page);
  const task = await createTask(page, '归档失败验收');
  await page.getByRole('button', { name: '看板视图', exact: true }).click();
  await page.getByRole('textbox', { name: '搜索任务', exact: true }).fill(task.title);
  await expect(page.locator('.board-card')).toHaveCount(1);
  const archive = page.getByRole('button', { name: '查看归档任务', exact: true });
  const handle = page.getByRole('button', { name: `拖动「${task.title}」`, exact: true });
  const url = `${baseURL}/api/tasks/${task.id}/archive`;
  const versions: number[] = [];
  page.on('request', request => { if (request.url() === url && request.method() === 'POST') versions.push(request.postDataJSON().version); });
  await page.route(url, route => route.abort('failed'));
  await dropTaskOnArchive(page, task.title);
  await expect(page.locator('.toast-error')).toContainText('连接暂时中断');
  await expect(handle).toBeEnabled();
  await expect(page.locator('.board-card')).toHaveCount(1);
  await page.unroute(url);

  const updated = (await (await page.request.patch(`/api/tasks/${task.id}`, { data: { version: task.version, description: '并发更新后的最新说明' } })).json()).task as Task;
  const conflict = page.waitForResponse(response => response.url() === url && response.status() === 409);
  await dropTaskOnArchive(page, task.title);
  await conflict;
  await expect(page.locator('.toast-error').last()).toContainText('任务已更新');
  await expect(page.locator('.board-card')).toContainText(updated.description);
  await expect(handle).toBeEnabled();
  expect(versions).toEqual([task.version, task.version]);

  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route(url, async route => { await gate; await route.continue(); });
  try {
    const saved = page.waitForResponse(response => response.url() === url && response.status() === 200);
    await dropTaskOnArchive(page, task.title);
    await expect(archive).toBeDisabled();
    await expect(archive).toHaveAttribute('aria-busy', 'true');
    await expect(handle).toBeDisabled();
    await expect(page.locator('.board-card')).toHaveCount(1);
    await page.keyboard.press('Space');
    expect(versions).toEqual([task.version, task.version, updated.version]);
    release();
    await saved;
    await expect(page.locator('.board-card')).toHaveCount(0);
    await expect(archive).toBeEnabled();
  } finally { release(); await page.unroute(url); }
});

test('共享文字安全展示，HTTP 剪贴板不可用时能手动复制', async ({ page, browser }) => {
  await login(page);
  await page.getByRole('link', { name: '团队共享', exact: true }).click();
  await page.getByRole('button', { name: '发布信息', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '发布共享信息', exact: true });
  const title = '浏览器验收：团队公共说明';
  const content = '<img src=x onerror=alert(1)>\n此处是纯文字。\nhttps://example.com/shared';
  await dialog.getByLabel('标题', { exact: false }).fill(title);
  await dialog.getByLabel('分类', { exact: true }).selectOption({ label: '团队约定' });
  await dialog.getByLabel('共享内容', { exact: false }).fill(content);
  await dialog.getByRole('button', { name: '发布信息', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const article = page.getByRole('article').filter({ hasText: title });
  await expect(article.getByRole('heading', { name: title })).toBeVisible();
  await expect(article.locator('img')).toHaveCount(0);
  await expect(article.getByRole('link', { name: 'https://example.com/shared' })).toHaveAttribute('rel', 'noopener noreferrer');
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, get: () => undefined });
    document.execCommand = () => false;
  });
  await article.getByRole('button', { name: `复制「${title}」` }).click();
  const fallback = page.getByRole('dialog', { name: '复制共享内容' });
  await expect(fallback.getByLabel('待复制内容')).toHaveValue(content);
  await expect.poll(() => fallback.getByLabel('待复制内容').evaluate((element: HTMLTextAreaElement) => element.selectionEnd - element.selectionStart)).toBe(content.length);
  await fallback.getByRole('button', { name: '完成', exact: true }).click();
  const other = await browser.newContext({ baseURL });
  try {
    const bob = await other.newPage(); await login(bob, 'chen');
    await bob.getByRole('link', { name: '团队共享', exact: true }).click();
    await expect(bob.getByRole('heading', { name: title, exact: true })).toBeVisible();
    await expect(bob.getByRole('button', { name: `编辑「${title}」` })).toHaveCount(0);
  } finally { await other.close(); }
});

test('管理员创建成员、首次改密、停用并转交任务', async ({ page, browser }) => {
  await login(page, 'admin');
  await page.getByRole('link', { name: '团队管理', exact: true }).click();
  await page.getByRole('button', { name: '添加成员', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '添加团队成员' });
  await dialog.getByLabel('用户名', { exact: false }).fill('browsermember');
  await dialog.getByLabel('显示姓名', { exact: false }).fill('验收成员');
  await dialog.getByLabel('临时密码', { exact: true }).fill('Temporary-2026!');
  await dialog.getByRole('button', { name: '创建账号' }).click();
  await expect(dialog).not.toBeVisible();
  const memberContext = await browser.newContext({ baseURL });
  try {
    const member = await memberContext.newPage();
    await login(member, 'browsermember', 'Temporary-2026!', true);
    await member.getByLabel('初始密码', { exact: true }).fill('Temporary-2026!');
    await member.getByLabel('新密码', { exact: true }).fill('Personal-password-2026!');
    await member.getByLabel('再次输入新密码', { exact: true }).fill('Personal-password-2026!');
    await member.getByRole('button', { name: '保存新密码' }).click();
    await expect(member.getByRole('heading', { name: '我的任务', exact: true })).toBeVisible();
    await page.getByRole('link', { name: '任务管理', exact: true }).click();
    const task = await createTask(page, '浏览器验收：离开前转交', '验收成员');
    await page.getByRole('link', { name: '团队管理', exact: true }).click();
    await page.getByRole('button', { name: '停用「验收成员」', exact: true }).click();
    const deactivate = page.getByRole('dialog', { name: '停用成员账号' });
    await deactivate.getByLabel('未完成任务的接收人', { exact: false }).selectOption({ label: '陈一然' });
    await deactivate.getByRole('button', { name: '确认停用' }).click();
    await expect(deactivate).not.toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: '验收成员' })).toContainText('已停用');
    const moved = (await (await page.request.get(`/api/tasks/${task.id}`)).json()).task;
    expect(moved.assignee.displayName).toBe('陈一然');
    await member.reload();
    await expect(member.getByRole('heading', { name: '欢迎回来' })).toBeVisible();
  } finally { await memberContext.close(); }
});

test('并发修改提示冲突，保留输入直到主动重新加载', async ({ page, browser }) => {
  await login(page);
  const task = await createTask(page, '浏览器验收：并发修改');
  await page.getByRole('row').filter({ hasText: task.title }).locator('.task-title-button').click();
  const dialog = page.getByRole('dialog', { name: '任务详情' });
  await expect(dialog.getByLabel('任务标题', { exact: false })).toHaveValue(task.title);
  const adminContext = await browser.newContext({ baseURL });
  try {
    const adminPage = await adminContext.newPage(); await login(adminPage, 'admin');
    const changed = await adminPage.request.patch(`/api/tasks/${task.id}`, { data: { version: task.version, title: '另一位成员保存的新标题' } });
    expect(changed.ok()).toBe(true);
    await dialog.getByLabel('任务标题', { exact: false }).fill('尚未保存的输入');
    await dialog.getByRole('button', { name: '保存更改', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('任务已被其他人更新');
    await expect(dialog.getByLabel('任务标题', { exact: false })).toHaveValue('尚未保存的输入');
    await dialog.getByRole('button', { name: '重新加载最新内容' }).click();
    await expect(page.getByRole('dialog', { name: '任务详情' }).getByLabel('任务标题', { exact: false })).toHaveValue('另一位成员保存的新标题');
  } finally { await adminContext.close(); }
});

test('手机布局、键盘导航、减少动效以及无障碍检查', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await login(page);
  await expect(page.getByRole('row').filter({ hasText: '完成本月交付清单初稿' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('mobile-tasks.png'), fullPage: true });
  await page.getByRole('button', { name: '打开导航', exact: true }).click();
  const navigation = page.getByRole('dialog', { name: '导航', exact: true });
  await expect(navigation).toBeVisible();
  await navigation.getByRole('link', { name: '团队共享', exact: true }).click();
  await expect(page.getByRole('heading', { name: '团队共享', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: '发布信息', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '发布共享信息' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '发布共享信息' })).not.toBeVisible();
  const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(accessibility.violations).toEqual([]);
});

test('探索入口支持键盘跳转、角色区分，并保留正在编辑的草稿', async ({ page, browser }) => {
  await login(page);
  await page.keyboard.press('Control+k');
  let explorer = page.getByRole('dialog', { name: '探索工作空间', exact: true });
  await expect(explorer).toBeVisible();
  await expect(explorer.getByRole('option', { name: /^团队管理/ })).toHaveCount(0);
  await expect(explorer.getByRole('option', { name: /^团队任务/ })).toHaveCount(0);
  await page.keyboard.press('ArrowDown');
  await expect(explorer.getByRole('option', { name: /^月度总结/ })).toHaveAttribute('aria-selected', 'true');
  // Check final colors after the dialog opacity and selected option finish animating.
  await explorer.evaluate(async element => { await Promise.all(element.getAnimations({ subtree: true }).map(animation => animation.finished)); });
  const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(accessibility.violations).toEqual([]);
  await explorer.getByRole('combobox', { name: '搜索功能' }).fill('月报');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: '月度总结', exact: true })).toBeVisible();

  await page.getByRole('button', { name: '探索工作空间', exact: true }).click();
  explorer = page.getByRole('dialog', { name: '探索工作空间', exact: true });
  await explorer.getByRole('combobox', { name: '搜索功能' }).fill('发布共享');
  await page.keyboard.press('Enter');
  const editor = page.getByRole('dialog', { name: '发布共享信息', exact: true });
  await expect(editor).toBeVisible();
  await editor.getByLabel('标题', { exact: true }).fill('尚未发布的草稿');
  await page.keyboard.press('Control+k');
  await expect(explorer).not.toBeVisible();
  await expect(editor.getByLabel('标题', { exact: true })).toHaveValue('尚未发布的草稿');
  await editor.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('dialog', { name: '放弃未保存的内容？' }).getByRole('button', { name: '放弃修改' }).click();
  await expect(editor).not.toBeVisible();

  const adminContext = await browser.newContext({ baseURL });
  try {
    const adminPage = await adminContext.newPage();
    await login(adminPage, 'admin');
    await adminPage.keyboard.press('Control+k');
    const adminExplorer = adminPage.getByRole('dialog', { name: '探索工作空间', exact: true });
    await expect(adminExplorer.getByRole('option', { name: /^团队管理/ })).toBeVisible();
    await adminExplorer.getByRole('combobox', { name: '搜索功能' }).fill('成员 账号');
    await adminPage.keyboard.press('Enter');
    await expect(adminPage.getByRole('heading', { name: '团队管理', exact: true })).toBeVisible();
  } finally { await adminContext.close(); }
});

for (const style of ['business', 'minimal', 'tech']) {
  for (const scheme of ['light', 'dark'] as const) {
    test(`登录预览 ${style} / ${scheme} 的桌面、手机与无障碍表现`, async ({ page }, testInfo) => {
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error' && /Content Security Policy/i.test(message.text())) errors.push(message.text()); });
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
      await page.goto(`/login-preview?style=${style}`);
      await expect(page.getByRole('heading', { name: '欢迎回来', exact: true })).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('data-theme', scheme);
      await expect(page.locator('.login-screen')).toHaveAttribute('data-login-style', style);
      await expect(page.getByLabel('用户名', { exact: true })).toBeEditable();
      for (const [device, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]] as const) {
        await page.setViewportSize({ width, height });
        await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: testInfo.outputPath(`login-${style}-${scheme}-${device}.png`), fullPage: true });
        const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
        expect(result.violations).toEqual([]);
      }
      await page.setViewportSize({ width: 320, height: 740 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const brand = await page.locator('.login-brandbar').boundingBox();
      const theme = await page.locator('.login-theme').boundingBox();
      expect(brand!.x + brand!.width).toBeLessThan(theme!.x);
      expect(errors).toEqual([]);
    });
  }
}

test('液态玻璃响应鼠标移动，交互不影响输入，并遵守减少动态效果设置', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/login-preview?style=minimal');
  await page.getByLabel('用户名', { exact: true }).fill('draft-user');
  await page.getByLabel('密码', { exact: true }).fill('still-editing');
  const layout = page.locator('.login-layout');
  const water = page.locator('.liquid-water');
  await expect(water).toBeVisible();
  await expect(page.locator('.liquid-glass-refraction')).toHaveCount(1);
  await page.mouse.move(100, 400, { steps: 8 });
  const firstLight = await layout.evaluate(element => element.style.getPropertyValue('--glass-light-x'));
  await page.mouse.move(1280, 640, { steps: 15 });
  await expect.poll(() => layout.evaluate(element => element.style.getPropertyValue('--glass-light-x'))).not.toBe(firstLight);
  await page.mouse.click(1250, 450);
  await expect(page.getByLabel('用户名', { exact: true })).toHaveValue('draft-user');
  await expect(page.getByLabel('密码', { exact: true })).toHaveValue('still-editing');
  await page.getByRole('button', { name: '显示密码', exact: true }).click();
  await expect(page.getByLabel('密码', { exact: true })).toHaveAttribute('type', 'text');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(() => layout.evaluate(element => element.style.getPropertyValue('--scene-x'))).toBe('');
  const still = await water.evaluate((element: HTMLCanvasElement) => element.toDataURL());
  await page.mouse.move(150, 300, { steps: 10 });
  await page.mouse.click(150, 300);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))));
  expect(await water.evaluate((element: HTMLCanvasElement) => element.toDataURL())).toBe(still);
  await expect(page.getByLabel('用户名', { exact: true })).toHaveValue('draft-user');
  await page.getByRole('navigation', { name: '登录页风格' }).getByRole('button', { name: '商务', exact: true }).click();
  await expect(water).toHaveCount(0);
  await page.getByRole('navigation', { name: '登录页风格' }).getByRole('button', { name: '简约', exact: true }).click();
  await expect(water).toBeVisible();
  await expect(page.getByLabel('用户名', { exact: true })).toHaveValue('draft-user');
});

test('切换登录风格保留输入和错误，预览支持真实登录并保护已登录会话', async ({ page, context }) => {
  await page.goto('/login-preview?style=business');
  await page.getByLabel('用户名', { exact: true }).fill('lin');
  await page.getByLabel('密码', { exact: true }).fill('wrong-password');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('用户名或密码');
  await page.getByRole('button', { name: '显示密码', exact: true }).click();
  for (const label of ['简约', '科技', '商务']) {
    await page.getByRole('navigation', { name: '登录页风格' }).getByRole('button', { name: label, exact: true }).click();
    await expect(page.getByLabel('用户名', { exact: true })).toHaveValue('lin');
    await expect(page.getByLabel('密码', { exact: true })).toHaveValue('wrong-password');
    await expect(page.getByLabel('密码', { exact: true })).toHaveAttribute('type', 'text');
    await expect(page.getByRole('alert')).toContainText('用户名或密码');
  }
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL(/\/tasks$/);
  const before = (await (await context.request.get('/api/auth/me')).json()).user;
  await page.goto('/login-preview?style=tech');
  await expect(page.getByLabel('用户名', { exact: true })).toBeDisabled();
  await page.getByRole('navigation', { name: '登录页风格' }).getByRole('button', { name: '简约', exact: true }).click();
  await page.getByRole('button', { name: '进入工作空间', exact: true }).click();
  await expect(page.getByRole('heading', { name: '我的任务', exact: true })).toBeVisible();
  expect((await (await context.request.get('/api/auth/me')).json()).user.id).toBe(before.id);
});

test('主题跟随系统、保存手动设置，并覆盖全部页面、弹窗和其他标签页', async ({ page, context }, testInfo) => {
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByLabel('主题模式', { exact: true }).selectOption('light');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.getByLabel('主题模式', { exact: true })).toHaveValue('light');
  await login(page, 'admin');
  await page.getByLabel('主题模式', { exact: true }).selectOption('dark');
  for (const [name, path] of [['任务管理', 'tasks'], ['月度总结', 'reports'], ['团队共享', 'shared'], ['团队管理', 'members']]) {
    await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name, exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('.loading-state')).toHaveCount(0);
    const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(result.violations).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`workspace-${path}-dark.png`), fullPage: true });
  }
  await page.getByRole('button', { name: '探索工作空间', exact: true }).click();
  const explorer = page.getByRole('dialog', { name: '探索工作空间', exact: true });
  await expect(explorer).toBeVisible();
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
  await page.keyboard.press('Escape');
  await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '团队共享', exact: true }).click();
  await page.getByRole('button', { name: '发布信息', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '发布共享信息' })).toBeVisible();
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
  await page.keyboard.press('Escape');
  const otherTab = await context.newPage();
  try {
    await otherTab.goto('/tasks');
    await expect(otherTab.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.getByLabel('主题模式', { exact: true }).selectOption('light');
    await expect(otherTab.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.getByLabel('主题模式', { exact: true }).selectOption('system');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.emulateMedia({ colorScheme: 'light' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  } finally { await otherTab.close(); }
});

test('存储不可用时仍能进入登录页和手动切换主题', async ({ page, context }) => {
  await context.addInitScript(() => {
    Storage.prototype.getItem = () => { throw new DOMException('Storage unavailable', 'SecurityError'); };
    Storage.prototype.setItem = () => { throw new DOMException('Storage unavailable', 'SecurityError'); };
  });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByLabel('主题模式', { exact: true }).selectOption('light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await login(page);
  await expect(page.getByRole('heading', { name: '我的任务', exact: true })).toBeVisible();
});

test('范围日历选完即筛选，支持单日、跨月、反向选择及取消半选', async ({ page, context }) => {
  await page.clock.setFixedTime(new Date('2026-10-15T04:00:00Z'));
  await login(page);
  const user = (await (await context.request.get('/api/auth/me')).json()).user;
  for (const [title, dueDate, status] of [
    ['之前', '2026-10-30', 'todo'], ['开始', '2026-10-31', 'in_progress'],
    ['结束', '2026-11-01', 'done'], ['之后', '2026-11-02', 'todo'], ['无日期', null, 'todo'],
  ]) {
    const result = await context.request.post('/api/tasks', { data: { title: `日期验收：${title}`, assigneeId: user.id, dueDate } });
    expect(result.status()).toBe(201);
    if (status !== 'todo') {
      const task = (await result.json()).task as Task;
      expect((await context.request.patch(`/api/tasks/${task.id}`, { data: { status, version: task.version } })).ok()).toBe(true);
    }
  }
  await page.getByRole('textbox', { name: '搜索任务', exact: true }).fill('日期验收');
  const rows = page.getByRole('row').filter({ hasText: '日期验收' });
  await expect(rows).toHaveCount(5);
  const trigger = page.getByRole('button', { name: '按截止日期筛选', exact: true });
  const calendar = page.getByRole('dialog', { name: '截止日期筛选', exact: true });
  await trigger.click();
  await expect(calendar.getByRole('grid')).toHaveCount(2);
  await expect(page.getByRole('button', { name: '应用日期', exact: true })).toHaveCount(0);
  await calendar.getByRole('button', { name: '2026年10月31日', exact: true }).click();
  await expect(rows).toHaveCount(5);
  await calendar.getByRole('button', { name: '2026年11月1日', exact: true }).click();
  await expect(calendar).toHaveCount(0);
  await expect(trigger).toContainText('2026/10/31 – 2026/11/01');
  await expect(rows).toHaveCount(2);
  await expect(page.locator('.overview-active strong')).toHaveText('1');
  await trigger.click();
  await calendar.getByRole('button', { name: '2026年10月30日', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await expect(rows).toHaveCount(2);
  await trigger.click();
  await calendar.getByRole('button', { name: '2026年10月30日', exact: true }).click();
  await page.getByRole('heading', { name: '我的任务', exact: true }).click();
  await expect(calendar).toHaveCount(0);
  await expect(rows).toHaveCount(2);
  await trigger.click();
  await calendar.getByRole('button', { name: '2026年11月1日', exact: true }).click();
  await calendar.getByRole('button', { name: '2026年10月31日', exact: true }).click();
  await expect(rows).toHaveCount(2);
  await page.getByRole('button', { name: '看板视图', exact: true }).click();
  await expect(page.getByRole('region', { name: '进行中看板列' }).getByRole('button', { name: '日期验收：开始', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: '已完成看板列' }).getByRole('button', { name: '日期验收：结束', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '日期验收：之前', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '列表视图', exact: true }).click();
  await trigger.click();
  await calendar.getByRole('button', { name: '2026年11月1日', exact: true }).click();
  await calendar.getByRole('button', { name: '2026年11月1日', exact: true }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText('日期验收：结束');
  await page.getByRole('button', { name: '筛选今天截止的任务', exact: true }).click();
  await expect(trigger).toContainText('今天');
  await page.setViewportSize({ width: 390, height: 844 });
  await trigger.click();
  await expect(calendar.getByRole('grid')).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await calendar.getByRole('button', { name: '清除日期筛选', exact: true }).click();
  await expect(rows).toHaveCount(5);
});

test('今天、本周、本月及原有快捷日期互斥，范围边界与任务结果一致', async ({ page, context }) => {
  const today = localDate();
  const week = calendarRange('week', today), month = calendarRange('month', today);
  await page.clock.setFixedTime(new Date());
  await login(page);
  const user = (await (await context.request.get('/api/auth/me')).json()).user;
  const dates: (string | null)[] = [...new Set([today, week.dueFrom, week.dueTo, addDays(week.dueFrom, -1), addDays(week.dueTo, 1), month.dueFrom, month.dueTo, addDays(month.dueFrom, -1), addDays(month.dueTo, 1)]), null];
  for (const dueDate of dates) {
    expect((await context.request.post('/api/tasks', { data: { title: `快捷日期验收：${dueDate || '无日期'}`, assigneeId: user.id, dueDate } })).status()).toBe(201);
  }
  await page.getByRole('textbox', { name: '搜索任务', exact: true }).fill('快捷日期验收');
  const rows = page.getByRole('row').filter({ hasText: '快捷日期验收' });
  await expect(rows).toHaveCount(dates.length);
  const trigger = page.getByRole('button', { name: '按截止日期筛选', exact: true });
  const calendar = page.getByRole('dialog', { name: '截止日期筛选', exact: true });
  for (const [label, from, to, due] of [
    ['今天', today, today, 'today'], ['本周', week.dueFrom, week.dueTo, ''], ['本月', month.dueFrom, month.dueTo, ''],
    ['未来 7 天', addDays(today, 1), addDays(today, 7), 'upcoming'],
  ]) {
    await trigger.click();
    const response = page.waitForResponse(response => new URL(response.url()).pathname === '/api/tasks' && new URL(response.url()).searchParams.get('q') === '快捷日期验收');
    await calendar.getByRole('button', { name: label, exact: true }).click();
    const url = new URL((await response).url());
    expect(url.searchParams.get('due')).toBe(due || null);
    expect(url.searchParams.get('dueFrom')).toBe(due ? null : from);
    expect(url.searchParams.get('dueTo')).toBe(due ? null : to);
    await expect(calendar).toHaveCount(0);
    await expect(trigger).toContainText(label);
    await expect(rows).toHaveCount(dates.filter(date => date && date >= from && date <= to).length);
  }
  for (const [label, count] of [['已逾期', dates.filter(date => date && date < today).length], ['无截止日期', 1]] as const) {
    await trigger.click();
    await calendar.getByRole('button', { name: label, exact: true }).click();
    await expect(rows).toHaveCount(count);
  }
  await trigger.click();
  await calendar.getByRole('button', { name: '清除日期筛选', exact: true }).click();
  await expect(trigger).toContainText('全部日期');
  await expect(rows).toHaveCount(dates.length);
});

test('范围日历支持键盘跨年选择、手机布局与明暗主题', async ({ page }, testInfo) => {
  await page.clock.setFixedTime(new Date('2026-12-31T04:00:00Z'));
  await login(page);
  const trigger = page.getByRole('button', { name: '按截止日期筛选', exact: true });
  const calendar = page.getByRole('dialog', { name: '截止日期筛选', exact: true });
  await trigger.focus();
  await page.keyboard.press('Enter');
  await expect(calendar.getByRole('button', { name: '2026年12月31日', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowRight');
  await expect(calendar.getByRole('button', { name: '2027年1月1日', exact: true })).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(calendar.getByRole('grid')).toHaveCount(1);
  await expect(calendar.getByRole('button', { name: '2027年1月1日', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(trigger).toContainText('2026/12/31 – 2027/01/01');
  await expect(trigger).toBeFocused();
  for (const theme of ['light', 'dark']) {
    await page.getByLabel('主题模式', { exact: true }).selectOption(theme);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await trigger.click();
      const box = await calendar.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      await expect(calendar.getByRole('grid')).toHaveCount(width === 390 ? 1 : 2);
      const accessibility = await new AxeBuilder({ page }).include('.task-date-popover').withTags(['wcag2a', 'wcag2aa']).analyze();
      expect(accessibility.violations).toEqual([]);
      await page.screenshot({ path: testInfo.outputPath(`date-calendar-${theme}-${width}.png`), fullPage: true });
      await page.keyboard.press('Escape');
    }
  }
});

test('共享发布提醒其他成员，提示只出现一次并跳转完整详情', async ({ page, browser }) => {
  await login(page);
  const receiver = await browser.newContext({ baseURL });
  try {
    const member = await receiver.newPage();
    await member.clock.install();
    const initial = member.waitForResponse(response => response.url().endsWith('/api/notifications'));
    await login(member, 'chen');
    await initial;
    await expect(member.locator('.toast-info')).toHaveCount(0);
    await member.getByRole('link', { name: '团队共享', exact: true }).click();
    await member.getByRole('button', { name: '团队约定', exact: false }).click();
    const content = '这段完整的团队说明需要所有人了解。\n'.repeat(25) + '通知详情最后一行 https://example.com/notice';
    const info = await publishInfo(page, '通知验收：新的共享说明', content);
    await pollNotifications(member);
    const toast = member.locator('.toast-info');
    await expect(toast).toContainText(info.title);
    await expect(page.locator('.toast-info')).toHaveCount(0);
    const notices = async () => (await (await receiver.request.get('/api/notifications')).json()).items as Notification[];
    expect((await notices()).find(item => item.sharedInfoId === info.id)?.readAt).toBeNull();
    await toast.getByRole('button', { name: '关闭提示', exact: true }).click();
    await pollNotifications(member, 20_001);
    await expect(toast).toHaveCount(0);
    expect((await notices()).find(item => item.sharedInfoId === info.id)?.readAt).toBeNull();
    await member.getByRole('button', { name: /^通知/ }).click();
    await member.getByRole('region', { name: '站内通知' }).getByRole('button').filter({ hasText: info.title }).click();
    const detail = member.getByRole('dialog', { name: info.title, exact: true });
    await expect(detail).toBeVisible();
    await expect(detail).toContainText('通知详情最后一行');
    await expect(detail.getByRole('link', { name: 'https://example.com/notice' })).toHaveAttribute('rel', 'noopener noreferrer');
    await expect.poll(async () => (await notices()).find(item => item.sharedInfoId === info.id)?.readAt).not.toBeNull();
    await detail.getByRole('button', { name: '返回共享列表', exact: true }).click();
    await expect(member.locator('.shared-list')).not.toContainText(info.title);
    const next = await publishInfo(page, '通知验收：直接查看', '从弹出提示打开这条内容。');
    await pollNotifications(member);
    await expect(toast).toContainText(next.title);
    await toast.getByRole('button', { name: '查看', exact: true }).click();
    await expect(member.getByRole('dialog', { name: next.title, exact: true })).toBeVisible();
    const reloaded = member.waitForResponse(response => response.url().endsWith('/api/notifications'));
    await member.reload();
    await reloaded;
    await expect(toast).toHaveCount(0);
  } finally { await receiver.close(); }
});

test('共享详情独立于分页，多条通知合并提示，已删除内容提供返回入口', async ({ page, context, browser }) => {
  await login(page);
  const post = async (title: string) => {
    const response = await context.request.post('/api/shared-info', { data: { title, content: `完整内容：${title}`, categoryId: null } });
    expect(response.status()).toBe(201);
    return (await response.json()).info as SharedInfo;
  };
  const old = await post('分页之外的旧共享信息');
  for (let i = 0; i < 21; i++) await post(`后续共享信息 ${i}`);
  const receiver = await browser.newContext({ baseURL });
  try {
    const member = await receiver.newPage();
    await member.clock.install();
    const initial = member.waitForResponse(response => response.url().endsWith('/api/notifications'));
    await login(member, 'chen'); await initial;
    await member.goto(`/shared?info=${old.id}`);
    await expect(member.getByRole('dialog', { name: old.title, exact: true })).toContainText(`完整内容：${old.title}`);
    await expect(member.locator('.shared-list').getByRole('heading', { name: old.title, exact: true })).toHaveCount(0);
    await member.getByRole('button', { name: '返回共享列表', exact: true }).click();
    await expect(member.locator('.toast-info')).toHaveCount(0);
    const first = await post('批量通知：第一条');
    await post('批量通知：第二条');
    await pollNotifications(member);
    await expect(member.locator('.toast-info')).toHaveCount(1);
    await expect(member.locator('.toast-info')).toContainText('2 条新的团队共享信息');
    await member.locator('.toast-info').getByRole('button', { name: '查看通知', exact: true }).click();
    const panel = member.getByRole('region', { name: '站内通知' });
    await expect(panel).toContainText(first.title);
    expect((await context.request.delete(`/api/shared-info/${first.id}`, { data: { version: first.version } })).ok()).toBe(true);
    await panel.getByRole('button').filter({ hasText: first.title }).click();
    const missing = member.getByRole('dialog', { name: '共享信息已删除', exact: true });
    await expect(missing).toContainText('这条共享信息已删除');
    await missing.getByRole('button', { name: '返回共享列表', exact: true }).click();
    await member.getByRole('button', { name: /^通知/ }).click();
    await panel.getByRole('button', { name: '全部标为已读', exact: true }).click();
    await expect(member.getByRole('button', { name: '通知', exact: true })).toBeVisible();
    await pollNotifications(member);
    await expect(member.locator('.toast-info')).toHaveCount(0);
  } finally { await receiver.close(); }
});
