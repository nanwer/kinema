import { db } from '../db.js';
import type { Pipeline } from '../../shared/types.js';

export type StreamSessionRow = {
  id: string;
  profile_id: number;
  target_type: string;
  target_id: number;
  magnet_uri: string;
  file_path: string | null;
  pipeline: Pipeline | null;
  created_at: number;
  last_heartbeat_at: number;
};

export type InsertStreamSession = {
  id: string;
  profile_id: number;
  target_type: string;
  target_id: number;
  magnet_uri: string;
  file_path?: string | null;
  pipeline?: Pipeline | null;
  created_at?: number;
  last_heartbeat_at?: number;
};

const stmts = {
  insert: db.prepare(
    `INSERT INTO stream_sessions
       (id, profile_id, target_type, target_id, magnet_uri, file_path, pipeline, created_at, last_heartbeat_at)
     VALUES (@id, @profile_id, @target_type, @target_id, @magnet_uri, @file_path, @pipeline, @created_at, @last_heartbeat_at)`,
  ),
  setPipeline: db.prepare('UPDATE stream_sessions SET pipeline = ? WHERE id = ?'),
  setFilePath: db.prepare('UPDATE stream_sessions SET file_path = ? WHERE id = ?'),
  heartbeat: db.prepare('UPDATE stream_sessions SET last_heartbeat_at = ? WHERE id = ?'),
  byId: db.prepare<[string], StreamSessionRow>(
    `SELECT id, profile_id, target_type, target_id, magnet_uri, file_path, pipeline, created_at, last_heartbeat_at
       FROM stream_sessions WHERE id = ?`,
  ),
  delete: db.prepare('DELETE FROM stream_sessions WHERE id = ?'),
  staleIds: db.prepare<[number], { id: string }>(
    'SELECT id FROM stream_sessions WHERE last_heartbeat_at < ?',
  ),
};

export const streamSessionsRepo = {
  insert(row: InsertStreamSession): void {
    const now = Date.now();
    stmts.insert.run({
      id: row.id,
      profile_id: row.profile_id,
      target_type: row.target_type,
      target_id: row.target_id,
      magnet_uri: row.magnet_uri,
      file_path: row.file_path ?? null,
      pipeline: row.pipeline ?? null,
      created_at: row.created_at ?? now,
      last_heartbeat_at: row.last_heartbeat_at ?? now,
    });
  },
  setPipeline(id: string, pipeline: Pipeline | null): void {
    stmts.setPipeline.run(pipeline, id);
  },
  setFilePath(id: string, filePath: string | null): void {
    stmts.setFilePath.run(filePath, id);
  },
  heartbeat(id: string): void {
    stmts.heartbeat.run(Date.now(), id);
  },
  byId(id: string): StreamSessionRow | undefined {
    return stmts.byId.get(id);
  },
  delete(id: string): void {
    stmts.delete.run(id);
  },
  staleIds(thresholdMs: number): string[] {
    const cutoff = Date.now() - thresholdMs;
    return stmts.staleIds.all(cutoff).map((r) => r.id);
  },
};
