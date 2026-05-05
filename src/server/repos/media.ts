import { db } from '../db.js';
import type { MediaItem, Episode, MediaType } from '../../shared/types.js';

type MediaItemFields = Omit<MediaItem, 'id'>;
type EpisodeFields = Omit<Episode, 'id' | 'media_item_id'>;

const stmts = {
  findByTmdb: db.prepare<[number, MediaType], MediaItem>(
    `SELECT id, tmdb_id, type, title, year, overview, poster_url, backdrop_url
       FROM media_items
      WHERE tmdb_id = ? AND type = ?`,
  ),
  upsert: db.prepare(
    `INSERT INTO media_items (tmdb_id, type, title, year, overview, poster_url, backdrop_url, metadata_json, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(tmdb_id, type) DO UPDATE SET
         title = excluded.title,
         year = excluded.year,
         overview = excluded.overview,
         poster_url = excluded.poster_url,
         backdrop_url = excluded.backdrop_url,
         metadata_json = excluded.metadata_json,
         fetched_at = excluded.fetched_at`,
  ),
  selectIdByTmdb: db.prepare<[number, MediaType], { id: number }>(
    'SELECT id FROM media_items WHERE tmdb_id = ? AND type = ?',
  ),
  upsertEpisode: db.prepare(
    `INSERT INTO episodes (media_item_id, season, episode_num, title, overview, runtime_minutes, still_url, air_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(media_item_id, season, episode_num) DO UPDATE SET
         title = excluded.title,
         overview = excluded.overview,
         runtime_minutes = excluded.runtime_minutes,
         still_url = excluded.still_url,
         air_date = excluded.air_date`,
  ),
  episodesByShow: db.prepare<[number], Episode>(
    `SELECT id, media_item_id, season, episode_num, title, overview, runtime_minutes, still_url, air_date
       FROM episodes
      WHERE media_item_id = ?
      ORDER BY season ASC, episode_num ASC`,
  ),
  findEpisode: db.prepare<[number, number, number], Episode>(
    `SELECT id, media_item_id, season, episode_num, title, overview, runtime_minutes, still_url, air_date
       FROM episodes
      WHERE media_item_id = ? AND season = ? AND episode_num = ?`,
  ),
};

function upsertItem(item: MediaItemFields, metadataJson: string): number {
  stmts.upsert.run(
    item.tmdb_id,
    item.type,
    item.title,
    item.year,
    item.overview,
    item.poster_url,
    item.backdrop_url,
    metadataJson,
    Date.now(),
  );
  const row = stmts.selectIdByTmdb.get(item.tmdb_id, item.type);
  if (!row) throw new Error('failed to read upserted media_item id');
  return row.id;
}

const upsertShowTx = db.transaction(
  (item: MediaItemFields, metadataJson: string, episodes: EpisodeFields[]): number => {
    const id = upsertItem(item, metadataJson);
    for (const ep of episodes) {
      stmts.upsertEpisode.run(
        id,
        ep.season,
        ep.episode_num,
        ep.title,
        ep.overview,
        ep.runtime_minutes,
        ep.still_url,
        ep.air_date,
      );
    }
    return id;
  },
);

export const mediaRepo = {
  findByTmdb(tmdbId: number, type: MediaType): MediaItem | undefined {
    return stmts.findByTmdb.get(tmdbId, type);
  },
  upsertMovie(item: MediaItemFields, metadataJson: string): number {
    return upsertItem(item, metadataJson);
  },
  upsertShow(item: MediaItemFields, metadataJson: string, episodes: EpisodeFields[]): number {
    return upsertShowTx(item, metadataJson, episodes);
  },
  episodesByShow(mediaItemId: number): Episode[] {
    return stmts.episodesByShow.all(mediaItemId);
  },
  findEpisode(mediaItemId: number, season: number, episodeNum: number): Episode | undefined {
    return stmts.findEpisode.get(mediaItemId, season, episodeNum);
  },
};
