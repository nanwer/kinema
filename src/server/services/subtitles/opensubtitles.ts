import { env } from '../../env.js';
import { logger } from '../../logger.js';
import type { SubtitleSearchResult } from '../../../shared/types.js';
import type { SubtitleProvider, SearchOpts } from './index.js';

const OS_BASE = 'https://api.opensubtitles.com/api/v1';
const REQUEST_TIMEOUT_MS = 15_000;

export class SubtitlesQuotaError extends Error {
  constructor(message = 'OpenSubtitles download quota exhausted') {
    super(message);
    this.name = 'SubtitlesQuotaError';
  }
}

let cachedToken: string | null = null;
let warnedMissingCreds = false;

function hasCredentials(): boolean {
  return Boolean(env.OPENSUBS_API_KEY && env.OPENSUBS_USERNAME && env.OPENSUBS_PASSWORD);
}

function warnMissingCredsOnce(): void {
  if (warnedMissingCreds) return;
  warnedMissingCreds = true;
  logger.warn(
    'OpenSubtitles credentials not configured (need OPENSUBS_API_KEY, OPENSUBS_USERNAME, OPENSUBS_PASSWORD); provider disabled',
  );
}

async function osFetch(
  path: string,
  init: { method?: string; body?: unknown; query?: Record<string, string | number | undefined>; auth?: boolean } = {},
): Promise<Response> {
  const url = new URL(`${OS_BASE}${path}`);
  if (init.query) {
    for (const [k, v] of Object.entries(init.query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  const headers: Record<string, string> = {
    'Api-Key': env.OPENSUBS_API_KEY ?? '',
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'User-Agent': 'stream-app v1',
  };
  if (init.auth && cachedToken) {
    headers.Authorization = `Bearer ${cachedToken}`;
  }
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, {
      method: init.method ?? 'GET',
      headers,
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function login(): Promise<string> {
  const res = await osFetch('/login', {
    method: 'POST',
    body: { username: env.OPENSUBS_USERNAME, password: env.OPENSUBS_PASSWORD },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`OpenSubtitles login failed: ${res.status} ${body}`);
  }
  const data = (await res.json()) as { token?: string };
  if (!data.token) throw new Error('OpenSubtitles login response missing token');
  cachedToken = data.token;
  return data.token;
}

async function ensureToken(): Promise<string> {
  if (cachedToken) return cachedToken;
  return login();
}

type OsSearchAttributes = {
  language: string;
  release: string | null;
  download_count: number;
  files: Array<{ file_id: number; file_name: string | null }>;
};
type OsSearchItem = { id: string; attributes: OsSearchAttributes };
type OsSearchResponse = { data: OsSearchItem[] };

export const opensubtitles: SubtitleProvider = {
  name: 'opensubtitles',

  async search(opts: SearchOpts): Promise<SubtitleSearchResult[]> {
    if (!hasCredentials()) {
      warnMissingCredsOnce();
      return [];
    }
    const query: Record<string, string | number | undefined> = {
      tmdb_id: opts.tmdbId,
      languages: opts.lang,
      type: opts.type === 'show' ? 'episode' : 'movie',
    };
    if (opts.type === 'show') {
      query.season_number = opts.season;
      query.episode_number = opts.episode;
    }
    try {
      const res = await osFetch('/subtitles', { query });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        logger.warn({ status: res.status, body }, 'opensubtitles search failed');
        return [];
      }
      const data = (await res.json()) as OsSearchResponse;
      const items = (data.data ?? [])
        .filter((it) => it.attributes?.files?.[0]?.file_id != null)
        .sort((a, b) => (b.attributes.download_count ?? 0) - (a.attributes.download_count ?? 0))
        .slice(0, 5);
      return items.map((it): SubtitleSearchResult => {
        const fileId = it.attributes.files[0]!.file_id;
        return {
          id: String(fileId),
          provider: 'opensubtitles',
          language: it.attributes.language,
          release: it.attributes.release,
          download_url: `os:${fileId}`,
        };
      });
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'opensubtitles search errored');
      return [];
    }
  },

  async download(result: SubtitleSearchResult): Promise<string> {
    const fileId = Number(result.id);
    if (!Number.isFinite(fileId)) {
      throw new Error(`opensubtitles: invalid file id "${result.id}"`);
    }

    const requestDownload = async (): Promise<Response> => {
      await ensureToken();
      return osFetch('/download', { method: 'POST', body: { file_id: fileId }, auth: true });
    };

    let res = await requestDownload();
    if (res.status === 401) {
      cachedToken = null;
      res = await requestDownload();
    }
    if (res.status === 406) {
      throw new SubtitlesQuotaError();
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`opensubtitles download failed: ${res.status} ${body}`);
    }
    const data = (await res.json()) as { link?: string };
    if (!data.link) {
      throw new Error('opensubtitles download response missing link');
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const fileRes = await fetch(data.link, { signal: controller.signal });
      if (!fileRes.ok) {
        throw new Error(`opensubtitles file fetch failed: ${fileRes.status}`);
      }
      return await fileRes.text();
    } finally {
      clearTimeout(timeoutId);
    }
  },
};
