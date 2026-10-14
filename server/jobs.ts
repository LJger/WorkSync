import { mkdir, readdir, unlink, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Store } from './store.js';
import { localDate } from '../shared/dates.js';

export async function backupDatabase(store: Store, directory: string): Promise<string> {
  await mkdir(directory, { recursive: true });
  const stamp = store.now().replace(/[-:]/g, '').replace('T', '-').replace(/\.\d+Z$/, '');
  const name = `worksync-${stamp}-${Math.random().toString(36).slice(2, 6)}.sqlite`;
  const temporary = resolve(directory, `${name}.partial`);
  const path = resolve(directory, name);
  try {
    await store.db.backup(temporary);
    const { rename } = await import('node:fs/promises');
    await rename(temporary, path);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
  const files = (await readdir(directory)).filter(file => /^worksync-.*\.sqlite$/.test(file));
  const times = await Promise.all(files.map(async file => ({ file, time: (await stat(resolve(directory, file))).mtimeMs })));
  times.sort((a, b) => b.time - a.time || b.file.localeCompare(a.file));
  for (const old of times.slice(7)) await unlink(resolve(directory, old.file));
  store.db.prepare("INSERT INTO app_settings (key,value) VALUES ('last_backup_date',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .run(localDate(store.clock()));
  return path;
}

export function createJobs(store: Store, directory: string, onError: (error: unknown) => void) {
  let backupRunning: Promise<string> | null = null;
  async function tick(): Promise<void> {
    try {
      store.processReminders();
      const day = store.today();
      const hour = new Date(store.clock().getTime() + 8 * 3600000).getUTCHours();
      const last = store.db.prepare("SELECT value FROM app_settings WHERE key='last_backup_date'").get() as { value: string } | undefined;
      if (hour >= 3 && last?.value !== day && !backupRunning) {
        backupRunning = backupDatabase(store, directory);
        try { await backupRunning; } finally { backupRunning = null; }
      }
    } catch (error) { onError(error); }
  }
  const interval = setInterval(() => { void tick(); }, 60_000);
  interval.unref();
  return {
    tick,
    async stop() { clearInterval(interval); if (backupRunning) await backupRunning.catch(() => {}); },
  };
}
