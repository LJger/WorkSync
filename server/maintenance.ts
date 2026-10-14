import Database from 'better-sqlite3';
import { copyFile, mkdir, rename, rm, readFile, access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { SCHEMA_VERSION } from './database.js';

export async function assertServiceStopped(directory: string): Promise<void> {
  let pid: number;
  try { pid = Number(await readFile(resolve(directory, 'server.pid'), 'utf8')); }
  catch { return; }
  if (!Number.isInteger(pid) || pid <= 0) return;
  let running = false;
  try { process.kill(pid, 0); running = true; } catch { /* 陈旧 pid 文件 */ }
  if (running) throw new Error('请先停止使用这个数据目录的服务，再进行此操作。');
}

export async function restoreDatabase(source: string, destination: string): Promise<{ previousBackup: string | null }> {
  if (resolve(source) === resolve(destination)) throw new Error('备份源文件不能是当前数据库。');
  await assertServiceStopped(dirname(destination));
  const validation = new Database(source, { readonly: true, fileMustExist: true });
  try {
    if (validation.pragma('quick_check', { simple: true }) !== 'ok') throw new Error('备份完整性检查未通过。');
    if (validation.pragma('user_version', { simple: true }) !== SCHEMA_VERSION) throw new Error('备份版本与当前应用不匹配。');
    validation.prepare('SELECT id FROM users LIMIT 1').get();
    validation.prepare('SELECT payload FROM task_snapshots LIMIT 1').get();
  } finally { validation.close(); }
  await mkdir(dirname(destination), { recursive: true });
  const temporary = `${destination}.restore-${process.pid}`;
  let previousBackup: string | null = null;
  try {
    await copyFile(source, temporary);
    // 恢复后的会话一律失效，避免重新启用备份中的旧登录凭据。
    const restored = new Database(temporary);
    try { restored.prepare('DELETE FROM sessions').run(); restored.pragma('wal_checkpoint(TRUNCATE)'); }
    finally { restored.close(); }
    let exists = false;
    try { await access(destination); exists = true; } catch { /* 首次恢复 */ }
    if (exists) {
      const dir = resolve(dirname(destination), 'backups');
      await mkdir(dir, { recursive: true });
      previousBackup = resolve(dir, `pre-restore-${Date.now()}.sqlite`);
      const previous = new Database(destination, { fileMustExist: true });
      try { await previous.backup(previousBackup); } finally { previous.close(); }
    }
    await rm(`${destination}-wal`, { force: true });
    await rm(`${destination}-shm`, { force: true });
    await rename(temporary, destination);
    return { previousBackup };
  } finally {
    await rm(temporary, { force: true });
    await rm(`${temporary}-wal`, { force: true });
    await rm(`${temporary}-shm`, { force: true });
  }
}
