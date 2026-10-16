import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type Db = Database.Database;
export const SCHEMA_VERSION = 3;

export function openDatabase(filename: string): Db {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
  const db = new Database(filename);
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('journal_mode = WAL');
  const version = db.pragma('user_version', { simple: true }) as number;
  if (version > SCHEMA_VERSION) {
    db.close();
    throw new Error('数据库版本较新，请使用匹配的应用版本。');
  }
  try {
    if (version === 0) initializeDatabase(db);
    if (version < 2) migrateNotifications(db);
    if (version < 3) migrateTaskAssignees(db);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

// Keep the original schema as the first migration, so new and existing databases
// follow exactly the same upgrade path.
function initializeDatabase(db: Db): void {
  db.transaction(() => {
    db.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE COLLATE NOCASE,
        display_name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('admin', 'member')),
        active INTEGER NOT NULL DEFAULT 1,
        must_change_password INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      );
      CREATE TABLE sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id),
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX sessions_user ON sessions(user_id);
      CREATE TABLE tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        creator_id TEXT NOT NULL REFERENCES users(id),
        assignee_id TEXT NOT NULL REFERENCES users(id),
        status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'done')),
        due_date TEXT,
        completed_at TEXT,
        archived_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1
      );
      CREATE INDEX tasks_assignee ON tasks(assignee_id, archived_at, status, due_date);
      CREATE INDEX tasks_creator ON tasks(creator_id, archived_at);
      CREATE TABLE task_snapshots (
        task_id TEXT NOT NULL REFERENCES tasks(id),
        version INTEGER NOT NULL,
        recorded_at TEXT NOT NULL,
        actor_id TEXT NOT NULL REFERENCES users(id),
        payload TEXT NOT NULL,
        PRIMARY KEY (task_id, version)
      );
      CREATE INDEX snapshots_time ON task_snapshots(recorded_at, task_id, version);
      CREATE TABLE notifications (
        id TEXT PRIMARY KEY,
        recipient_id TEXT NOT NULL REFERENCES users(id),
        task_id TEXT NOT NULL REFERENCES tasks(id),
        kind TEXT NOT NULL CHECK (kind IN ('assigned', 'due_soon', 'overdue')),
        message TEXT NOT NULL,
        due_date TEXT,
        dedupe_key TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        read_at TEXT,
        dismissed_at TEXT
      );
      CREATE INDEX notifications_recipient ON notifications(recipient_id, dismissed_at, created_at);
      CREATE TABLE shared_categories (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE COLLATE NOCASE
      );
      CREATE TABLE shared_info (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        author_id TEXT NOT NULL REFERENCES users(id),
        category_id TEXT REFERENCES shared_categories(id) ON DELETE SET NULL,
        pinned INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1
      );
      CREATE INDEX shared_category ON shared_info(category_id, pinned, updated_at);
      CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      PRAGMA user_version = 1;
    `);
  })();
}

function migrateNotifications(db: Db): void {
  db.transaction(() => {
    db.exec(`
      CREATE TABLE notifications_v2 (
        id TEXT PRIMARY KEY,
        recipient_id TEXT NOT NULL REFERENCES users(id),
        task_id TEXT REFERENCES tasks(id),
        shared_info_id TEXT REFERENCES shared_info(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('assigned', 'due_soon', 'overdue', 'shared_published')),
        message TEXT NOT NULL,
        due_date TEXT,
        dedupe_key TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        read_at TEXT,
        dismissed_at TEXT,
        CHECK (
          (kind = 'shared_published' AND shared_info_id IS NOT NULL AND task_id IS NULL) OR
          (kind != 'shared_published' AND task_id IS NOT NULL AND shared_info_id IS NULL)
        )
      );
      INSERT INTO notifications_v2 (id, recipient_id, task_id, kind, message, due_date, dedupe_key, created_at, read_at, dismissed_at)
        SELECT id, recipient_id, task_id, kind, message, due_date, dedupe_key, created_at, read_at, dismissed_at FROM notifications;
      DROP TABLE notifications;
      ALTER TABLE notifications_v2 RENAME TO notifications;
      CREATE INDEX notifications_recipient ON notifications(recipient_id, dismissed_at, created_at);
      CREATE INDEX notifications_shared_info ON notifications(shared_info_id);
      PRAGMA user_version = 2;
    `);
  })();
}

function migrateTaskAssignees(db: Db): void {
  db.transaction(() => {
    db.exec(`
      CREATE TABLE task_assignees (
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id),
        PRIMARY KEY (task_id, user_id)
      );
      INSERT INTO task_assignees (task_id, user_id) SELECT id, assignee_id FROM tasks;
      CREATE INDEX task_assignees_user ON task_assignees(user_id, task_id);
      DROP INDEX tasks_assignee;
      ALTER TABLE tasks DROP COLUMN assignee_id;
      CREATE INDEX tasks_state_due ON tasks(archived_at, status, due_date);
      PRAGMA user_version = 3;
    `);
  })();
}
