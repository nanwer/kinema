import { env } from '../env.js';
import { logger } from '../logger.js';

type Waiter = {
  sessionId: string;
  resolve: (v: { slot: number; release: () => void }) => void;
};

const active = new Set<string>();
const waiters: Waiter[] = [];

function makeRelease(sessionId: string): () => void {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    active.delete(sessionId);
    pump();
  };
}

function pump(): void {
  while (active.size < env.MAX_CONCURRENT_TRANSCODES && waiters.length > 0) {
    const next = waiters.shift()!;
    active.add(next.sessionId);
    logger.info(
      { sessionId: next.sessionId, active: active.size, max: env.MAX_CONCURRENT_TRANSCODES },
      'transcode slot acquired',
    );
    next.resolve({ slot: 0, release: makeRelease(next.sessionId) });
  }
}

export const transcodeQueue = {
  acquire(sessionId: string): Promise<{ slot: number; release: () => void }> {
    if (active.size < env.MAX_CONCURRENT_TRANSCODES) {
      active.add(sessionId);
      logger.info(
        { sessionId, active: active.size, max: env.MAX_CONCURRENT_TRANSCODES },
        'transcode slot acquired',
      );
      return Promise.resolve({ slot: 0, release: makeRelease(sessionId) });
    }
    return new Promise((resolve) => {
      waiters.push({ sessionId, resolve });
      logger.info(
        { sessionId, queuePosition: waiters.length, max: env.MAX_CONCURRENT_TRANSCODES },
        'transcode queued',
      );
    });
  },
  status(): { activeIds: string[]; queuedIds: string[]; max: number } {
    return {
      activeIds: Array.from(active),
      queuedIds: waiters.map((w) => w.sessionId),
      max: env.MAX_CONCURRENT_TRANSCODES,
    };
  },
};
