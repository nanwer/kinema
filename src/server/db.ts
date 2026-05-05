import Database from 'better-sqlite3';
import { readdirSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from './env.js';
import { logger } from './logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Resolve migrations directory: in dev tsx runs from src/server, in prod from dist/server.
const candidatePaths = [
  path.resolve(__dirname, '../../migrations'),
  path.resolve(__dirname, '../../../migrations'),
  path.resolve(process.cwd(), 'migrations'),
];

function findMigrationsDir(): string {
  for (const p of candidatePaths) {
    if (existsSync(p)) return p;
  }
  throw new Error(`migrations/ not found. Tried: ${candidatePaths.join(', ')}`);
}

if (!existsSync(env.DATA_DIR)) {
  mkdirSync(env.DATA_DIR, { recursive: true });
}

const dbPath = path.join(env.DATA_DIR, 'db.sqlite');
export const db = new Database(dbPath);

// Durability + concurrency tuning for a home server.
// WAL: writers don't block readers; survives mid-write power loss.
// synchronous=NORMAL: fsync on checkpoints, not every commit. Good tradeoff for our scale.
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('foreign_keys = ON');

// Migration runner: applies any *.sql in migrations/ that hasn't been recorded.
// Names are tracked in a meta table so reapplying is safe.
function runMigrations(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `);

  const migrationsDir = findMigrationsDir();
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const applied = new Set(
    db.prepare('SELECT name FROM schema_migrations').all().map((r: any) => r.name as string),
  );

  const insertApplied = db.prepare(
    'INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)',
  );

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(path.join(migrationsDir, file), 'utf8');
    const tx = db.transaction(() => {
      db.exec(sql);
      insertApplied.run(file, Date.now());
    });
    tx();
    logger.info({ migration: file }, 'applied migration');
  }
}

runMigrations();

// Hot backup helper. Useful before risky migrations or on a schedule.
export async function backup(targetPath?: string): Promise<string> {
  const target = targetPath ?? path.join(env.DATA_DIR, 'db-backup.sqlite');
  await db.backup(target);
  return target;
}
