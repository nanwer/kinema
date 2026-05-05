import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import secureSession from '@fastify/secure-session';
import rateLimit from '@fastify/rate-limit';
import cookie from '@fastify/cookie';
import { z } from 'zod';
import { env } from './env.js';
import { logger } from './logger.js';

declare module '@fastify/secure-session' {
  interface SessionData {
    authed: boolean;
    profileId?: number;
  }
}

// 32-byte key derived from COOKIE_SECRET. We pad/truncate so users don't have
// to generate the exact byte form themselves.
function deriveKey(secret: string): Buffer {
  const buf = Buffer.alloc(32, 0);
  Buffer.from(secret, 'utf8').copy(buf);
  return buf;
}

export async function registerAuth(app: FastifyInstance): Promise<void> {
  await app.register(cookie);
  await app.register(secureSession, {
    key: deriveKey(env.COOKIE_SECRET),
    cookieName: 'stream_session',
    cookie: {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      // Secure-flag cookies are HTTPS-only. Default OFF so the homelab
      // happy-path (plain HTTP on the LAN) works out of the box. Set
      // COOKIE_SECURE=true when serving over HTTPS (reverse proxy / tunnel).
      secure: env.COOKIE_SECURE,
      maxAge: 60 * 60 * 24 * 30, // 30 days
    },
  });

  // Rate limit only on the login endpoint. Other rate limits can be added later.
  await app.register(rateLimit, {
    global: false,
  });

  const loginSchema = z.object({
    password: z.string().min(1),
  });

  app.post(
    '/api/auth/login',
    {
      config: {
        rateLimit: {
          max: 5,
          timeWindow: '15 minutes',
          keyGenerator: (req) => req.ip,
        },
      },
    },
    async (req, reply) => {
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'invalid_body' });
      }
      // Constant-time-ish compare. Length-leak is acceptable for a single shared secret.
      if (!safeEqual(parsed.data.password, env.APP_PASSWORD)) {
        logger.warn({ ip: req.ip }, 'login failed');
        return reply.status(401).send({ error: 'invalid_password' });
      }
      req.session.set('authed', true);
      logger.info({ ip: req.ip }, 'login success');
      return { ok: true };
    },
  );

  app.post('/api/auth/logout', async (req) => {
    req.session.delete();
    return { ok: true };
  });

  app.get('/api/auth/session', async (req) => {
    const authed = req.session.get('authed') === true;
    const profileId = req.session.get('profileId');
    return { authed, profileId: profileId ?? null };
  });

  app.post(
    '/api/auth/profile',
    async (req: FastifyRequest<{ Body: { profileId: number } }>, reply) => {
      if (req.session.get('authed') !== true) {
        return reply.status(401).send({ error: 'unauthorized' });
      }
      const { profileId } = req.body ?? {};
      if (typeof profileId !== 'number' || !Number.isInteger(profileId) || profileId <= 0) {
        return reply.status(400).send({ error: 'invalid_profile' });
      }
      // Verifying the profile actually exists is the route's job in profiles.ts.
      // We just stash the id here; routes that need it will validate.
      req.session.set('profileId', profileId);
      return { ok: true };
    },
  );
}

// Guards for use in protected routes.
export function requireAuth(req: FastifyRequest, reply: FastifyReply): boolean {
  if (req.session.get('authed') !== true) {
    reply.status(401).send({ error: 'unauthorized' });
    return false;
  }
  return true;
}

export function requireProfile(
  req: FastifyRequest,
  reply: FastifyReply,
): number | null {
  if (!requireAuth(req, reply)) return null;
  const id = req.session.get('profileId');
  if (typeof id !== 'number') {
    reply.status(409).send({ error: 'no_profile_selected' });
    return null;
  }
  return id;
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
