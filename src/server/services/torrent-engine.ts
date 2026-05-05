import path from 'node:path';
import WebTorrent from 'webtorrent';
import { parse as parseTorrentTitle } from 'parse-torrent-title';
import { env } from '../env.js';
import { logger } from '../logger.js';

type WebTorrentClient = WebTorrent.Instance;
type Torrent = WebTorrent.Torrent;
type TorrentFile = WebTorrent.TorrentFile;

const VIDEO_EXTENSIONS = new Set([
  '.mp4',
  '.mkv',
  '.avi',
  '.mov',
  '.webm',
  '.m4v',
  '.ts',
]);
const MIN_FILE_SIZE_BYTES = 50 * 1024 * 1024;
const EXCLUDE_PATTERN = /sample|trailer|featurette|extra/i;
const HEAD_PRIORITY_BYTES = 50 * 1024 * 1024;

// Public trackers used as a fallback when the magnet URI doesn't carry many
// (e.g. some indexers ship bare-hash magnets and rely on DHT, which is slow
// and unreliable from inside a VPN'd container). These augment whatever the
// magnet already declares — duplicates are deduped by WebTorrent.
const FALLBACK_TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://tracker.openbittorrent.com:6969/announce',
  'udp://exodus.desync.com:6969/announce',
  'udp://explodie.org:6969/announce',
  'udp://tracker.torrent.eu.org:451/announce',
  'udp://open.demonii.com:1337/announce',
  'udp://open.stealth.si:80/announce',
  'udp://tracker.tiny-vps.com:6969/announce',
  'udp://retracker.lanta-net.ru:2710/announce',
  'http://tracker.openbittorrent.com:80/announce',
];

export interface TorrentHandle {
  readonly sessionId: string;
  readonly filePath: string;
  readonly fileSize: number;
  readonly fileName: string;
  createReadStream(opts: { start: number; end: number }): NodeJS.ReadableStream;
  stats(): { peers: number; downloadBps: number; uploadBps: number; downloaded: number };
  stop(): Promise<void>;
}

export interface TorrentEngine {
  start(opts: {
    sessionId: string;
    magnetUri: string;
    pickFor?: { season: number; episode: number };
  }): Promise<TorrentHandle>;
}

type PickFor = { season: number; episode: number };

// WebTorrent's TorrentFile.path is a relative path under the torrent's download dir.
// The torrent's `path` property gives us the absolute parent directory.
type FileWithPieces = TorrentFile & {
  readonly _startPiece?: number;
  readonly _endPiece?: number;
  readonly offset?: number;
};

let clientPromise: Promise<WebTorrentClient> | null = null;

function getClient(): Promise<WebTorrentClient> {
  if (!clientPromise) {
    clientPromise = new Promise((resolve, reject) => {
      try {
        const c = new WebTorrent();
        c.on('error', (err) => {
          logger.warn({ err: String(err) }, 'webtorrent client error');
        });
        resolve(c);
      } catch (err) {
        reject(err);
      }
    });
  }
  return clientPromise;
}

const handles = new Map<string, TorrentHandle>();

function isVideoFile(name: string): boolean {
  const ext = path.extname(name).toLowerCase();
  return VIDEO_EXTENSIONS.has(ext);
}

function qualifies(file: TorrentFile): boolean {
  if (!isVideoFile(file.name)) return false;
  if (file.length < MIN_FILE_SIZE_BYTES) return false;
  if (EXCLUDE_PATTERN.test(file.name)) return false;
  if (EXCLUDE_PATTERN.test(file.path)) return false;
  return true;
}

function pickFile(files: readonly TorrentFile[], pickFor?: PickFor): TorrentFile | null {
  const candidates = files.filter(qualifies);
  if (candidates.length === 0) return null;

  if (pickFor) {
    for (const f of candidates) {
      const parsed = parseTorrentTitle(f.name);
      if (parsed.season === pickFor.season && parsed.episode === pickFor.episode) {
        return f;
      }
    }
    return null;
  }

  let largest = candidates[0]!;
  for (const f of candidates) {
    if (f.length > largest.length) largest = f;
  }
  return largest;
}

function waitForReady(torrent: Torrent): Promise<void> {
  return new Promise((resolve, reject) => {
    if (torrent.ready) {
      resolve();
      return;
    }
    const onReady = (): void => {
      torrent.removeListener('error', onError);
      resolve();
    };
    const onError = (err: Error | string): void => {
      torrent.removeListener('ready', onReady);
      reject(err instanceof Error ? err : new Error(String(err)));
    };
    torrent.once('ready', onReady);
    torrent.once('error', onError);
  });
}

function applySequentialPriority(torrent: Torrent, file: TorrentFile): void {
  for (const f of torrent.files) {
    f.deselect();
  }
  // The @types/webtorrent declaration omits the priority argument that the
  // runtime accepts. Cast through unknown to avoid disabling all type checking.
  (file.select as unknown as (priority: number) => void)(1);

  const fp = file as FileWithPieces;
  const startPiece = fp._startPiece;
  const endPiece = fp._endPiece;
  if (typeof startPiece !== 'number' || typeof endPiece !== 'number') return;
  if (torrent.pieceLength <= 0) return;

  const headPieceCount = Math.ceil(HEAD_PRIORITY_BYTES / torrent.pieceLength);
  const headEndPiece = Math.min(endPiece, startPiece + Math.max(0, headPieceCount - 1));
  if (headEndPiece >= startPiece) {
    torrent.select(startPiece, headEndPiece, 1);
  }
}

function destroyTorrent(torrent: Torrent): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      resolve();
    };
    try {
      torrent.destroy({ destroyStore: true }, () => finish());
    } catch (err) {
      logger.warn({ err: String(err) }, 'torrent destroy threw');
      finish();
    }
  });
}

export const torrentEngine: TorrentEngine = {
  async start({ sessionId, magnetUri, pickFor }) {
    if (handles.has(sessionId)) {
      throw new Error(`torrent session already active: ${sessionId}`);
    }

    const client = await getClient();
    const downloadPath = path.join(env.DATA_DIR, 'torrents', sessionId);

    const torrent = client.add(magnetUri, {
      path: downloadPath,
      announce: FALLBACK_TRACKERS,
    });

    try {
      await waitForReady(torrent);
    } catch (err) {
      await destroyTorrent(torrent);
      throw err;
    }

    const chosen = pickFile(torrent.files, pickFor);
    if (!chosen) {
      await destroyTorrent(torrent);
      const reason = pickFor
        ? `no video file matched S${pickFor.season}E${pickFor.episode} in torrent`
        : 'no qualifying video file found in torrent (after sample/size filters)';
      throw new Error(reason);
    }

    applySequentialPriority(torrent, chosen);

    const absolutePath = path.join(torrent.path, chosen.path);
    logger.info(
      {
        sessionId,
        file: chosen.name,
        sizeBytes: chosen.length,
        infoHash: torrent.infoHash,
      },
      'torrent session started',
    );

    const handle: TorrentHandle = {
      sessionId,
      filePath: absolutePath,
      fileSize: chosen.length,
      fileName: chosen.name,
      createReadStream({ start, end }) {
        if (start < 0 || end < start || end >= chosen.length) {
          throw new Error(`invalid range ${start}-${end} for file size ${chosen.length}`);
        }
        return chosen.createReadStream({ start, end });
      },
      stats() {
        return {
          peers: torrent.numPeers,
          downloadBps: torrent.downloadSpeed,
          uploadBps: torrent.uploadSpeed,
          downloaded: torrent.downloaded,
        };
      },
      async stop() {
        handles.delete(sessionId);
        await destroyTorrent(torrent);
        logger.info({ sessionId }, 'torrent session stopped');
      },
    };

    handles.set(sessionId, handle);
    return handle;
  },
};

export function getActiveSessions(): string[] {
  return Array.from(handles.keys());
}

export function getHandle(sessionId: string): TorrentHandle | undefined {
  return handles.get(sessionId);
}
