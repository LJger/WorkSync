import { readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createApp } from './app.js';
import { openDatabase } from './database.js';
import { createJobs } from './jobs.js';
import { backupDir, databasePath, dataDir, host, port, production } from './config.js';

mkdirSync(dataDir, { recursive: true });
const pidPath = resolve(dataDir, 'server.pid');
if (existsSync(pidPath)) {
  const previous = Number(readFileSync(pidPath, 'utf8'));
  let running = false;
  if (Number.isInteger(previous) && previous > 0) {
    try { process.kill(previous, 0); running = true; } catch { /* 已退出的进程 */ }
  }
  if (running) throw new Error('该数据目录已有服务运行，请先停止原服务或选择其他 DATA_DIR。');
}
const db = openDatabase(databasePath);
const { app, store } = await createApp({ db, logger: true, production,
  secureCookie: process.env.COOKIE_SECURE === 'true', appOrigin: process.env.APP_ORIGIN });
let jobs: ReturnType<typeof createJobs> | undefined;
app.addHook('onClose', async () => {
  await jobs?.stop();
  db.close();
  if (existsSync(pidPath) && readFileSync(pidPath, 'utf8').trim() === String(process.pid)) unlinkSync(pidPath);
});
try {
  await app.listen({ host, port });
  writeFileSync(pidPath, String(process.pid), { mode: 0o600 });
  if (process.env.JOBS_DISABLED !== 'true') {
    jobs = createJobs(store, backupDir, error => app.log.error(error));
    await jobs.tick();
  }
} catch (error) {
  app.log.error(error);
  await app.close();
  process.exitCode = 1;
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => {
  void app.close().then(() => process.exit(0));
});
