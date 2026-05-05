import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createReadStream, existsSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import { requireProfile } from '../auth.js';
import { logger } from '../logger.js';
import { streamSessionsRepo } from '../repos/streamSessions.js';
import { watchRepo } from '../repos/watch.js';
import { torrentEngine, getHandle } from '../services/torrent-engine.js';
import {
  probe,
  decide,
  start as transcodeStart,
  type TranscodeDecision,
  type TranscodeInput,
} from '../services/transcoder.js';
import { transcodeQueue } from '../services/transcode-queue.js';
import { stallDetector } from '../services/stall-detector.js';
import { resolveTarget } from '../services/media-resolver.js';
import { parseRange } from '../lib/range.js';
import type { Pipeline, StreamStartResponse, StreamStatus } from '../../shared/types.js';

type SessionRuntime = {
  decision: TranscodeDecision | null;
  transcoder: { stop: () => Promise<void> } | null;
  release: (() => void) | null;
  queuePosition: number;
  transcodeReady: boolean;
};

const runtimes = new Map<string, SessionRuntime>();

const startSchema = z
  .object({
    magnet_uri: z.string().min(1),
    target_type: z.enum(['movie', 'episode']),
    // tmdb_id is the canonical reference. The backend resolves it to the DB
    // row id (media_items.id for movies, episodes.id for episodes) before
    // writing into watch_state.target_id. Older clients may still send
    // target_id; we accept it as a fallback for backward compat.
    tmdb_id: z.number().int().positive().optional(),
    target_id: z.number().int().positive().optional(),
    season: z.number().int().positive().optional(),
    episode: z.number().int().positive().optional(),
    prefer_direct_play: z.boolean().optional(),
  })
  .refine((v) => v.tmdb_id !== undefined || v.target_id !== undefined, {
    message: 'either tmdb_id or target_id is required',
  })
  .refine(
    (v) => v.target_type === 'movie' || (v.season !== undefined && v.episode !== undefined),
    { message: 'season and episode are required when target_type is episode' },
  );

const heartbeatSchema = z.object({
  position_seconds: z.number().nonnegative(),
  buffer_seconds: z.number().nonnegative().optional(),
});

const SEG_NAME_RE = /^[a-zA-Z0-9_]+\.ts$/;

const VIDEO_MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.webm': 'video/webm',
  '.avi': 'video/x-msvideo',
  '.ts': 'video/mp2t',
};

function mimeFor(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  return VIDEO_MIME[ext] ?? 'application/octet-stream';
}

async function teardownSession(id: string): Promise<void> {
  const rt = runtimes.get(id);
  if (rt) {
    runtimes.delete(id);
    if (rt.transcoder) {
      try {
        await rt.transcoder.stop();
      } catch (err) {
        logger.warn({ sessionId: id, err }, 'transcoder stop failed');
      }
    }
    if (rt.release) {
      try {
        rt.release();
      } catch (err) {
        logger.warn({ sessionId: id, err }, 'queue release failed');
      }
    }
  }
  const handle = getHandle(id);
  if (handle) {
    try {
      await handle.stop();
    } catch (err) {
      logger.warn({ sessionId: id, err }, 'torrent stop failed');
    }
  }
  stallDetector.detach(id);
  streamSessionsRepo.delete(id);
}

function kickoffTranscode(
  sessionId: string,
  decision: TranscodeDecision,
  input: TranscodeInput,
): void {
  void (async () => {
    try {
      const { release } = await transcodeQueue.acquire(sessionId);
      const rt = runtimes.get(sessionId);
      if (!rt) {
        // Session was torn down while we were waiting in the queue.
        release();
        return;
      }
      rt.release = release;
      rt.queuePosition = 0;
      const handle = await transcodeStart(decision, input);
      const stillThere = runtimes.get(sessionId);
      if (!stillThere) {
        await handle.stop();
        release();
        return;
      }
      stillThere.transcoder = handle;
      stillThere.transcodeReady = true;
    } catch (err) {
      logger.error({ sessionId, err }, 'transcode kickoff failed');
    }
  })();
}

export async function streamRoutes(app: FastifyInstance): Promise<void> {
  // sendBeacon defaults to text/plain or application/octet-stream; we don't read the body.
  app.addContentTypeParser(
    ['text/plain', 'application/octet-stream'],
    { parseAs: 'string' },
    (_req, body, done) => {
      done(null, body);
    },
  );

  app.post('/api/stream/start', async (req, reply) => {
    const profileId = requireProfile(req, reply);
    if (profileId === null) return;
    const parsed = startSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'invalid_body' });
    const body = parsed.data;

    // Resolve to a stable DB id. Prefer tmdb_id; fall back to client-provided
    // target_id for backward compat. tmdb_id is required for episodes — without
    // it we can't look up the episode row.
    let targetId: number;
    if (body.tmdb_id !== undefined) {
      try {
        const resolved = await resolveTarget(
          body.target_type === 'movie'
            ? { type: 'movie', tmdbId: body.tmdb_id }
            : {
                type: 'episode',
                tmdbId: body.tmdb_id,
                season: body.season as number,
                episode: body.episode as number,
              },
        );
        targetId = resolved.targetId;
      } catch (err) {
        logger.error({ err, body }, 'failed to resolve stream target');
        return reply.status(404).send({ error: 'target_not_found' });
      }
    } else if (body.target_id !== undefined) {
      targetId = body.target_id;
    } else {
      return reply.status(400).send({ error: 'invalid_body' });
    }

    const sessionId = nanoid();
    streamSessionsRepo.insert({
      id: sessionId,
      profile_id: profileId,
      target_type: body.target_type,
      target_id: targetId,
      magnet_uri: body.magnet_uri,
    });

    runtimes.set(sessionId, {
      decision: null,
      transcoder: null,
      release: null,
      queuePosition: 0,
      transcodeReady: false,
    });

    let handle;
    try {
      handle = await torrentEngine.start({
        sessionId,
        magnetUri: body.magnet_uri,
        pickFor:
          body.season && body.episode ? { season: body.season, episode: body.episode } : undefined,
      });
    } catch (err) {
      logger.error({ sessionId, err }, 'torrent start failed');
      runtimes.delete(sessionId);
      streamSessionsRepo.delete(sessionId);
      return reply.status(502).send({ error: 'torrent_start_failed' });
    }

    streamSessionsRepo.setFilePath(sessionId, handle.filePath);

    let probeResult;
    try {
      probeResult = await probe(handle.filePath);
    } catch (err) {
      logger.error({ sessionId, err }, 'probe failed');
      await handle.stop();
      runtimes.delete(sessionId);
      streamSessionsRepo.delete(sessionId);
      return reply.status(500).send({ error: 'probe_failed' });
    }

    const transcodeInput: TranscodeInput = {
      sessionId,
      filePath: handle.filePath,
      userAgent: String(req.headers['user-agent'] ?? ''),
      burnInOptIn: false,
    };

    let decision: TranscodeDecision;
    try {
      decision = await decide(probeResult, transcodeInput);
    } catch (err) {
      logger.error({ sessionId, err }, 'decide failed');
      await handle.stop();
      runtimes.delete(sessionId);
      streamSessionsRepo.delete(sessionId);
      return reply.status(500).send({ error: 'decide_failed' });
    }

    streamSessionsRepo.setPipeline(sessionId, decision.pipeline);
    const rt = runtimes.get(sessionId);
    if (rt) {
      rt.decision = decision;
      if (decision.pipeline === 'direct') rt.transcodeReady = true;
    }

    stallDetector.attach({
      sessionId,
      getStats: () => {
        const s = handle.stats();
        return { peers: s.peers, downloadBps: s.downloadBps };
      },
    });

    let queued = false;
    let queuePosition = 0;
    if (decision.pipeline !== 'direct') {
      const status = transcodeQueue.status();
      if (status.activeIds.length >= status.max) {
        // We'd be queued: position is current waiters + 1 (our slot once enqueued).
        queued = true;
        queuePosition = status.queuedIds.length + 1;
        if (rt) rt.queuePosition = queuePosition;
      }
      kickoffTranscode(sessionId, decision, transcodeInput);
    }

    const url =
      decision.pipeline === 'direct'
        ? `/api/stream/${sessionId}/file`
        : `/api/stream/${sessionId}/playlist.m3u8`;

    const resp: StreamStartResponse = {
      session_id: sessionId,
      url,
      pipeline: decision.pipeline,
      queued,
      queue_position: queuePosition,
    };
    return resp;
  });

  app.get<{ Params: { id: string } }>('/api/stream/:id/file', async (req, reply) => {
    const profileId = requireProfile(req, reply);
    if (profileId === null) return;
    const id = req.params.id;
    const session = streamSessionsRepo.byId(id);
    if (!session) return reply.status(404).send({ error: 'session_not_found' });
    const handle = getHandle(id);
    if (!handle) return reply.status(404).send({ error: 'handle_not_found' });

    const size = handle.fileSize;
    const rangeHeader = req.headers['range'];
    const parsed = parseRange(typeof rangeHeader === 'string' ? rangeHeader : undefined, size);
    if (parsed === 'invalid') {
      reply.header('Content-Range', `bytes */${size}`);
      return reply.status(416).send({ error: 'range_not_satisfiable' });
    }

    const isRange = parsed !== null;
    const start = isRange ? parsed.start : 0;
    const end = isRange ? parsed.end : size - 1;
    const length = end - start + 1;

    reply.raw.statusCode = isRange ? 206 : 200;
    reply.raw.setHeader('Content-Type', mimeFor(handle.fileName));
    reply.raw.setHeader('Accept-Ranges', 'bytes');
    reply.raw.setHeader('Content-Length', String(length));
    reply.raw.setHeader('Cache-Control', 'no-store');
    if (isRange) {
      reply.raw.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
    }

    let stream: NodeJS.ReadableStream;
    try {
      stream = handle.createReadStream({ start, end });
    } catch (err) {
      logger.warn({ sessionId: id, err }, 'createReadStream failed');
      return reply.status(500).send({ error: 'stream_failed' });
    }

    return new Promise<void>((resolve) => {
      const onError = (err: unknown): void => {
        logger.warn({ sessionId: id, err }, 'file stream error');
        try {
          reply.raw.destroy();
        } catch {
          /* noop */
        }
        resolve();
      };
      stream.on('error', onError);
      reply.raw.on('close', () => resolve());
      stream.pipe(reply.raw);
    });
  });

  app.get<{ Params: { id: string } }>(
    '/api/stream/:id/playlist.m3u8',
    async (req, reply) => {
      const profileId = requireProfile(req, reply);
      if (profileId === null) return;
      const id = req.params.id;
      const session = streamSessionsRepo.byId(id);
      if (!session) return reply.status(404).send({ error: 'session_not_found' });
      const rt = runtimes.get(id);
      if (!rt || !rt.decision || !rt.decision.outputDir) {
        return reply.status(404).send({ error: 'session_not_found' });
      }
      if (!rt.transcodeReady) {
        return reply.status(503).send({ error: 'transcode_pending' });
      }
      const playlistPath = path.join(rt.decision.outputDir, 'playlist.m3u8');
      if (!existsSync(playlistPath)) {
        return reply.status(503).send({ error: 'transcode_pending' });
      }
      reply.header('Content-Type', 'application/vnd.apple.mpegurl');
      reply.header('Cache-Control', 'no-store');
      return reply.send(createReadStream(playlistPath));
    },
  );

  app.get<{ Params: { id: string; seg: string } }>(
    '/api/stream/:id/segments/:seg',
    async (req, reply) => {
      const profileId = requireProfile(req, reply);
      if (profileId === null) return;
      const { id, seg } = req.params;
      if (!SEG_NAME_RE.test(seg)) {
        return reply.status(400).send({ error: 'invalid_segment' });
      }
      const session = streamSessionsRepo.byId(id);
      if (!session) return reply.status(404).send({ error: 'session_not_found' });
      const rt = runtimes.get(id);
      if (!rt || !rt.decision || !rt.decision.outputDir) {
        return reply.status(404).send({ error: 'session_not_found' });
      }
      if (!rt.transcodeReady) {
        return reply.status(503).send({ error: 'transcode_pending' });
      }
      const expectedDir = path.resolve(rt.decision.outputDir);
      const segPath = path.resolve(expectedDir, seg);
      if (!segPath.startsWith(expectedDir + path.sep)) {
        return reply.status(400).send({ error: 'invalid_segment' });
      }
      if (!existsSync(segPath)) {
        return reply.status(404).send({ error: 'segment_not_found' });
      }
      reply.header('Content-Type', 'video/mp2t');
      reply.header('Cache-Control', 'no-store');
      return reply.send(createReadStream(segPath));
    },
  );

  app.post<{ Params: { id: string }; Body: unknown }>(
    '/api/stream/:id/heartbeat',
    async (req, reply) => {
      const profileId = requireProfile(req, reply);
      if (profileId === null) return;
      const id = req.params.id;
      const parsed = heartbeatSchema.safeParse(req.body);
      if (!parsed.success) return reply.status(400).send({ error: 'invalid_body' });
      const session = streamSessionsRepo.byId(id);
      if (!session) return reply.status(404).send({ error: 'session_not_found' });
      streamSessionsRepo.heartbeat(id);
      if (typeof parsed.data.buffer_seconds === 'number') {
        stallDetector.reportBuffer(id, parsed.data.buffer_seconds);
      }
      if (session.target_type === 'movie' || session.target_type === 'episode') {
        watchRepo.upsert({
          profile_id: session.profile_id,
          target_type: session.target_type,
          target_id: session.target_id,
          position_seconds: parsed.data.position_seconds,
          duration_seconds: null,
          completed: false,
        });
      }
      return { ok: true };
    },
  );

  app.get<{ Params: { id: string } }>('/api/stream/:id/status', async (req, reply) => {
    const profileId = requireProfile(req, reply);
    if (profileId === null) return;
    const id = req.params.id;
    const session = streamSessionsRepo.byId(id);
    const rt = runtimes.get(id);
    if (!session) {
      const ended: StreamStatus = {
        session_id: id,
        state: 'ended',
        peers: 0,
        download_kbps: 0,
        buffer_seconds: null,
        pipeline: null,
        queue_position: null,
      };
      return ended;
    }
    const report = stallDetector.report(id);
    const handle = getHandle(id);
    const pipeline: Pipeline | null = session.pipeline;
    const queued = !!rt && !rt.transcodeReady && pipeline !== 'direct' && pipeline !== null;
    let state: StreamStatus['state'];
    if (queued) state = 'queued';
    else if (report) state = report.state;
    else state = 'starting';

    const peers = report?.peers ?? handle?.stats().peers ?? 0;
    const downloadKbps = report?.downloadKbps ?? Math.round((handle?.stats().downloadBps ?? 0) / 1024);
    const status: StreamStatus = {
      session_id: id,
      state,
      peers,
      download_kbps: downloadKbps,
      buffer_seconds: null,
      pipeline,
      queue_position: rt ? rt.queuePosition : null,
    };
    return status;
  });

  const endHandler = async (
    req: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ): Promise<{ ok: true }> => {
    const profileId = requireProfile(req, reply);
    if (profileId === null) return { ok: true };
    const id = req.params.id;
    await teardownSession(id);
    return { ok: true };
  };

  app.post<{ Params: { id: string } }>('/api/stream/:id/end', endHandler);
  app.delete<{ Params: { id: string } }>('/api/stream/:id', endHandler);
}
