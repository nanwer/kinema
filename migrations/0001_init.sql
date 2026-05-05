-- 0001_init.sql
-- Initial schema for stream-app.

CREATE TABLE IF NOT EXISTS profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  avatar_url TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS media_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tmdb_id INTEGER NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('movie','show')),
  title TEXT NOT NULL,
  year INTEGER,
  overview TEXT,
  poster_url TEXT,
  backdrop_url TEXT,
  metadata_json TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  UNIQUE (tmdb_id, type)
);

CREATE TABLE IF NOT EXISTS episodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  media_item_id INTEGER NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
  season INTEGER NOT NULL,
  episode_num INTEGER NOT NULL,
  title TEXT,
  overview TEXT,
  runtime_minutes INTEGER,
  still_url TEXT,
  air_date TEXT,
  UNIQUE (media_item_id, season, episode_num)
);

CREATE INDEX IF NOT EXISTS episodes_by_media ON episodes(media_item_id, season, episode_num);

CREATE TABLE IF NOT EXISTS watch_state (
  profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('movie','episode')),
  target_id INTEGER NOT NULL,
  position_seconds REAL NOT NULL DEFAULT 0,
  duration_seconds REAL,
  completed INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (profile_id, target_type, target_id)
);

CREATE INDEX IF NOT EXISTS watch_state_recent ON watch_state(profile_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS stream_sessions (
  id TEXT PRIMARY KEY,
  profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL,
  target_id INTEGER NOT NULL,
  magnet_uri TEXT NOT NULL,
  file_path TEXT,
  pipeline TEXT CHECK (pipeline IN (
    'direct',
    'remux',
    'audio_only',
    'subs_convert',
    'burn_in',
    'full_transcode'
  )),
  created_at INTEGER NOT NULL,
  last_heartbeat_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS stream_sessions_heartbeat ON stream_sessions(last_heartbeat_at);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS subtitle_cache (
  cache_key TEXT PRIMARY KEY,
  vtt_path TEXT NOT NULL,
  source TEXT NOT NULL,
  fetched_at INTEGER NOT NULL
);
