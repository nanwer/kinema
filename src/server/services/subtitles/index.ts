import { existsSync, mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import path from 'node:path';
// @ts-expect-error -- srt-to-vtt has no published types; it's a transform-stream factory.
import srt2vtt from 'srt-to-vtt';
import { env } from '../../env.js';
import { logger } from '../../logger.js';
import { db } from '../../db.js';
import type { SubtitleSearchResult } from '../../../shared/types.js';
import { opensubtitles, SubtitlesQuotaError } from './opensubtitles.js';
import { subdl } from './subdl.js';
import { subtitleCacheKey } from './cache-key.js';

export { SubtitlesQuotaError } from './opensubtitles.js';

export type SearchOpts = {
  tmdbId: number;
  type: 'movie' | 'show';
  season?: number;
  episode?: number;
  lang: string;
};

export interface SubtitleProvider {
  name: 'opensubtitles' | 'subdl';
  search(opts: SearchOpts): Promise<SubtitleSearchResult[]>;
  download(result: SubtitleSearchResult): Promise<string>;
}

const providers: Record<'opensubtitles' | 'subdl', SubtitleProvider> = {
  opensubtitles,
  subdl,
};

type CacheRow = { cache_key: string; vtt_path: string; source: string; fetched_at: number };

const selectCache = db.prepare<[string], CacheRow>(
  'SELECT cache_key, vtt_path, source, fetched_at FROM subtitle_cache WHERE cache_key = ?',
);
const insertCache = db.prepare(
  'INSERT OR REPLACE INTO subtitle_cache (cache_key, vtt_path, source, fetched_at) VALUES (?, ?, ?, ?)',
);

async function srtToVtt(body: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const transform = srt2vtt();
    transform.on('data', (c: Buffer | string) => {
      chunks.push(typeof c === 'string' ? Buffer.from(c) : c);
    });
    transform.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    transform.on('error', reject);
    Readable.from(Buffer.from(body, 'utf8')).pipe(transform);
  });
}

async function bodyToVtt(body: string): Promise<string | null> {
  const trimmed = body.replace(/^﻿/, '').trimStart();
  if (!trimmed) return null;
  if (trimmed.startsWith('WEBVTT')) return body;
  // Anything else we treat as SRT. ASS/SSA isn't supported here; punt to caller.
  if (trimmed.startsWith('[Script Info]') || trimmed.startsWith('[V4')) return null;
  try {
    return await srtToVtt(body);
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'srt→vtt conversion failed');
    return null;
  }
}

function ensureSubtitleDir(): string {
  const dir = path.join(env.DATA_DIR, 'subtitles');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

async function tryProvider(
  provider: SubtitleProvider,
  opts: SearchOpts,
): Promise<{ vtt: string; source: string } | null> {
  let results: SubtitleSearchResult[];
  try {
    results = await provider.search(opts);
  } catch (err) {
    logger.warn({ provider: provider.name, err: (err as Error).message }, 'subtitle search threw');
    return null;
  }
  if (!results.length) return null;

  for (const result of results) {
    try {
      const body = await provider.download(result);
      if (!body) continue;
      const vtt = await bodyToVtt(body);
      if (!vtt) continue;
      return { vtt, source: provider.name };
    } catch (err) {
      if (err instanceof SubtitlesQuotaError) {
        logger.warn({ provider: provider.name }, 'subtitle quota exhausted; falling back');
        return null;
      }
      logger.warn(
        { provider: provider.name, id: result.id, err: (err as Error).message },
        'subtitle download failed; trying next result',
      );
      continue;
    }
  }
  return null;
}

export async function getOrFetchSubtitle(
  opts: SearchOpts,
): Promise<{ vttPath: string; cached: boolean; source: string } | null> {
  const key = subtitleCacheKey(opts);

  const existing = selectCache.get(key);
  if (existing && existsSync(existing.vtt_path)) {
    return { vttPath: existing.vtt_path, cached: true, source: existing.source };
  }

  const order: Array<'opensubtitles' | 'subdl'> =
    env.SUBTITLE_PRIMARY === 'subdl' ? ['subdl', 'opensubtitles'] : ['opensubtitles', 'subdl'];

  for (const name of order) {
    const hit = await tryProvider(providers[name], opts);
    if (!hit) continue;
    const dir = ensureSubtitleDir();
    const vttPath = path.join(dir, `${key}.vtt`);
    try {
      await writeFile(vttPath, hit.vtt, 'utf8');
    } catch (err) {
      logger.warn({ err: (err as Error).message, vttPath }, 'failed to write subtitle vtt');
      return null;
    }
    insertCache.run(key, vttPath, hit.source, Date.now());
    return { vttPath, cached: false, source: hit.source };
  }

  logger.warn({ key }, 'no subtitle providers returned a usable result');
  return null;
}
