import 'dotenv/config';
import { resolve } from 'node:path';

export const production = process.env.NODE_ENV === 'production' ||
  (import.meta.url.endsWith('.js') && process.env.NODE_ENV !== 'development');
export const dataDir = resolve(process.env.DATA_DIR || (production ? 'data/production' : 'data/dev'));
export const databasePath = resolve(dataDir, 'worksync.sqlite');
export const backupDir = resolve(process.env.BACKUP_DIR || resolve(dataDir, 'backups'));
export const host = process.env.HOST || '127.0.0.1';
export const port = Number(process.env.PORT || 3000);
