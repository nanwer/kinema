import { db } from '../db.js';

const stmts = {
  get: db.prepare<[string], { value: string }>('SELECT value FROM app_settings WHERE key = ?'),
  upsert: db.prepare(
    `INSERT INTO app_settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ),
  del: db.prepare('DELETE FROM app_settings WHERE key = ?'),
  all: db.prepare<[], { key: string; value: string }>('SELECT key, value FROM app_settings'),
};

export const appSettingsRepo = {
  get(key: string): string | undefined {
    return stmts.get.get(key)?.value;
  },
  set(key: string, value: string): void {
    stmts.upsert.run(key, value);
  },
  del(key: string): void {
    stmts.del.run(key);
  },
  all(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const row of stmts.all.all()) {
      out[row.key] = row.value;
    }
    return out;
  },
};
