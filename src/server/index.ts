// Production entrypoint. Builds the app, starts the cleaner, listens, and
// owns shutdown signal handling. Tests should import from `./app.js` instead.

import { env } from './env.js';
import { buildApp } from './app.js';
import { startSessionCleaner } from './services/session-cleaner.js';

const app = await buildApp();
const stopCleaner = startSessionCleaner({});

// Graceful shutdown: stop accepting new requests, drain in-flight, tear down
// every active torrent + ffmpeg process, close the DB. Idempotent across
// repeated signals. Deadline-bounded so stuck handles can't pin the container.
const SHUTDOWN_DEADLINE_MS = 15_000;
let shuttingDown = false;
async function shutdown(reason: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ reason }, 'shutdown beginning');
  const deadline = setTimeout(() => {
    app.log.error({ reason }, 'shutdown deadline exceeded; force-exiting');
    process.exit(1);
  }, SHUTDOWN_DEADLINE_MS);
  deadline.unref();

  try {
    stopCleaner();
  } catch (err) {
    app.log.warn({ err }, 'session-cleaner stop failed');
  }
  try {
    const { getActiveSessions, getHandle } = await import('./services/torrent-engine.js');
    const ids = getActiveSessions();
    app.log.info({ count: ids.length }, 'tearing down active torrent sessions');
    await Promise.allSettled(ids.map(async (id) => getHandle(id)?.stop()));
  } catch (err) {
    app.log.warn({ err }, 'torrent teardown errored');
  }
  try {
    await app.close();
  } catch (err) {
    app.log.warn({ err }, 'fastify close errored');
  }
  try {
    const { db } = await import('./db.js');
    db.close();
  } catch (err) {
    app.log.warn({ err }, 'db close errored');
  }
  clearTimeout(deadline);
  app.log.info({ reason }, 'shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

// Process-level safety nets: log + crash. Exiting on these is the standard
// Node policy — the process is in an unknown state after an unhandled error.
process.on('uncaughtException', (err) => {
  app.log.fatal({ err }, 'uncaughtException');
  void shutdown('uncaughtException');
});
process.on('unhandledRejection', (reason) => {
  app.log.fatal({ reason }, 'unhandledRejection');
  void shutdown('unhandledRejection');
});

try {
  await app.listen({ host: '0.0.0.0', port: env.PORT });
  app.log.info({ port: env.PORT }, 'server ready');
} catch (err) {
  app.log.error(err, 'failed to start');
  process.exit(1);
}
