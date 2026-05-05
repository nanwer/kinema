// End-to-end auth + profile CRUD test using Fastify's app.inject().
// No real network, no real listening port. The test-setup file gives us a
// fresh DATA_DIR per run so DB state is clean.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/server/app.js';

const PASSWORD = process.env.APP_PASSWORD!;

describe('integration: auth + profiles', () => {
  let app: FastifyInstance;
  let cookie: string | undefined;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects unauthenticated profile listing', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/profiles' });
    expect(r.statusCode).toBe(401);
  });

  it('reports unauthed session before login', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/auth/session' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ authed: false, profileId: null });
  });

  it('rejects wrong password with 401', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { password: 'definitely-wrong' },
    });
    expect(r.statusCode).toBe(401);
  });

  it('accepts correct password and sets a session cookie', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { password: PASSWORD },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ ok: true });
    const setCookie = r.headers['set-cookie'];
    expect(setCookie).toBeTruthy();
    // Set-cookie can be string or string[]; normalize to a single string for reuse.
    cookie = Array.isArray(setCookie) ? setCookie[0] : (setCookie as string);
    expect(cookie).toMatch(/stream_session=/);
  });

  it('reflects authed session after login', async () => {
    const r = await app.inject({
      method: 'GET',
      url: '/api/auth/session',
      headers: { cookie: cookie! },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ authed: true, profileId: null });
  });

  it('starts with an empty profile list', async () => {
    const r = await app.inject({
      method: 'GET',
      url: '/api/profiles',
      headers: { cookie: cookie! },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ profiles: [] });
  });

  it('rejects profile creation without auth', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/profiles',
      payload: { name: 'Stranger' },
    });
    expect(r.statusCode).toBe(401);
  });

  it('rejects empty profile names', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/profiles',
      headers: { cookie: cookie! },
      payload: { name: '   ' },
    });
    expect(r.statusCode).toBe(400);
  });

  let createdId: number;

  it('creates a profile', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/profiles',
      headers: { cookie: cookie! },
      payload: { name: 'Alice' },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.profile).toMatchObject({ name: 'Alice', avatar_url: null });
    expect(typeof body.profile.id).toBe('number');
    createdId = body.profile.id;
  });

  it('lists the created profile', async () => {
    const r = await app.inject({
      method: 'GET',
      url: '/api/profiles',
      headers: { cookie: cookie! },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.profiles).toHaveLength(1);
    expect(body.profiles[0]).toMatchObject({ id: createdId, name: 'Alice' });
  });

  it('updates a profile', async () => {
    const r = await app.inject({
      method: 'PUT',
      url: `/api/profiles/${createdId}`,
      headers: { cookie: cookie! },
      payload: { name: 'Alice Renamed' },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().profile).toMatchObject({ id: createdId, name: 'Alice Renamed' });
  });

  it('selects the profile in the session', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/auth/profile',
      headers: { cookie: cookie! },
      payload: { profileId: createdId },
    });
    expect(r.statusCode).toBe(200);
    // Refresh cookie since secure-session re-issues on every mutation.
    const setCookie = r.headers['set-cookie'];
    if (setCookie) cookie = Array.isArray(setCookie) ? setCookie[0] : (setCookie as string);
    const after = await app.inject({
      method: 'GET',
      url: '/api/auth/session',
      headers: { cookie: cookie! },
    });
    expect(after.json()).toMatchObject({ authed: true, profileId: createdId });
  });

  it('rejects stream/start without tmdb_id or target_id', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/stream/start',
      headers: { cookie: cookie!, 'content-type': 'application/json' },
      payload: {
        target_type: 'movie',
        magnet_uri: 'magnet:?xt=urn:btih:0000000000000000000000000000000000000000',
      },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json()).toEqual({ error: 'invalid_body' });
  });

  it('rejects episode stream/start without season+episode', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/stream/start',
      headers: { cookie: cookie!, 'content-type': 'application/json' },
      payload: {
        target_type: 'episode',
        tmdb_id: 1396,
        magnet_uri: 'magnet:?xt=urn:btih:0000000000000000000000000000000000000000',
      },
    });
    expect(r.statusCode).toBe(400);
  });

  it('deletes the profile', async () => {
    const r = await app.inject({
      method: 'DELETE',
      url: `/api/profiles/${createdId}`,
      headers: { cookie: cookie! },
    });
    expect(r.statusCode).toBe(200);
    const list = await app.inject({
      method: 'GET',
      url: '/api/profiles',
      headers: { cookie: cookie! },
    });
    expect(list.json().profiles).toEqual([]);
  });

  it('logs out and reflects unauthed', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie: cookie! },
    });
    expect(r.statusCode).toBe(200);
    const setCookie = r.headers['set-cookie'];
    if (setCookie) cookie = Array.isArray(setCookie) ? setCookie[0] : (setCookie as string);
    const after = await app.inject({
      method: 'GET',
      url: '/api/auth/session',
      headers: { cookie: cookie! },
    });
    expect(after.json()).toMatchObject({ authed: false });
  });
});
