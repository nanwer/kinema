import { logger } from '../logger.js';
import { streamSessionsRepo } from '../repos/streamSessions.js';
import { stallDetector } from './stall-detector.js';

export function startSessionCleaner(opts: {
  intervalMs?: number;
  staleThresholdMs?: number;
}): () => void {
  const intervalMs = opts.intervalMs ?? 30_000;
  const staleThresholdMs = opts.staleThresholdMs ?? 120_000;

  let running = false;

  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      const stale = streamSessionsRepo.staleIds(staleThresholdMs);
      if (stale.length === 0) return;

      // Lazy-load torrent-engine to avoid a circular dep at module init time.
      type GetHandleFn = (id: string) => { stop: () => Promise<void> | void } | undefined;
      let getHandle: GetHandleFn | null = null;
      try {
        const mod = await import('./torrent-engine.js');
        getHandle = mod.getHandle as unknown as GetHandleFn;
      } catch (err) {
        logger.warn({ err }, 'session-cleaner: torrent-engine not loadable yet');
      }

      let reaped = 0;
      for (const id of stale) {
        try {
          const handle = getHandle?.(id);
          if (handle) await Promise.resolve(handle.stop());
          stallDetector.detach(id);
          streamSessionsRepo.delete(id);
          reaped += 1;
        } catch (err) {
          logger.warn({ sessionId: id, err }, 'session-cleaner: failed to reap session');
        }
      }
      logger.info({ reaped, threshold_ms: staleThresholdMs }, 'session-cleaner reaped stale sessions');
    } catch (err) {
      logger.error({ err }, 'session-cleaner tick failed');
    } finally {
      running = false;
    }
  };

  const handle = setInterval(() => {
    void tick();
  }, intervalMs);

  return () => {
    clearInterval(handle);
  };
}
