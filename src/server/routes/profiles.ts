import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../auth.js';
import { profilesRepo } from '../repos/profiles.js';

const upsertSchema = z.object({
  name: z.string().trim().min(1).max(64),
  avatar_url: z.string().url().nullable().optional(),
});

export async function profilesRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/profiles', async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    return { profiles: profilesRepo.list() };
  });

  app.post('/api/profiles', async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    const parsed = upsertSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'invalid_body' });
    return { profile: profilesRepo.create(parsed.data.name, parsed.data.avatar_url ?? null) };
  });

  app.put<{ Params: { id: string } }>('/api/profiles/:id', async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return reply.status(400).send({ error: 'invalid_id' });
    const parsed = upsertSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'invalid_body' });
    const existing = profilesRepo.byId(id);
    if (!existing) return reply.status(404).send({ error: 'not_found' });
    return { profile: profilesRepo.update(id, parsed.data.name, parsed.data.avatar_url ?? null) };
  });

  app.delete<{ Params: { id: string } }>('/api/profiles/:id', async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return reply.status(400).send({ error: 'invalid_id' });
    profilesRepo.delete(id);
    return { ok: true };
  });
}
