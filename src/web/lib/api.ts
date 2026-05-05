import type {
  Episode,
  MediaItem,
  MediaType,
  Pipeline,
  Profile,
  SearchResult,
  StreamStartResponse,
  StreamStatus,
  TorrentResult,
} from '../../shared/types.js';

export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

type RequestInitWithJson = Omit<RequestInit, 'body'> & { json?: unknown };

async function request<T>(path: string, init: RequestInitWithJson = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  const finalHeaders: Record<string, string> = {
    Accept: 'application/json',
    ...(headers as Record<string, string> | undefined),
  };

  let body: BodyInit | undefined;
  if (json !== undefined) {
    body = JSON.stringify(json);
    finalHeaders['Content-Type'] = 'application/json';
  }

  const res = await fetch(path, {
    credentials: 'same-origin',
    ...rest,
    headers: finalHeaders,
    body,
  });

  const text = await res.text();
  let parsed: unknown = undefined;
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }

  if (!res.ok) {
    const message =
      parsed && typeof parsed === 'object' && parsed !== null && 'message' in parsed
        ? String((parsed as { message: unknown }).message)
        : `Request failed: ${res.status}`;
    throw new ApiError(res.status, message, parsed);
  }

  return parsed as T;
}

export type SessionResponse = { authed: boolean; profileId: number | null };
export type EnvStatus = {
  tmdb: boolean;
  prowlarr: boolean;
  opensubtitles: boolean;
  subdl: boolean;
};
export type SettingsResponse = {
  settings: Record<string, string>;
  env_status: EnvStatus;
};

export const auth = {
  session: () => request<SessionResponse>('/api/auth/session'),
  login: (password: string) =>
    request<{ ok: true }>('/api/auth/login', { method: 'POST', json: { password } }),
  logout: () => request<{ ok: true }>('/api/auth/logout', { method: 'POST' }),
  selectProfile: (profileId: number) =>
    request<{ ok: true }>('/api/auth/profile', {
      method: 'POST',
      json: { profileId },
    }),
};

export const profiles = {
  list: () => request<{ profiles: Profile[] }>('/api/profiles'),
  create: (name: string, avatar_url?: string | null) =>
    request<{ profile: Profile }>('/api/profiles', {
      method: 'POST',
      json: { name, avatar_url: avatar_url ?? null },
    }),
  update: (id: number, patch: { name?: string; avatar_url?: string | null }) =>
    request<{ profile: Profile }>(`/api/profiles/${id}`, {
      method: 'PUT',
      json: patch,
    }),
  delete: (id: number) =>
    request<{ ok: true }>(`/api/profiles/${id}`, { method: 'DELETE' }),
};

export const settings = {
  get: () => request<SettingsResponse>('/api/settings'),
  set: (key: string, value: string) =>
    request<{ ok: true }>(`/api/settings/${encodeURIComponent(key)}`, {
      method: 'PUT',
      json: { value },
    }),
  del: (key: string) =>
    request<{ ok: true }>(`/api/settings/${encodeURIComponent(key)}`, {
      method: 'DELETE',
    }),
};

export const search = {
  query: (q: string) =>
    request<{ results: SearchResult[] }>(
      `/api/search?q=${encodeURIComponent(q)}`,
    ),
};

export const media = {
  get: (type: MediaType, tmdbId: number | string) =>
    request<{ item: MediaItem; episodes?: Episode[] }>(
      `/api/media/${type}/${encodeURIComponent(String(tmdbId))}`,
    ),
};

export type ContinueItem = {
  target_type: 'movie' | 'episode';
  position_seconds: number;
  duration_seconds: number | null;
  updated_at: number;
  media: {
    tmdb_id: number;
    type: MediaType;
    title: string;
    poster_url: string | null;
    backdrop_url: string | null;
  };
  episode?: {
    id?: number;
    season: number;
    episode_num: number;
    title: string | null;
  };
};

export const watch = {
  continue: (limit = 24) =>
    request<{ items: ContinueItem[] }>(
      `/api/watch-state/continue?limit=${limit}`,
    ),
};

export type TorrentListOpts = {
  type: MediaType;
  tmdb_id: number | string;
  season?: number;
  episode?: number;
  prefer_direct_play?: boolean;
};

export const torrents = {
  list: (opts: TorrentListOpts) => {
    const params = new URLSearchParams();
    params.set('type', opts.type);
    params.set('tmdb_id', String(opts.tmdb_id));
    if (opts.season !== undefined) params.set('season', String(opts.season));
    if (opts.episode !== undefined) params.set('episode', String(opts.episode));
    if (opts.prefer_direct_play) params.set('prefer_direct_play', 'true');
    return request<{ results: TorrentResult[] }>(
      `/api/torrents?${params.toString()}`,
    );
  },
};

export type StreamStartOpts = {
  magnet_uri: string;
  target_type: 'movie' | 'episode';
  // Either tmdb_id (preferred — backend resolves to DB id) or target_id
  // (already-resolved DB id). At least one is required.
  tmdb_id?: number;
  target_id?: number;
  season?: number;
  episode?: number;
  prefer_direct_play?: boolean;
};

export type HeartbeatBody = {
  position_seconds: number;
  buffer_seconds?: number | null;
};

export const stream = {
  start: (opts: StreamStartOpts) =>
    request<StreamStartResponse>('/api/stream/start', {
      method: 'POST',
      json: opts,
    }),
  heartbeat: (id: string, body: HeartbeatBody) =>
    request<{ ok: true }>(`/api/stream/${encodeURIComponent(id)}/heartbeat`, {
      method: 'POST',
      json: body,
    }),
  status: (id: string) =>
    request<StreamStatus>(`/api/stream/${encodeURIComponent(id)}/status`),
  end: (id: string) =>
    request<{ ok: true }>(`/api/stream/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
};

export type SubtitleFindOpts = {
  tmdb_id: number | string;
  type: MediaType;
  season?: number;
  episode?: number;
  lang?: string;
};

export type SubtitleFindResult = {
  cache_key: string;
  source: string;
  url: string;
};

export const subtitles = {
  find: async (opts: SubtitleFindOpts): Promise<SubtitleFindResult | null> => {
    const params = new URLSearchParams();
    params.set('tmdb_id', String(opts.tmdb_id));
    params.set('type', opts.type);
    if (opts.season !== undefined) params.set('season', String(opts.season));
    if (opts.episode !== undefined) params.set('episode', String(opts.episode));
    params.set('lang', opts.lang ?? 'en');
    try {
      return await request<SubtitleFindResult>(
        `/api/subtitles?${params.toString()}`,
      );
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return null;
      throw err;
    }
  },
};

export type { Pipeline, StreamStartResponse, StreamStatus };
