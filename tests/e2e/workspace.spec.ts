import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { addDays, localDate } from '../../shared/dates.js';
import type { Member, Task } from '../../shared/types.js';

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
