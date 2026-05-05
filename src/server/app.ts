// Fastify app factory: builds + registers routes but does NOT call .listen().
// Used by both the production entrypoint (index.ts) and integration tests.

import Fastify, { type FastifyInstance } from 'fastify';
import staticPlugin from '@fastify/static';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { env } from './env.js';
import './db.js';
import { registerAuth } from './auth.js';
import { profilesRoutes } from './routes/profiles.js';
import { searchRoutes } from './routes/search.js';
import { mediaRoutes } from './routes/media.js';
import { watchRoutes } from './routes/watch.js';
import { settingsRoutes } from './routes/settings.js';
import { torrentsRoutes } from './routes/torrents.js';
import { subtitlesRoutes } from './routes/subtitles.js';
import { streamRoutes } from './routes/stream.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: env.NODE_ENV === 'production' ? 'info' : env.NODE_ENV === 'test' ? 'silent' : 'debug',
      ...(env.NODE_ENV === 'development'
        ? {
            transport: {
              target: 'pino-pretty',
              options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' },
            },
          }
        : {}),
    },
    trustProxy: true,
    bodyLimit: 5 * 1024 * 1024,
  });

  app.get('/api/health', async () => ({
    ok: true,
    ts: Date.now(),
    env: env.NODE_ENV,
  }));

  await registerAuth(app);
  await app.register(profilesRoutes);
  await app.register(searchRoutes);
  await app.register(mediaRoutes);
  await app.register(watchRoutes);
  await app.register(settingsRoutes);
  await app.register(torrentsRoutes);
  await app.register(subtitlesRoutes);
  await app.register(streamRoutes);

  if (env.NODE_ENV === 'production') {
    const webRoot = path.resolve(__dirname, '../web');
    if (existsSync(webRoot)) {
      await app.register(staticPlugin, {
        root: webRoot,
        prefix: '/',
        // decorateReply must be true for `reply.sendFile()` to be available
        // on the SPA fallback path below.
      });
      app.setNotFoundHandler((req, reply) => {
        if (req.method === 'GET' && !req.url.startsWith('/api')) {
          return reply.sendFile('index.html');
        }
        return reply.status(404).send({ error: 'not_found' });
      });
    } else {
      app.log.warn({ webRoot }, 'web build not found; running API-only');
    }
  }

  return app;
}
