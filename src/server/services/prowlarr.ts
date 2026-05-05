// Prowlarr API client. Search-only — title resolution lives in the TMDB
// service. Returns normalised TorrentResult records; ranking happens in
// torrent-ranker.ts.

import { createHash } from 'node:crypto';
import { parse as parseTorrentTitle } from 'parse-torrent-title';
import { env } from '../env.js';
import { logger } from '../logger.js';
import type { TorrentResult } from '../../shared/types.js';

const REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_LIMIT = 50;

export class ProwlarrError extends Error {
  readonly status: number;
  readonly url: string;
  readonly body: string;

  constructor(message: string, init: { status: number; url: string; body: string }) {
    super(message);
    this.name = 'ProwlarrError';
    this.status = init.status;
    this.url = init.url;
    this.body = init.body;
  }
}

export type SearchOptions = {
  query: string;
  type: 'movie' | 'tv';
  tmdbId?: number;
  season?: number;
  episode?: number;
  limit?: number;
};

// Raw Prowlarr response shape — only the fields we consume. Prowlarr exposes
// many more on each result but we ignore them.
type ProwlarrSearchItem = {
  guid?: string;
  title?: string;
  indexer?: string;
  size?: number;
  seeders?: number;
  leechers?: number;
  magnetUrl?: string;
  infoHash?: string;
  downloadUrl?: string;
};

let warnedMissingApiKey = false;

/**
 * Search Prowlarr for torrents matching the given query.
 *
 * The caller is responsible for resolving the human-readable title (e.g. via
 * TMDB) and passing it in as `query`. This service formats the search string
 * (appending SxxEyy / Sxx for TV) and maps Prowlarr's response onto
 * `TorrentResult`. Ranking and scoring happens elsewhere — `score` is left at 0.
 */
export async function searchProwlarr(opts: SearchOptions): Promise<TorrentResult[]> {
  if (!env.PROWLARR_API_KEY) {
    if (!warnedMissingApiKey) {
      logger.warn(
        'PROWLARR_API_KEY is not set; searchProwlarr() will return [] until configured.',
      );
      warnedMissingApiKey = true;
    }
    return [];
  }

  const query = formatQuery(opts);
  const limit = opts.limit ?? DEFAULT_LIMIT;

  const url = new URL('/api/v1/search', env.PROWLARR_URL);
  url.searchParams.set('query', query);
  url.searchParams.set('limit', String(limit));
  // Categories: 2000 = movies, 5000 = TV. Prowlarr accepts repeated keys.
  if (opts.type === 'movie') {
    url.searchParams.append('categories', '2000');
  } else {
    url.searchParams.append('categories', '5000');
  }
  // Some indexers accept tmdbId for more accurate matches.
  if (opts.tmdbId !== undefined) {
    url.searchParams.set('tmdbId', String(opts.tmdbId));
  }
  // apikey query param is supported as a fallback; the X-Api-Key header is
  // the canonical method but we send both for compatibility.
  url.searchParams.set('apikey', env.PROWLARR_API_KEY);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'X-Api-Key': env.PROWLARR_API_KEY,
      },
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeout);
    const message =
      err instanceof Error && err.name === 'AbortError'
        ? `Prowlarr request timed out after ${REQUEST_TIMEOUT_MS}ms`
        : `Prowlarr request failed: ${err instanceof Error ? err.message : String(err)}`;
    throw new ProwlarrError(message, {
      status: 0,
      url: redactUrl(url),
      body: '',
    });
  }
  clearTimeout(timeout);

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new ProwlarrError(
      `Prowlarr returned ${response.status} ${response.statusText}`,
      { status: response.status, url: redactUrl(url), body },
    );
  }

  const items = (await response.json()) as ProwlarrSearchItem[];
  if (!Array.isArray(items)) {
    logger.warn({ items }, 'Prowlarr returned non-array response');
    return [];
  }

  const results: TorrentResult[] = [];
  for (const item of items) {
    const mapped = mapItem(item);
    if (mapped) results.push(mapped);
  }
  return results;
}

function formatQuery(opts: SearchOptions): string {
  const title = opts.query.trim();
  if (opts.type === 'tv') {
    if (opts.season !== undefined && opts.episode !== undefined) {
      return `${title} S${pad2(opts.season)}E${pad2(opts.episode)}`;
    }
    if (opts.season !== undefined) {
      return `${title} S${pad2(opts.season)}`;
    }
  }
  return title;
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

function mapItem(item: ProwlarrSearchItem): TorrentResult | null {
  const title = item.title ?? '';
  if (!title) return null;

  const magnetUri = resolveMagnet(item);
  if (!magnetUri) return null;

  const idSource = item.magnetUrl ?? item.guid ?? magnetUri;
  const id = createHash('sha1').update(idSource).digest('hex');

  const parsed = parseTorrentTitle(title);

  return {
    id,
    title,
    magnet_uri: magnetUri,
    size_bytes: typeof item.size === 'number' ? item.size : 0,
    seeders: typeof item.seeders === 'number' ? item.seeders : 0,
    leechers: typeof item.leechers === 'number' ? item.leechers : 0,
    source: item.indexer ?? 'unknown',
    resolution: normaliseResolution(parsed.resolution),
    codec: normaliseCodec(parsed.codec),
    container: normaliseContainer(parsed.container),
    score: 0,
  };
}

function resolveMagnet(item: ProwlarrSearchItem): string | null {
  if (item.magnetUrl && item.magnetUrl.startsWith('magnet:')) {
    return item.magnetUrl;
  }
  if (item.infoHash) {
    // Build a minimal magnet URI. Trackers can be added by the engine later
    // (WebTorrent ships with a default tracker list).
    const hash = item.infoHash.toLowerCase();
    return `magnet:?xt=urn:btih:${hash}`;
  }
  return null;
}

// parse-torrent-title returns strings like "1080p", "2160p", "720p" already.
// We normalise to the lowercase-with-p form expected by TorrentResult.
function normaliseResolution(raw: string | undefined): string | null {
  if (!raw) return null;
  const v = raw.toLowerCase();
  if (v === '4k' || v === '2160p') return '2160p';
  if (/^\d{3,4}p$/.test(v)) return v;
  return v;
}

// parse-torrent-title returns codec hints like "x264", "x265", "h264", "hevc",
// "av1". Map to the canonical names our ranker / transcoder use.
function normaliseCodec(raw: string | undefined): string | null {
  if (!raw) return null;
  const v = raw.toLowerCase();
  if (v === 'x264' || v === 'h264' || v === 'avc') return 'h264';
  if (v === 'x265' || v === 'h265' || v === 'hevc') return 'hevc';
  if (v === 'av1') return 'av1';
  if (v === 'vp9') return 'vp9';
  return v;
}

function normaliseContainer(raw: string | undefined): string | null {
  if (!raw) return null;
  const v = raw.toLowerCase();
  if (v === 'mkv' || v === 'mp4' || v === 'webm' || v === 'avi' || v === 'mov') {
    return v;
  }
  return v;
}

// Strip the apikey query param from a URL so it isn't logged or thrown.
function redactUrl(url: URL): string {
  const clone = new URL(url.toString());
  if (clone.searchParams.has('apikey')) {
    clone.searchParams.set('apikey', 'REDACTED');
  }
  return clone.toString();
}
