import AdmZip from 'adm-zip';
import { env } from '../../env.js';
import { logger } from '../../logger.js';
import type { SubtitleSearchResult } from '../../../shared/types.js';
import type { SubtitleProvider, SearchOpts } from './index.js';

const SUBDL_BASE = 'https://api.subdl.com/api/v1';
const REQUEST_TIMEOUT_MS = 15_000;
// Hard cap: subtitle archives shouldn't be huge. Anything bigger is suspicious
// (or a different file type) and we'd rather punt than load it into memory.
export const MAX_ZIP_BYTES = 10 * 1024 * 1024;

let warnedMissingKey = false;

function warnMissingKeyOnce(): void {
  if (warnedMissingKey) return;
  warnedMissingKey = true;
  logger.warn('SUBDL_API_KEY not configured; subdl provider disabled');
}

// Pulls the first usable subtitle file out of a zip blob. Prefers .srt over .vtt
// when both are present; falls back to .ass/.ssa (caller may convert separately).
export function extractFirstSubFromZip(buf: Buffer): { body: string; ext: string } | null {
  let zip: AdmZip;
  try {
    zip = new AdmZip(buf);
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'subdl zip parse failed');
    return null;
  }
  const entries = zip.getEntries().filter((e) => !e.isDirectory);
  const order = ['.srt', '.vtt', '.ass', '.ssa'];
  for (const ext of order) {
    const match = entries.find((e) => e.entryName.toLowerCase().endsWith(ext));
    if (match) {
      const body = match.getData().toString('utf8');
      if (body.length > 0) return { body, ext };
    }
  }
  return null;
}

type SubdlItem = {
  release_name?: string | null;
  name?: string | null;
  language?: string | null;
  lang?: string | null;
  url?: string | null;
};
type SubdlResponse = { status?: boolean; subtitles?: SubdlItem[] };

export const subdl: SubtitleProvider = {
  name: 'subdl',

  async search(opts: SearchOpts): Promise<SubtitleSearchResult[]> {
    if (!env.SUBDL_API_KEY) {
      warnMissingKeyOnce();
      return [];
    }
    const url = new URL(`${SUBDL_BASE}/subtitles`);
    url.searchParams.set('api_key', env.SUBDL_API_KEY);
    url.searchParams.set('tmdb_id', String(opts.tmdbId));
    url.searchParams.set('languages', opts.lang);
    url.searchParams.set('type', opts.type === 'show' ? 'tv' : 'movie');
    if (opts.type === 'show') {
      if (opts.season != null) url.searchParams.set('season_number', String(opts.season));
      if (opts.episode != null) url.searchParams.set('episode_number', String(opts.episode));
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        logger.warn({ status: res.status, body }, 'subdl search failed');
        return [];
      }
      const data = (await res.json()) as SubdlResponse;
      const items = Array.isArray(data?.subtitles) ? data.subtitles : [];
      const out: SubtitleSearchResult[] = [];
      for (const it of items) {
        const downloadUrl = it.url ?? null;
        if (!downloadUrl) continue;
        const language = it.language ?? it.lang ?? opts.lang;
        out.push({
          id: downloadUrl,
          provider: 'subdl',
          language,
          release: it.release_name ?? it.name ?? null,
          download_url: downloadUrl,
        });
        if (out.length >= 5) break;
      }
      return out;
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'subdl search errored');
      return [];
    } finally {
      clearTimeout(timeoutId);
    }
  },

  async download(result: SubtitleSearchResult): Promise<string> {
    const url = result.download_url;
    const lower = (url.toLowerCase().split('?')[0] ?? '');
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) throw new Error(`subdl file fetch failed: ${res.status}`);
      const ct = (res.headers.get('content-type') ?? '').toLowerCase();
      const isZipByExt = lower.endsWith('.zip');
      const isZipByCt = ct.includes('zip') || ct.includes('octet-stream');

      // Plain text path: .srt / .vtt direct download, or anything with a textual content-type.
      if (!isZipByExt && !isZipByCt) {
        return await res.text();
      }

      // Zip path: read into memory (capped), pull the first usable subtitle out.
      const ab = await res.arrayBuffer();
      if (ab.byteLength > MAX_ZIP_BYTES) {
        logger.warn(
          { url, bytes: ab.byteLength, limit: MAX_ZIP_BYTES },
          'subdl zip exceeds size cap; skipping',
        );
        return '';
      }
      const buf = Buffer.from(ab);
      const extracted = extractFirstSubFromZip(buf);
      if (!extracted) {
        logger.warn({ url }, 'subdl zip contained no usable subtitle file');
        return '';
      }
      return extracted.body;
    } finally {
      clearTimeout(timeoutId);
    }
  },
};
