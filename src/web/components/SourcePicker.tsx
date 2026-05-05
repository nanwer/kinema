import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, X } from 'lucide-react';
import type { MediaType, TorrentResult } from '../../shared/types.js';
import { torrents } from '../lib/api.js';

type Props = {
  tmdbId: number | string;
  type: MediaType;
  season?: number;
  episode?: number;
  open: boolean;
  onClose: () => void;
  onPick: (result: TorrentResult) => void;
};

const FRIENDLY_CODECS = new Set(['h264', 'avc', 'avc1']);
const FRIENDLY_CONTAINERS = new Set(['mp4', 'm4v', 'webm']);

function isBrowserFriendly(r: TorrentResult): boolean {
  const codec = (r.codec ?? '').toLowerCase();
  const container = (r.container ?? '').toLowerCase();
  return FRIENDLY_CODECS.has(codec) && FRIENDLY_CONTAINERS.has(container);
}

function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

export function SourcePicker({
  tmdbId,
  type,
  season,
  episode,
  open,
  onClose,
  onPick,
}: Props) {
  const query = useQuery({
    queryKey: ['torrents', type, tmdbId, season, episode],
    queryFn: () =>
      torrents.list({
        type,
        tmdb_id: tmdbId,
        season,
        episode,
        prefer_direct_play: true,
      }),
    enabled: open,
    staleTime: 60_000,
  });

  // Esc closes the modal.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const results = query.data?.results ?? [];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Choose source"
      className="fixed inset-0 z-50 flex items-stretch sm:items-center justify-center bg-black/80"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full sm:max-w-[720px] sm:w-[720px] sm:rounded-lg bg-surface border border-border/40 shadow-2xl flex flex-col max-h-screen sm:max-h-[80vh]">
        <div className="flex items-center justify-between px-4 sm:px-6 h-14 border-b border-border/40">
          <h2 className="text-fg font-semibold">Choose source</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1.5 text-fg/70 hover:text-fg hover:bg-muted/50"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {query.isLoading ? (
            <div className="flex items-center justify-center py-16 text-fg/60">
              <Loader2 className="animate-spin mr-2" size={18} />
              <span className="text-sm">Searching indexers…</span>
            </div>
          ) : query.isError ? (
            <div className="p-6 text-sm text-destructive">
              Failed to load sources. Check your Prowlarr indexers and try again.
            </div>
          ) : results.length === 0 ? (
            <div className="p-6 text-sm text-fg/60">
              No torrents found for this title.
            </div>
          ) : (
            <ul className="divide-y divide-border/30">
              {results.map((r) => {
                const friendly = isBrowserFriendly(r);
                return (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onPick(r);
                        onClose();
                      }}
                      className="w-full text-left px-4 sm:px-6 py-3 hover:bg-muted/40 focus:bg-muted/40 focus:outline-none transition-colors"
                    >
                      <div className="text-fg text-sm font-medium truncate">
                        {r.title}
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
                        {r.resolution ? (
                          <span
                            className={
                              'rounded px-1.5 py-0.5 ' +
                              (friendly
                                ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                                : 'bg-muted text-fg/70 border border-border/40')
                            }
                          >
                            {r.resolution}
                          </span>
                        ) : null}
                        {r.codec ? (
                          <span className="rounded px-1.5 py-0.5 bg-muted text-fg/70 border border-border/40">
                            {r.codec}
                          </span>
                        ) : null}
                        {r.container ? (
                          <span className="rounded px-1.5 py-0.5 bg-muted text-fg/70 border border-border/40 uppercase">
                            {r.container}
                          </span>
                        ) : null}
                        <span className="ml-1 text-fg/60">
                          {formatSize(r.size_bytes)}
                        </span>
                        <span className="text-fg/40">·</span>
                        <span className="text-fg/60">{r.seeders} seeders</span>
                        <span className="ml-auto text-fg/40 truncate max-w-[40%]">
                          {r.source}
                        </span>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
