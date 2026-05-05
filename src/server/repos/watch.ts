import { db } from '../db.js';

export type WatchUpsert = {
  profile_id: number;
  target_type: 'movie' | 'episode';
  target_id: number;
  position_seconds: number;
  duration_seconds: number | null;
  completed: boolean;
};

export type ContinueWatchingRow = {
  target_type: 'movie' | 'episode';
  target_id: number;
  position_seconds: number;
  duration_seconds: number | null;
  completed: number;
  updated_at: number;
};

const stmts = {
  upsert: db.prepare(`
    INSERT INTO watch_state
      (profile_id, target_type, target_id, position_seconds, duration_seconds, completed, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (profile_id, target_type, target_id) DO UPDATE SET
      position_seconds = excluded.position_seconds,
      duration_seconds = COALESCE(excluded.duration_seconds, watch_state.duration_seconds),
      completed = excluded.completed,
      updated_at = excluded.updated_at
  `),
  get: db.prepare<[number, string, number]>(`
    SELECT * FROM watch_state
    WHERE profile_id = ? AND target_type = ? AND target_id = ?
  `),
  continueList: db.prepare<[number, number]>(`
    SELECT target_type, target_id, position_seconds, duration_seconds, completed, updated_at
    FROM watch_state
    WHERE profile_id = ? AND completed = 0
    ORDER BY updated_at DESC
    LIMIT ?
  `),
};

export const watchRepo = {
  upsert(w: WatchUpsert): void {
    stmts.upsert.run(
      w.profile_id,
      w.target_type,
      w.target_id,
      w.position_seconds,
      w.duration_seconds,
      w.completed ? 1 : 0,
      Date.now(),
    );
  },
  continueWatching(profileId: number, limit = 24): ContinueWatchingRow[] {
    return stmts.continueList.all(profileId, limit) as ContinueWatchingRow[];
  },
};
