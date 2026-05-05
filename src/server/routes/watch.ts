import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireProfile } from '../auth.js';
import { watchRepo } from '../repos/watch.js';
import { db } from '../db.js';

const upsertSchema = z.object({
  target_type: z.enum(['movie', 'episode']),
  target_id: z.number().int().positive(),
  position_seconds: z.number().nonnegative(),
  duration_seconds: z.number().positive().optional(),
  completed: z.boolean().optional(),
});

const continueQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).default(24),
});

type ContinueRow = {
  target_type: 'movie' | 'episode';
  target_id: number;
  position_seconds: number;
  duration_seconds: number | null;
  updated_at: number;
  media_id: number;
  media_tmdb_id: number;
  media_type: 'movie' | 'show';
  media_title: string;
  media_poster_url: string | null;
  media_backdrop_url: string | null;
  ep_season: number | null;
  ep_episode_num: number | null;
  ep_title: string | null;
};

const continueStmt = db.prepare<[number, number], ContinueRow>(`
  SELECT
    ws.target_type      AS target_type,
    ws.target_id        AS target_id,
    ws.position_seconds AS position_seconds,
    ws.duration_seconds AS duration_seconds,
    ws.updated_at       AS updated_at,
    mi.id               AS media_id,
    mi.tmdb_id          AS media_tmdb_id,
    mi.type             AS media_type,
    mi.title            AS media_title,
    mi.poster_url       AS media_poster_url,
    mi.backdrop_url     AS media_backdrop_url,
    e.season            AS ep_season,
    e.episode_num       AS ep_episode_num,
    e.title             AS ep_title
  FROM watch_state ws
  LEFT JOIN episodes e
    ON ws.target_type = 'episode' AND e.id = ws.target_id
  LEFT JOIN media_items mi
    ON mi.id = CASE
      WHEN ws.target_type = 'movie' THEN ws.target_id
      ELSE e.media_item_id
    END
  WHERE ws.profile_id = ?
    AND ws.completed = 0
    AND mi.id IS NOT NULL
  ORDER BY ws.updated_at DESC
  LIMIT ?
`);

export async function watchRoutes(app: FastifyInstance): Promise<void> {
  app.put<{ Body: unknown }>('/api/watch-state', async (req, reply) => {
    const profileId = requireProfile(req, reply);
    if (profileId === null) return;
    const parsed = upsertSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'invalid_body' });
    watchRepo.upsert({
      profile_id: profileId,
      target_type: parsed.data.target_type,
      target_id: parsed.data.target_id,
      position_seconds: parsed.data.position_seconds,
      duration_seconds: parsed.data.duration_seconds ?? null,
      completed: parsed.data.completed ?? false,
    });
    return { ok: true };
  });

  app.get<{ Querystring: { limit?: string } }>(
    '/api/watch-state/continue',
    async (req, reply) => {
      const profileId = requireProfile(req, reply);
      if (profileId === null) return;
      const parsed = continueQuerySchema.safeParse(req.query);
      if (!parsed.success) return reply.status(400).send({ error: 'invalid_query' });
      const rows = continueStmt.all(profileId, parsed.data.limit);
      const items = rows.map((r) => {
        const base = {
          target_type: r.target_type,
          target_id: r.target_id,
          position_seconds: r.position_seconds,
          duration_seconds: r.duration_seconds,
          updated_at: r.updated_at,
          media: {
            tmdb_id: r.media_tmdb_id,
            type: r.media_type,
            title: r.media_title,
            poster_url: r.media_poster_url,
            backdrop_url: r.media_backdrop_url,
          },
        };
        if (
          r.target_type === 'episode' &&
          r.ep_season !== null &&
          r.ep_episode_num !== null
        ) {
          return {
            ...base,
            episode: {
              season: r.ep_season,
              episode_num: r.ep_episode_num,
              title: r.ep_title,
            },
          };
        }
        return base;
      });
      return { items };
    },
  );
}
