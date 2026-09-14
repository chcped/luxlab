import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

export function openAccountStore(filename) {
  if (filename !== ':memory:') mkdirSync(path.dirname(path.resolve(filename)), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;');
  const version = db.prepare('PRAGMA user_version').get().user_version;
  if (version > 1) { db.close(); throw new Error('Banco de contas mais recente que este servidor.'); }
  if (version === 0) {
    db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE accounts (
        id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL
      );
      CREATE TABLE login_codes (
        email TEXT PRIMARY KEY, digest TEXT NOT NULL, expires_at INTEGER NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0, sent_at INTEGER NOT NULL,
        window_at INTEGER NOT NULL, sends INTEGER NOT NULL
      );
      CREATE TABLE account_sessions (
        id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL
      );
      CREATE INDEX account_sessions_account ON account_sessions(account_id);
      CREATE TABLE saved_rooms (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, owner_id TEXT NOT NULL REFERENCES accounts(id),
        invite_version TEXT, created_at INTEGER NOT NULL
      );
      CREATE INDEX saved_rooms_owner ON saved_rooms(owner_id);
      CREATE TABLE room_memberships (
        room_id TEXT NOT NULL REFERENCES saved_rooms(id) ON DELETE CASCADE,
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        version TEXT NOT NULL, blocked INTEGER NOT NULL DEFAULT 0 CHECK(blocked IN (0, 1)),
        joined_at INTEGER NOT NULL, PRIMARY KEY(room_id, account_id)
      );
      CREATE INDEX room_memberships_account ON room_memberships(account_id);
      PRAGMA user_version = 1;
      COMMIT;`);
  }
  return {
    get: (sql, ...args) => db.prepare(sql).get(...args),
    all: (sql, ...args) => db.prepare(sql).all(...args),
    run: (sql, ...args) => db.prepare(sql).run(...args),
    transaction(fn) {
      db.exec('BEGIN IMMEDIATE');
      try { const value = fn(); db.exec('COMMIT'); return value; }
      catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    close: () => db.close()
  };
}
