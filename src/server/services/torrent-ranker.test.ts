import { describe, it, expect } from 'vitest';
import { rankTorrents } from './torrent-ranker.js';
import type { TorrentResult } from '../../shared/types.js';

const GB = 1024 * 1024 * 1024;
const MB = 1024 * 1024;

function make(overrides: Partial<TorrentResult>): TorrentResult {
  return {
    id: overrides.id ?? 'x',
    title: overrides.title ?? 'Some Movie 2024 1080p WEB-DL',
    magnet_uri: overrides.magnet_uri ?? 'magnet:?xt=urn:btih:abc',
    size_bytes: overrides.size_bytes ?? 5 * GB,
    seeders: overrides.seeders ?? 10,
    leechers: overrides.leechers ?? 0,
    source: overrides.source ?? 'test',
    resolution: overrides.resolution ?? '1080p',
    codec: overrides.codec ?? 'h264',
    container: overrides.container ?? 'mkv',
    score: 0,
  };
}

describe('rankTorrents', () => {
  it('more seeders ranks higher when everything else is equal', () => {
    const a = make({ id: 'a', seeders: 5 });
    const b = make({ id: 'b', seeders: 500 });
    const sorted = rankTorrents([a, b]);
    expect(sorted[0]!.id).toBe('b');
    expect(sorted[1]!.id).toBe('a');
  });

  it('1080p+h264 ranks above 720p+h264 (quality bonus)', () => {
    const hd = make({ id: 'hd', resolution: '1080p', codec: 'h264', seeders: 10 });
    const sd = make({ id: 'sd', resolution: '720p', codec: 'h264', seeders: 10 });
    const sorted = rankTorrents([sd, hd]);
    expect(sorted[0]!.id).toBe('hd');
  });

  it('4k+hevc ranks below 1080p+h264 with preferDirectPlay (codec penalty + quality differential)', () => {
    const fourK = make({ id: '4k', resolution: '2160p', codec: 'hevc', seeders: 10 });
    const hd = make({ id: 'hd', resolution: '1080p', codec: 'h264', seeders: 10 });
    const sorted = rankTorrents([fourK, hd], { preferDirectPlay: true });
    expect(sorted[0]!.id).toBe('hd');
    expect(sorted[1]!.id).toBe('4k');
  });

  it('without preferDirectPlay, codec does not affect ordering (codecBonus is zero)', () => {
    const h264 = make({ id: 'h264', resolution: '1080p', codec: 'h264', seeders: 10 });
    const hevc = make({ id: 'hevc', resolution: '1080p', codec: 'hevc', seeders: 10 });
    const sorted = rankTorrents([h264, hevc]);
    expect(sorted[0]!.score).toBe(sorted[1]!.score);
  });

  it('movie at 50GB gets penalized below same-quality 5GB movie', () => {
    const huge = make({
      id: 'huge',
      title: 'Big Movie 2024 2160p BluRay',
      resolution: '1080p',
      size_bytes: 50 * GB,
      seeders: 10,
    });
    const normal = make({
      id: 'normal',
      title: 'Big Movie 2024 1080p WEB-DL',
      resolution: '1080p',
      size_bytes: 5 * GB,
      seeders: 10,
    });
    const sorted = rankTorrents([huge, normal]);
    expect(sorted[0]!.id).toBe('normal');
    expect(sorted[1]!.id).toBe('huge');
    expect(huge.score).toBeLessThan(normal.score);
  });

  it('tv-episode at 200MB is NOT penalized (within tv range)', () => {
    const ep = make({
      id: 'ep',
      title: 'My Show S01E03 720p WEB-DL',
      resolution: '720p',
      size_bytes: 200 * MB,
      seeders: 10,
    });
    const sorted = rankTorrents([ep]);
    const expected = Math.log(11) * 10 + 10;
    expect(sorted[0]!.score).toBeCloseTo(expected, 5);
  });

  it('tv-episode at 30GB IS penalized (over tv max)', () => {
    const huge = make({
      id: 'huge',
      title: 'My Show S01E03 2160p BluRay',
      resolution: '720p',
      size_bytes: 30 * GB,
      seeders: 10,
    });
    const normal = make({
      id: 'normal',
      title: 'My Show S01E03 720p WEB-DL',
      resolution: '720p',
      size_bytes: 1 * GB,
      seeders: 10,
    });
    const sorted = rankTorrents([huge, normal]);
    expect(sorted[0]!.id).toBe('normal');
    expect(huge.score).toBeLessThan(normal.score);
  });

  it('items with seeders=0 are NOT discarded — they appear at the bottom', () => {
    const dead = make({ id: 'dead', seeders: 0, resolution: '1080p' });
    const alive = make({ id: 'alive', seeders: 50, resolution: '720p' });
    const sorted = rankTorrents([dead, alive]);
    expect(sorted).toHaveLength(2);
    expect(sorted[0]!.id).toBe('alive');
    expect(sorted[1]!.id).toBe('dead');
  });

  it('mutates score on each item to a number', () => {
    const items = [make({ id: 'a' }), make({ id: 'b' })];
    rankTorrents(items);
    for (const it of items) {
      expect(typeof it.score).toBe('number');
      expect(it.score).not.toBe(0);
      expect(Number.isFinite(it.score)).toBe(true);
    }
  });

  it('returns sorted descending by score', () => {
    const items = [
      make({ id: 'a', seeders: 1 }),
      make({ id: 'b', seeders: 100 }),
      make({ id: 'c', seeders: 10 }),
    ];
    const sorted = rankTorrents(items);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i - 1]!.score).toBeGreaterThanOrEqual(sorted[i]!.score);
    }
  });

  it('SD resolutions (480p) get a negative quality bonus', () => {
    const sd = make({ id: 'sd', resolution: '480p', seeders: 10 });
    const hd = make({ id: 'hd', resolution: '1080p', seeders: 10 });
    const sorted = rankTorrents([sd, hd]);
    expect(sorted[0]!.id).toBe('hd');
    expect(sd.score).toBeLessThan(hd.score);
  });

  it('unknown size (0 bytes) gets a mild penalty', () => {
    const unknown = make({ id: 'u', size_bytes: 0, seeders: 10 });
    const known = make({ id: 'k', size_bytes: 5 * GB, seeders: 10 });
    const sorted = rankTorrents([unknown, known]);
    expect(sorted[0]!.id).toBe('k');
    expect(known.score - unknown.score).toBeCloseTo(5, 5);
  });
});
