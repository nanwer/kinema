import { mediaRepo } from '../repos/media.js';
import { getMovie, getShow } from './tmdb.js';
import { logger } from '../logger.js';

export type ResolveInput =
  | { type: 'movie'; tmdbId: number }
  | { type: 'episode'; tmdbId: number; season: number; episode: number };

export type ResolveResult = {
  // The DB id to write into watch_state.target_id and stream_sessions.target_id.
  targetId: number;
  // The media_items.id (handy for callers that want the show row even when resolving an episode).
  mediaItemId: number;
};

// Resolves a TMDB-shaped reference into a stable DB id, lazily fetching from
// TMDB and upserting if the row isn't cached yet. Idempotent.
export async function resolveTarget(input: ResolveInput): Promise<ResolveResult> {
  if (input.type === 'movie') {
    const cached = mediaRepo.findByTmdb(input.tmdbId, 'movie');
    if (cached) return { targetId: cached.id, mediaItemId: cached.id };

    const fetched = await getMovie(input.tmdbId);
    const id = mediaRepo.upsertMovie(
      { ...fetched.item, tmdb_id: input.tmdbId, type: 'movie' },
      JSON.stringify(fetched.metadata),
    );
    return { targetId: id, mediaItemId: id };
  }

  // type === 'episode'
  let mediaItemId: number;
  const cachedShow = mediaRepo.findByTmdb(input.tmdbId, 'show');
  if (cachedShow) {
    mediaItemId = cachedShow.id;
  } else {
    const fetched = await getShow(input.tmdbId);
    mediaItemId = mediaRepo.upsertShow(
      { ...fetched.item, tmdb_id: input.tmdbId, type: 'show' },
      JSON.stringify(fetched.metadata),
      fetched.episodes,
    );
  }

  let ep = mediaRepo.findEpisode(mediaItemId, input.season, input.episode);
  if (!ep) {
    // Show was cached but the requested episode isn't — re-fetch the show to
    // refresh the episode list. New seasons/specials may have arrived since.
    logger.info(
      { tmdbId: input.tmdbId, season: input.season, episode: input.episode },
      'episode missing in cache; refreshing show from TMDB',
    );
    const fetched = await getShow(input.tmdbId);
    mediaItemId = mediaRepo.upsertShow(
      { ...fetched.item, tmdb_id: input.tmdbId, type: 'show' },
      JSON.stringify(fetched.metadata),
      fetched.episodes,
    );
    ep = mediaRepo.findEpisode(mediaItemId, input.season, input.episode);
  }
  if (!ep) {
    throw new Error(
      `episode S${input.season}E${input.episode} not found for tmdb_id=${input.tmdbId}`,
    );
  }
  return { targetId: ep.id, mediaItemId };
}
