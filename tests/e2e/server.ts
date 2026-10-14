import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createApp } from '../../server/app.js';
import { openDatabase } from '../../server/database.js';
import { seedDevelopment } from '../../server/seed.js';

// 仅测试入口拥有重置路由；不会编译进 dist/server，也不使用本地开发数据。
const directory = await mkdtemp(resolve(tmpdir(), 'worksync-e2e-'));
const db = openDatabase(resolve(directory, 'worksync.sqlite'));
const { app } = await createApp({ db, production: true, disableRateLimit: true, publicDir: resolve('dist/public') });
await seedDevelopment(db);
app.post('/__e2e/reset', async () => {
  db.transaction(() => {
    for (const table of ['notifications', 'sessions', 'task_snapshots', 'tasks', 'shared_info', 'shared_categories', 'users', 'app_settings']) db.exec(`DELETE FROM ${table}`);
  })();
  await seedDevelopment(db);
  return { ok: true };
});
app.addHook('onClose', async () => { db.close(); await rm(directory, { recursive: true, force: true }); });
await app.listen({ host: '127.0.0.1', port: 4173 });
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { void app.close().then(() => process.exit(0)); });
