import { db } from '../db.js';
import type { Profile } from '../../shared/types.js';

const stmts = {
  list: db.prepare<[], Profile>(
    'SELECT id, name, avatar_url, created_at FROM profiles ORDER BY id ASC',
  ),
  byId: db.prepare<[number], Profile>(
    'SELECT id, name, avatar_url, created_at FROM profiles WHERE id = ?',
  ),
  insert: db.prepare(
    'INSERT INTO profiles (name, avatar_url, created_at) VALUES (?, ?, ?)',
  ),
  update: db.prepare(
    'UPDATE profiles SET name = ?, avatar_url = ? WHERE id = ?',
  ),
  delete: db.prepare('DELETE FROM profiles WHERE id = ?'),
};

export const profilesRepo = {
  list(): Profile[] {
    return stmts.list.all();
  },
  byId(id: number): Profile | undefined {
    return stmts.byId.get(id);
  },
  create(name: string, avatarUrl: string | null): Profile {
    const r = stmts.insert.run(name, avatarUrl, Date.now());
    const created = stmts.byId.get(Number(r.lastInsertRowid));
    if (!created) throw new Error('failed to read created profile');
    return created;
  },
  update(id: number, name: string, avatarUrl: string | null): Profile | undefined {
    stmts.update.run(name, avatarUrl, id);
    return stmts.byId.get(id);
  },
  delete(id: number): void {
    stmts.delete.run(id);
  },
};
