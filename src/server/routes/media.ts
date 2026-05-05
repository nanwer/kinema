import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../auth.js';
import { mediaRepo } from '../repos/media.js';
import { getMovie, getShow, TmdbError } from '../services/tmdb.js';
import { db } from '../db.js';
import type { MediaType } from '../../shared/types.js';

const paramsSchema = z.object({
  type: z.enum(['movie', 'show']),
  tmdbId: z.coerce.number().int().positive(),
});

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const fetchedAtStmt = db.prepare<[number, MediaType], { fetched_at: number }>(
  'SELECT fetched_at FROM media_items WHERE tmdb_id = ? AND type = ?',
);

function isFresh(tmdbId: number, type: MediaType): boolean {
  const row = fetchedAtStmt.get(tmdbId, type);
  if (!row) return false;
  return Date.now() - row.fetched_at < CACHE_TTL_MS;
}

export async function mediaRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { type: string; tmdbId: string } }>(
    '/api/media/:type/:tmdbId',
    async (req, reply) => {
      if (!requireAuth(req, reply)) return;
      const parsed = paramsSchema.safeParse(req.params);
      if (!parsed.success) return reply.status(400).send({ error: 'invalid_params' });
      const { type, tmdbId } = parsed.data;

      const cached = mediaRepo.findByTmdb(tmdbId, type);
      if (cached && isFresh(tmdbId, type)) {
        if (type === 'show') {
          return { item: cached, episodes: mediaRepo.episodesByShow(cached.id) };
        }
        return { item: cached };
      }

      try {
        if (type === 'movie') {
          const { item, metadata } = await getMovie(tmdbId);
          const id = mediaRepo.upsertMovie(item, JSON.stringify(metadata));
          return { item: { id, ...item } };
        }
        const { item, metadata, episodes } = await getShow(tmdbId);
        const id = mediaRepo.upsertShow(item, JSON.stringify(metadata), episodes);
        return { item: { id, ...item }, episodes: mediaRepo.episodesByShow(id) };
      } catch (err) {
        if (err instanceof TmdbError) {
          req.log.warn({ err: err.message, status: err.status }, 'tmdb fetch failed');
          if (cached) {
            if (type === 'show') {
              return { item: cached, episodes: mediaRepo.episodesByShow(cached.id) };
            }
            return { item: cached };
          }
          return reply.status(502).send({ error: 'tmdb_unavailable' });
        }
        throw err;
      }
    },
  );
}
