import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../auth.js';
import { appSettingsRepo } from '../repos/appSettings.js';
import { env } from '../env.js';

const ALLOWED_KEYS = ['default_subtitle_language', 'prowlarr_ui_url'] as const;
type AllowedKey = (typeof ALLOWED_KEYS)[number];

const keySchema = z.object({
  key: z.enum(ALLOWED_KEYS),
});

const valueSchema = z.object({
  value: z.string().min(1).max(2048),
});

function isAllowedKey(k: string): k is AllowedKey {
  return (ALLOWED_KEYS as readonly string[]).includes(k);
}

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/settings', async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    return {
      settings: appSettingsRepo.all(),
      env_status: {
        tmdb: Boolean(env.TMDB_API_KEY),
        prowlarr: Boolean(env.PROWLARR_API_KEY),
        opensubtitles: Boolean(
          env.OPENSUBS_API_KEY && env.OPENSUBS_USERNAME && env.OPENSUBS_PASSWORD,
        ),
        subdl: Boolean(env.SUBDL_API_KEY),
      },
    };
  });

  app.put<{ Params: { key: string }; Body: unknown }>(
    '/api/settings/:key',
    async (req, reply) => {
      if (!requireAuth(req, reply)) return;
      if (!isAllowedKey(req.params.key)) {
        return reply.status(400).send({ error: 'invalid_key' });
      }
      const parsedKey = keySchema.safeParse(req.params);
      if (!parsedKey.success) return reply.status(400).send({ error: 'invalid_key' });
      const parsedBody = valueSchema.safeParse(req.body);
      if (!parsedBody.success) return reply.status(400).send({ error: 'invalid_body' });
      appSettingsRepo.set(parsedKey.data.key, parsedBody.data.value);
      return { ok: true };
    },
  );

  app.delete<{ Params: { key: string } }>('/api/settings/:key', async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    if (!isAllowedKey(req.params.key)) {
      return reply.status(400).send({ error: 'invalid_key' });
    }
    const parsedKey = keySchema.safeParse(req.params);
    if (!parsedKey.success) return reply.status(400).send({ error: 'invalid_key' });
    appSettingsRepo.del(parsedKey.data.key);
    return { ok: true };
  });
}
