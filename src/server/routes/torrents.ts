import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../auth.js';
import { mediaRepo } from '../repos/media.js';
import { searchProwlarr, ProwlarrError } from '../services/prowlarr.js';
import { rankTorrents } from '../services/torrent-ranker.js';
import { getMovie, getShow, TmdbError } from '../services/tmdb.js';
import { logger } from '../logger.js';
import type { MediaType } from '../../shared/types.js';

const querySchema = z
  .object({
    type: z.enum(['movie', 'show']),
    tmdb_id: z.coerce.number().int().positive(),
    season: z.coerce.number().int().positive().optional(),
    episode: z.coerce.number().int().positive().optional(),
    prefer_direct_play: z
      .union([z.boolean(), z.string()])
      .optional()
      .transform((v) => {
        if (v === undefined) return true;
        if (typeof v === 'boolean') return v;
        return v.toLowerCase() !== 'false' && v !== '0';
      }),
  })
  .refine((q) => q.type === 'show' || (q.season === undefined && q.episode === undefined), {
    message: 'season/episode only valid when type=show',
    path: ['season'],
  });

type Query = {
  type?: string;
  tmdb_id?: string;
  season?: string;
  episode?: string;
  prefer_direct_play?: string;
};

async function resolveTitle(tmdbId: number, type: MediaType): Promise<string | null> {
  const cached = mediaRepo.findByTmdb(tmdbId, type);
  if (cached) return cached.title;
  if (type === 'movie') {
    const { item } = await getMovie(tmdbId);
    return item.title;
  }
  const { item } = await getShow(tmdbId);
  return item.title;
}

export async function torrentsRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: Query }>('/api/torrents', async (req, reply) => {
    if (!requireAuth(req, reply)) return;

    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'invalid_query' });
    }
    const q = parsed.data;

    let title: string | null;
    try {
      title = await resolveTitle(q.tmdb_id, q.type);
    } catch (err) {
      if (err instanceof TmdbError) {
        if (err.status === 404) {
          return reply.status(404).send({ error: 'not_found' });
        }
        logger.warn({ err: err.message }, 'tmdb unavailable');
        return reply.status(502).send({ error: 'tmdb_unavailable' });
      }
      throw err;
    }
    if (!title) {
      return reply.status(404).send({ error: 'not_found' });
    }

    let results;
    try {
      results = await searchProwlarr({
        query: title,
        type: q.type === 'show' ? 'tv' : 'movie',
        tmdbId: q.tmdb_id,
        season: q.season,
        episode: q.episode,
      });
    } catch (err) {
      if (err instanceof ProwlarrError) {
        logger.warn({ err: err.message, status: err.status }, 'prowlarr unavailable');
        return reply.status(502).send({ error: 'prowlarr_unavailable' });
      }
      throw err;
    }

    const ranked = rankTorrents(results, { preferDirectPlay: q.prefer_direct_play });
    return { results: ranked };
  });
}
