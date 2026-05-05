import { describe, it, expect } from 'vitest';
import { subtitleCacheKey } from './cache-key.js';

describe('subtitleCacheKey', () => {
  it('movie → "<tmdb>-movie-x-<lang>"', () => {
    expect(subtitleCacheKey({ tmdbId: 603, type: 'movie', lang: 'en' })).toBe('603-movie-x-en');
  });

  it('show → "<tmdb>-<season>-<episode>-<lang>"', () => {
    expect(
      subtitleCacheKey({ tmdbId: 1396, type: 'show', season: 1, episode: 1, lang: 'en' }),
    ).toBe('1396-1-1-en');
  });

  it('show with two-digit episode and french lang', () => {
    expect(
      subtitleCacheKey({ tmdbId: 1396, type: 'show', season: 5, episode: 14, lang: 'fr' }),
    ).toBe('1396-5-14-fr');
  });

  it('lang case is preserved verbatim — caller must normalise', () => {
    const upper = subtitleCacheKey({ tmdbId: 603, type: 'movie', lang: 'EN' });
    const lower = subtitleCacheKey({ tmdbId: 603, type: 'movie', lang: 'en' });
    expect(upper).toBe('603-movie-x-EN');
    expect(lower).toBe('603-movie-x-en');
    expect(upper).not.toBe(lower);
  });

  it('show without season/episode → empty placeholders', () => {
    expect(subtitleCacheKey({ tmdbId: 42, type: 'show', lang: 'en' })).toBe('42---en');
  });
});
