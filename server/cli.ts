import { createInterface } from 'node:readline/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { openDatabase } from './database.js';
import { Store } from './store.js';
import { backupDatabase } from './jobs.js';
import { assertServiceStopped, restoreDatabase } from './maintenance.js';
import { hashPassword } from './security.js';
import { seedDevelopment, DEMO_PASSWORD } from './seed.js';
import { backupDir, databasePath, dataDir, production } from './config.js';

async function secretPrompt(label: string): Promise<string> {
  if (!process.stdin.isTTY) throw new Error('非交互运行时，请通过 ADMIN_PASSWORD 环境变量提供密码。');
  process.stdout.write(label);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  return new Promise((resolveValue, reject) => {
    let value = '';
    const cleanup = () => { process.stdin.off('data', onData); process.stdin.setRawMode(false); process.stdin.pause(); process.stdout.write('\n'); };
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === '\r' || char === '\n') { cleanup(); resolveValue(value); return; }
        if (char === '\u0003') { cleanup(); reject(new Error('已取消。')); return; }
        if (char === '\u007f' || char === '\b') { if (value.length) { value = value.slice(0, -1); process.stdout.write('\b \b'); } }
        else if (char >= ' ') { value += char; process.stdout.write('*'); }
      }
    };
    process.stdin.on('data', onData);
  });
}

async function main() {
  const command = process.argv[2];
  if (command === 'restore') {
    if (!process.argv[3]) throw new Error('用法：npm run restore -- 备份文件路径');
    const result = await restoreDatabase(resolve(process.argv[3]), databasePath);
    console.log('数据库已恢复，所有成员需要重新登录。');
    if (result.previousBackup) console.log(`恢复前数据保存在：${result.previousBackup}`);
    return;
  }
  if (!['seed', 'admin', 'backup'].includes(command)) throw new Error('可用命令：seed、admin、backup、restore。');
  if (command === 'seed' && production) throw new Error('演示初始化仅可在开发环境执行。');
  if (command === 'backup' && !existsSync(databasePath)) throw new Error('数据库不存在，请先初始化账号。');
  if (command === 'seed' || command === 'admin') await assertServiceStopped(dataDir);
  const db = openDatabase(databasePath);
  try {
    const store = new Store(db);
    if (command === 'seed') {
      await seedDevelopment(db);
      console.log('已创建本地演示数据（不会用于服务器交付）。');
      console.log(`账号：admin / lin / chen / zhou，演示密码：${DEMO_PASSWORD}`);
      console.log('admin 是管理员，其余是普通成员。');
    } else if (command === 'backup') {
      console.log(`备份已保存：${await backupDatabase(store, backupDir)}`);
    } else {
      const { n } = db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number };
      if (n) throw new Error('已有账号，请登录后通过成员管理创建账号或重置密码。');
      let username = process.env.ADMIN_USERNAME || '';
      let displayName = process.env.ADMIN_NAME || '';
      if (!username) {
        const prompt = createInterface({ input: process.stdin, output: process.stdout });
        try { username = (await prompt.question('管理员用户名 [admin]：')).trim() || 'admin';
          displayName = (await prompt.question('显示姓名 [管理员]：')).trim() || '管理员'; }
        finally { prompt.close(); }
      }
      displayName ||= '管理员';
      const password = process.env.ADMIN_PASSWORD || await secretPrompt('设置密码（至少 8 位）：');
      if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(username)) throw new Error('用户名需要 3–32 位字母、数字、点、下划线或短横线。');
      if (password.length < 8 || password.length > 128) throw new Error('密码需要 8–128 个字符。');
      if (!displayName.trim() || displayName.length > 40) throw new Error('显示姓名需要 1–40 个字符。');
      store.createUser({ username, displayName, passwordHash: await hashPassword(password), role: 'admin', mustChangePassword: false });
      console.log(`管理员 ${username} 已创建。`);
    }
  } finally { db.close(); }
}
await main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
