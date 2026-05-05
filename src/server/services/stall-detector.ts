import { logger } from '../logger.js';

export interface StallReport {
  state: 'starting' | 'playing' | 'degraded';
  downloadKbps: number;
  peers: number;
}

type Sample = { t: number; downloaded: number; peers: number };

type Entry = {
  sessionId: string;
  attachedAt: number;
  getStats: () => { peers: number; downloadBps: number };
  bufferSeconds: number;
  samples: Sample[];
  lastDownloaded: number;
  lastDownloadedAt: number;
  // Tracks how long we've been in a "low speed" or "no peers" condition, in ms.
  lowSpeedSince: number | null;
  zeroPeersSince: number | null;
  interval: NodeJS.Timeout;
};

const entries = new Map<string, Entry>();

const SAMPLE_INTERVAL_MS = 1000;
const ROLLING_WINDOW_MS = 10_000;
const STARTING_GRACE_MS = 5_000;
const DEGRADED_SPEED_THRESHOLD_KBPS = 100;
const DEGRADED_SUSTAIN_MS = 30_000;
const DEGRADED_BUFFER_THRESHOLD_S = 10;

function rollingKbps(samples: Sample[]): number {
  if (samples.length < 2) return 0;
  const first = samples[0];
  const last = samples[samples.length - 1];
  if (!first || !last) return 0;
  const dt = (last.t - first.t) / 1000;
  if (dt <= 0) return 0;
  const bytes = Math.max(0, last.downloaded - first.downloaded);
  return (bytes / 1024) / dt;
}

function tick(entry: Entry): void {
  let stats: { peers: number; downloadBps: number };
  try {
    stats = entry.getStats();
  } catch (err) {
    logger.warn({ sessionId: entry.sessionId, err }, 'stall-detector getStats failed');
    return;
  }

  const now = Date.now();
  // Integrate downloadBps into a running "downloaded" pseudo-counter so the rolling
  // calculation stays correct regardless of whether the engine reports cumulative bytes.
  const dt = (now - entry.lastDownloadedAt) / 1000;
  if (dt > 0) {
    entry.lastDownloaded += stats.downloadBps * dt;
  }
  entry.lastDownloadedAt = now;

  entry.samples.push({ t: now, downloaded: entry.lastDownloaded, peers: stats.peers });
  const cutoff = now - ROLLING_WINDOW_MS;
  while (entry.samples.length > 0 && (entry.samples[0]?.t ?? Infinity) < cutoff) {
    entry.samples.shift();
  }

  const kbps = rollingKbps(entry.samples);
  const lowSpeed = kbps < DEGRADED_SPEED_THRESHOLD_KBPS;
  const lowBuffer = entry.bufferSeconds < DEGRADED_BUFFER_THRESHOLD_S;
  if (lowSpeed && lowBuffer) {
    entry.lowSpeedSince ??= now;
  } else {
    entry.lowSpeedSince = null;
  }

  if (stats.peers === 0) {
    entry.zeroPeersSince ??= now;
  } else {
    entry.zeroPeersSince = null;
  }
}

export const stallDetector = {
  attach(opts: {
    sessionId: string;
    getStats: () => { peers: number; downloadBps: number };
    // Reserved for future use by callers who prefer a closure over reportBuffer.
    setBufferSeconds?: (b: number) => void;
  }): void {
    if (entries.has(opts.sessionId)) {
      logger.warn({ sessionId: opts.sessionId }, 'stall-detector already attached');
      return;
    }
    const now = Date.now();
    const entry: Entry = {
      sessionId: opts.sessionId,
      attachedAt: now,
      getStats: opts.getStats,
      bufferSeconds: 0,
      samples: [],
      lastDownloaded: 0,
      lastDownloadedAt: now,
      lowSpeedSince: null,
      zeroPeersSince: null,
      interval: setInterval(() => tick(entry), SAMPLE_INTERVAL_MS),
    };
    entries.set(opts.sessionId, entry);
    logger.debug({ sessionId: opts.sessionId }, 'stall-detector attached');
  },

  reportBuffer(sessionId: string, bufferSeconds: number): void {
    const entry = entries.get(sessionId);
    if (!entry) return;
    entry.bufferSeconds = bufferSeconds;
  },

  report(sessionId: string): StallReport | undefined {
    const entry = entries.get(sessionId);
    if (!entry) return undefined;
    const now = Date.now();
    const kbps = rollingKbps(entry.samples);
    const lastSample = entry.samples[entry.samples.length - 1];
    const peers = lastSample?.peers ?? 0;

    let state: StallReport['state'] = 'playing';
    if (now - entry.attachedAt < STARTING_GRACE_MS) {
      state = 'starting';
    } else if (
      (entry.lowSpeedSince !== null && now - entry.lowSpeedSince >= DEGRADED_SUSTAIN_MS) ||
      (entry.zeroPeersSince !== null && now - entry.zeroPeersSince >= DEGRADED_SUSTAIN_MS)
    ) {
      state = 'degraded';
    }

    return { state, downloadKbps: Math.round(kbps), peers };
  },

  detach(sessionId: string): void {
    const entry = entries.get(sessionId);
    if (!entry) return;
    clearInterval(entry.interval);
    entries.delete(sessionId);
    logger.debug({ sessionId }, 'stall-detector detached');
  },
};
