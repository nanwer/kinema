// Scores and sorts a list of TorrentResults. Pure function — no I/O.
//
// Algorithm (per spec):
//   score = log(seeders + 1) * 10
//         + qualityBonus
//         + codecBonus       (only when preferDirectPlay)
//         - sizeOutOfRangePenalty
//
// Mutates each input item to write its computed `score`, then returns a new
// array sorted by score descending. Items with seeders < 1 are kept (sunk to
// the bottom by their natural score) rather than discarded.

import type { TorrentResult } from '../../shared/types.js';

export type RankOptions = {
  preferDirectPlay?: boolean;
};

const MOVIE_MIN = 700 * 1024 * 1024; // 700 MB
const MOVIE_MAX = 25 * 1024 * 1024 * 1024; // 25 GB
const TV_MIN = 200 * 1024 * 1024; // 200 MB
const TV_MAX = 6 * 1024 * 1024 * 1024; // 6 GB

const SIZE_PENALTY_MAX = 30;

export function rankTorrents(
  results: TorrentResult[],
  opts: RankOptions = {},
): TorrentResult[] {
  const preferDirectPlay = opts.preferDirectPlay ?? false;

  for (const r of results) {
    const seederTerm = Math.log(Math.max(0, r.seeders) + 1) * 10;
    const quality = qualityBonus(r.resolution);
    const codec = preferDirectPlay ? codecBonus(r.codec) : 0;
    const heuristicType = inferType(r.title);
    const sizePenalty = sizeOutOfRangePenalty(r.size_bytes, heuristicType);

    r.score = seederTerm + quality + codec - sizePenalty;
  }

  return [...results].sort((a, b) => b.score - a.score);
}

function qualityBonus(resolution: string | null): number {
  if (!resolution) return 0;
  const v = resolution.toLowerCase();
  if (v === '1080p') return 20;
  if (v === '720p') return 10;
  if (v === '2160p' || v === '4k') return 5;
  if (v === '480p' || v === '360p' || v === 'sd') return -10;
  return 0;
}

function codecBonus(codec: string | null): number {
  if (!codec) return 0;
  const v = codec.toLowerCase();
  if (v === 'h264') return 15;
  if (v === 'hevc' || v === 'h265') return -5;
  if (v === 'av1') return -3;
  return 0;
}

// Heuristic: presence of SxxEyy in the title → tv-episode; otherwise treat as
// movie. This intentionally classifies season packs as "movie" (large file
// budget) so they aren't penalised against the per-episode TV range.
function inferType(title: string): 'movie' | 'tv-episode' {
  return /\bS\d{1,2}E\d{1,2}\b/i.test(title) ? 'tv-episode' : 'movie';
}

function sizeOutOfRangePenalty(
  sizeBytes: number,
  type: 'movie' | 'tv-episode',
): number {
  if (!sizeBytes || sizeBytes <= 0) return 5; // unknown size → mild penalty
  const [min, max] = type === 'movie' ? [MOVIE_MIN, MOVIE_MAX] : [TV_MIN, TV_MAX];

  if (sizeBytes >= min && sizeBytes <= max) return 0;

  // Outside the range: scale the penalty by how far out we are, capped at
  // SIZE_PENALTY_MAX. Far-too-small files are likely fakes/samples and get
  // the full hit; oversized rips get scaled up to the cap as well.
  if (sizeBytes < min) {
    const ratio = sizeBytes / min; // 0..1
    return Math.round(SIZE_PENALTY_MAX * (1 - ratio));
  }
  // sizeBytes > max
  const overBy = sizeBytes / max; // >1
  // 1x = no penalty boundary, 2x = half cap, 4x+ = full cap
  const fraction = Math.min(1, (overBy - 1) / 3);
  return Math.round(SIZE_PENALTY_MAX * fraction);
}
