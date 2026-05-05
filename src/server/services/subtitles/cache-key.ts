// Cache key for a subtitle: stable across providers so that opensubtitles
// and subdl results for the same media+lang collapse to one row.
export type CacheKeyOpts = {
  tmdbId: number;
  type: 'movie' | 'show';
  season?: number;
  episode?: number;
  lang: string;
};

export function subtitleCacheKey(opts: CacheKeyOpts): string {
  const seasonPart = opts.type === 'show' ? String(opts.season ?? '') : 'movie';
  const episodePart = opts.type === 'show' ? String(opts.episode ?? '') : 'x';
  return `${opts.tmdbId}-${seasonPart}-${episodePart}-${opts.lang}`;
}
