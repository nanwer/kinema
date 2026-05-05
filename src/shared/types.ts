// Types shared between server and web.

export type MediaType = 'movie' | 'show';

export type Profile = {
  id: number;
  name: string;
  avatar_url: string | null;
  created_at: number;
};

export type MediaItem = {
  id: number;
  tmdb_id: number;
  type: MediaType;
  title: string;
  year: number | null;
  overview: string | null;
  poster_url: string | null;
  backdrop_url: string | null;
};

export type Episode = {
  id: number;
  media_item_id: number;
  season: number;
  episode_num: number;
  title: string | null;
  overview: string | null;
  runtime_minutes: number | null;
  still_url: string | null;
  air_date: string | null;
};

export type WatchState = {
  profile_id: number;
  target_type: 'movie' | 'episode';
  target_id: number;
  position_seconds: number;
  duration_seconds: number | null;
  completed: boolean;
  updated_at: number;
};

export type SearchResult = {
  tmdb_id: number;
  type: MediaType;
  title: string;
  year: number | null;
  poster_url: string | null;
};

export type TorrentResult = {
  // Stable id used by the client when picking a manual source.
  id: string;
  title: string;
  magnet_uri: string;
  size_bytes: number;
  seeders: number;
  leechers: number;
  source: string; // indexer name
  // Parsed hints derived from filename (parse-torrent-title).
  resolution: string | null; // "1080p" | "720p" | ...
  codec: string | null; // "h264" | "hevc" | ...
  container: string | null; // "mp4" | "mkv" | ...
  // 0..100, higher = better. Computed by torrent-ranker.
  score: number;
};

export type Pipeline =
  | 'direct'
  | 'remux'
  | 'audio_only'
  | 'subs_convert'
  | 'burn_in'
  | 'full_transcode';

export type StreamStartResponse = {
  session_id: string;
  url: string; // /api/stream/:id/file or /api/stream/:id/playlist.m3u8
  pipeline: Pipeline | null; // null while we haven't probed yet
  queued: boolean;
  queue_position: number;
};

export type StreamStatus = {
  session_id: string;
  state: 'starting' | 'playing' | 'degraded' | 'queued' | 'ended';
  peers: number;
  download_kbps: number;
  buffer_seconds: number | null;
  pipeline: Pipeline | null;
  queue_position: number | null;
};

export type SubtitleSearchResult = {
  id: string; // provider-specific id
  provider: 'opensubtitles' | 'subdl';
  language: string;
  release: string | null; // release name hint
  download_url: string;
};
