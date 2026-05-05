import type { FastifyInstance } from 'fastify';
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { requireAuth } from '../auth.js';
import { env } from '../env.js';
import { logger } from '../logger.js';
import { getOrFetchSubtitle, SubtitlesQuotaError } from '../services/subtitles/index.js';
import { subtitleCacheKey } from '../services/subtitles/cache-key.js';

const SAFE_FILENAME = /^[a-zA-Z0-9_\-]+\.vtt$/;

const searchSchema = z
  .object({
    type: z.enum(['movie', 'show']),
    tmdb_id: z.coerce.number().int().positive(),
    season: z.coerce.number().int().positive().optional(),
    episode: z.coerce.number().int().positive().optional(),
    lang: z.string().min(2).max(10).default('en'),
  })
  .refine(
    (q) =>
      q.type === 'movie' ? q.season === undefined && q.episode === undefined : q.season !== undefined && q.episode !== undefined,
    { message: 'shows require season+episode; movies must omit them', path: ['season'] },
  );

type SearchQuery = {
  type?: string;
  tmdb_id?: string;
  season?: string;
  episode?: string;
  lang?: string;
};

export async function subtitlesRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: SearchQuery }>('/api/subtitles', async (req, reply) => {
    if (!requireAuth(req, reply)) return;

    const parsed = searchSchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'invalid_query' });
    }
    const q = parsed.data;

    let result;
    try {
      result = await getOrFetchSubtitle({
        tmdbId: q.tmdb_id,
        type: q.type,
        season: q.season,
        episode: q.episode,
        lang: q.lang,
      });
    } catch (err) {
      if (err instanceof SubtitlesQuotaError) {
        return reply.status(503).send({
          error: 'subtitle_quota_exhausted',
          message: 'Subtitle download quota exhausted; try again later.',
        });
      }
      throw err;
    }

    if (!result) {
      return reply.status(404).send({ error: 'no_subtitles_available' });
    }

    const cacheKey = subtitleCacheKey({
      tmdbId: q.tmdb_id,
      type: q.type,
      season: q.season,
      episode: q.episode,
      lang: q.lang,
    });

    return {
      cache_key: cacheKey,
      source: result.source,
      url: `/api/subtitles/file/${cacheKey}.vtt`,
    };
  });

  app.get<{ Params: { filename: string } }>(
    '/api/subtitles/file/:filename',
    async (req, reply) => {
      if (!requireAuth(req, reply)) return;

      const { filename } = req.params;
      if (!SAFE_FILENAME.test(filename)) {
        return reply.status(400).send({ error: 'invalid_filename' });
      }

      const subsDir = path.resolve(env.DATA_DIR, 'subtitles');
      const resolved = path.resolve(subsDir, filename);

      // Defense in depth against `..` traversal: confirm the resolved path is
      // strictly inside subsDir even though SAFE_FILENAME already excludes `/`.
      const rel = path.relative(subsDir, resolved);
      if (rel.startsWith('..') || path.isAbsolute(rel) || rel === '') {
        return reply.status(400).send({ error: 'invalid_filename' });
      }

      if (!existsSync(resolved)) {
        return reply.status(404).send({ error: 'not_found' });
      }

      let size: number;
      try {
        size = statSync(resolved).size;
      } catch (err) {
        logger.warn({ err: (err as Error).message, resolved }, 'stat failed');
        return reply.status(404).send({ error: 'not_found' });
      }

      reply
        .header('Content-Type', 'text/vtt; charset=utf-8')
        .header('Cache-Control', 'public, max-age=86400')
        .header('Content-Length', size);
      return reply.send(createReadStream(resolved));
    },
  );
}
