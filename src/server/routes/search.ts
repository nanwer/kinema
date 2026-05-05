import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../auth.js';
import { searchMulti, TmdbError } from '../services/tmdb.js';

const querySchema = z.object({
  q: z.string().trim().min(1).max(200),
});

export async function searchRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { q?: string } }>('/api/search', async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) return reply.status(400).send({ error: 'invalid_query' });
    try {
      const results = await searchMulti(parsed.data.q);
      return { results };
    } catch (err) {
      if (err instanceof TmdbError) {
        req.log.warn({ err: err.message, status: err.status }, 'tmdb search failed');
        return reply.status(502).send({ error: 'tmdb_unavailable' });
      }
      throw err;
    }
  });
}
