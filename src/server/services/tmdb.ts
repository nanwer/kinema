import { env } from '../env.js';
import { logger } from '../logger.js';
import type { MediaItem, Episode, SearchResult, MediaType } from '../../shared/types.js';

const TMDB_BASE = 'https://api.themoviedb.org/3';
const IMG_BASE = 'https://image.tmdb.org/t/p/w500';
const REQUEST_TIMEOUT_MS = 10_000;
const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW_MS = 10_000;
const MAX_RETRIES = 2;

export class TmdbError extends Error {
  readonly status: number;
  readonly body: string;
  readonly url: string;
  constructor(status: number, body: string, url: string) {
    super(`TMDB request failed: ${status} ${url}`);
    this.name = 'TmdbError';
    this.status = status;
    this.body = body;
    this.url = url;
  }
}

const recentTimestamps: number[] = [];
let chain: Promise<void> = Promise.resolve();

function acquireSlot(): Promise<void> {
  const next = chain.then(async () => {
    while (true) {
      const now = Date.now();
      while (recentTimestamps.length > 0 && now - (recentTimestamps[0] as number) >= RATE_LIMIT_WINDOW_MS) {
        recentTimestamps.shift();
      }
      if (recentTimestamps.length < RATE_LIMIT_MAX) {
        recentTimestamps.push(now);
        return;
      }
      const oldest = recentTimestamps[0] as number;
      const waitMs = RATE_LIMIT_WINDOW_MS - (now - oldest) + 5;
      await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
    }
  });
  chain = next.catch(() => undefined);
  return next;
}

function getApiKey(): string {
  if (!env.TMDB_API_KEY) {
    throw new TmdbError(0, 'TMDB_API_KEY is not configured', '');
  }
  return env.TMDB_API_KEY;
}

function buildUrl(path: string, params: Record<string, string | number | undefined> = {}): string {
  const url = new URL(`${TMDB_BASE}${path}`);
  url.searchParams.set('api_key', getApiKey());
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }
  return url.toString();
}

async function tmdbFetch<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
  const url = buildUrl(path, params);
  const safeUrl = url.replace(/api_key=[^&]+/, 'api_key=***');

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    await acquireSlot();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (res.ok) {
        return (await res.json()) as T;
      }
      const body = await res.text().catch(() => '');
      const retriable = res.status === 429 || res.status >= 500;
      if (retriable && attempt < MAX_RETRIES) {
        const retryAfterHeader = res.headers.get('retry-after');
        const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : 1000 * (attempt + 1);
        logger.warn(
          { url: safeUrl, status: res.status, attempt: attempt + 1, retryAfterMs },
          'tmdb request failed, retrying',
        );
        await new Promise<void>((resolve) => setTimeout(resolve, retryAfterMs));
        continue;
      }
      throw new TmdbError(res.status, body, safeUrl);
    } catch (err) {
      if (err instanceof TmdbError) throw err;
      const isAbort = (err as { name?: string }).name === 'AbortError';
      if (attempt < MAX_RETRIES) {
        logger.warn(
          { url: safeUrl, attempt: attempt + 1, err: (err as Error).message, abort: isAbort },
          'tmdb request errored, retrying',
        );
        await new Promise<void>((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
        continue;
      }
      throw new TmdbError(0, (err as Error).message ?? 'fetch error', safeUrl);
    } finally {
      clearTimeout(timeoutId);
    }
  }
  throw new TmdbError(0, 'exhausted retries', safeUrl);
}

function posterUrl(p: string | null | undefined): string | null {
  return p ? `${IMG_BASE}${p}` : null;
}

function extractYear(date: string | null | undefined): number | null {
  if (!date) return null;
  const y = Number(date.slice(0, 4));
  return Number.isFinite(y) && y > 0 ? y : null;
}

type MultiSearchItem = {
  id: number;
  media_type: 'movie' | 'tv' | 'person';
  title?: string;
  name?: string;
  release_date?: string;
  first_air_date?: string;
  poster_path?: string | null;
};

type MultiSearchResponse = { results: MultiSearchItem[] };

export async function searchMulti(query: string): Promise<SearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const data = await tmdbFetch<MultiSearchResponse>('/search/multi', {
    query: trimmed,
    include_adult: 'false',
  });
  const out: SearchResult[] = [];
  for (const r of data.results) {
    if (r.media_type !== 'movie' && r.media_type !== 'tv') continue;
    const type: MediaType = r.media_type === 'movie' ? 'movie' : 'show';
    const title = r.media_type === 'movie' ? r.title ?? '' : r.name ?? '';
    if (!title) continue;
    out.push({
      tmdb_id: r.id,
      type,
      title,
      year: extractYear(r.media_type === 'movie' ? r.release_date : r.first_air_date),
      poster_url: posterUrl(r.poster_path),
    });
    if (out.length >= 20) break;
  }
  return out;
}

type TmdbMovie = {
  id: number;
  title: string;
  release_date: string | null;
  overview: string | null;
  poster_path: string | null;
  backdrop_path: string | null;
};

export async function getMovie(
  tmdbId: number,
): Promise<{ item: Omit<MediaItem, 'id'>; metadata: unknown }> {
  const data = await tmdbFetch<TmdbMovie>(`/movie/${tmdbId}`);
  const item: Omit<MediaItem, 'id'> = {
    tmdb_id: data.id,
    type: 'movie',
    title: data.title,
    year: extractYear(data.release_date),
    overview: data.overview ?? null,
    poster_url: posterUrl(data.poster_path),
    backdrop_url: posterUrl(data.backdrop_path),
  };
  return { item, metadata: data };
}

type TmdbShowSeason = { season_number: number };
type TmdbShow = {
  id: number;
  name: string;
  first_air_date: string | null;
  overview: string | null;
  poster_path: string | null;
  backdrop_path: string | null;
  seasons: TmdbShowSeason[];
};
type TmdbShowEpisode = {
  season_number: number;
  episode_number: number;
  name: string | null;
  overview: string | null;
  runtime: number | null;
  still_path: string | null;
  air_date: string | null;
};
type TmdbShowSeasonDetail = { episodes: TmdbShowEpisode[] };

export async function getShow(
  tmdbId: number,
): Promise<{
  item: Omit<MediaItem, 'id'>;
  metadata: unknown;
  episodes: Array<Omit<Episode, 'id' | 'media_item_id'>>;
}> {
  const data = await tmdbFetch<TmdbShow>(`/tv/${tmdbId}`, { append_to_response: 'external_ids' });
  const item: Omit<MediaItem, 'id'> = {
    tmdb_id: data.id,
    type: 'show',
    title: data.name,
    year: extractYear(data.first_air_date),
    overview: data.overview ?? null,
    poster_url: posterUrl(data.poster_path),
    backdrop_url: posterUrl(data.backdrop_path),
  };

  const seasonNumbers = (data.seasons ?? [])
    .map((s) => s.season_number)
    .filter((n): n is number => typeof n === 'number' && n > 0);

  const seasonDetails = await Promise.all(
    seasonNumbers.map((n) => tmdbFetch<TmdbShowSeasonDetail>(`/tv/${tmdbId}/season/${n}`)),
  );

  const episodes: Array<Omit<Episode, 'id' | 'media_item_id'>> = [];
  for (const detail of seasonDetails) {
    for (const ep of detail.episodes ?? []) {
      episodes.push({
        season: ep.season_number,
        episode_num: ep.episode_number,
        title: ep.name,
        overview: ep.overview,
        runtime_minutes: ep.runtime,
        still_url: posterUrl(ep.still_path),
        air_date: ep.air_date,
      });
    }
  }
  episodes.sort((a, b) => a.season - b.season || a.episode_num - b.episode_num);

  return { item, metadata: data, episodes };
}
