import { Play } from 'lucide-react';
import type { Episode } from '../../shared/types.js';

export type EpisodeProgress = {
  positionSeconds: number;
  durationSeconds: number | null;
  completed: boolean;
};

type Props = {
  episodes: Episode[];
  watchProgress?: Record<number, EpisodeProgress>;
  onPlay: (episode: Episode) => void;
  highlightEpisodeId?: number;
};

function formatRuntime(min: number | null): string | null {
  if (!min || min <= 0) return null;
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function progressRatio(p: EpisodeProgress | undefined): number {
  if (!p) return 0;
  if (p.completed) return 1;
  if (!p.durationSeconds || p.durationSeconds <= 0) return 0;
  return Math.min(1, Math.max(0, p.positionSeconds / p.durationSeconds));
}

export function EpisodeList({
  episodes,
  watchProgress,
  onPlay,
  highlightEpisodeId,
}: Props) {
  return (
    <ul className="divide-y divide-border/30">
      {episodes.map((ep) => {
        const progress = watchProgress?.[ep.id];
        const ratio = progressRatio(progress);
        const isHighlight = highlightEpisodeId === ep.id;
        const runtime = formatRuntime(ep.runtime_minutes);

        return (
          <li key={ep.id}>
            <button
              type="button"
              onClick={() => onPlay(ep)}
              className={`group relative flex w-full items-center gap-3 sm:gap-5 py-3 sm:py-4 px-2 sm:px-3 text-left transition-colors hover:bg-fg/5 ${
                isHighlight ? 'bg-accent/5 border-l-2 border-accent' : ''
              }`}
              aria-label={`Play episode ${ep.episode_num}${ep.title ? `: ${ep.title}` : ''}`}
            >
              <div className="relative w-20 sm:w-[120px] aspect-video shrink-0 overflow-hidden rounded-md bg-muted ring-1 ring-border/30">
                {ep.still_url ? (
                  <img
                    src={ep.still_url}
                    alt=""
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div
                    className="h-full w-full"
                    style={{
                      background:
                        'linear-gradient(135deg, #1E1B4B 0%, #0F0F23 70%, #000000 100%)',
                    }}
                  />
                )}
                {ratio > 0 ? (
                  <div className="absolute inset-x-0 bottom-0 h-0.5 bg-fg/20">
                    <div
                      className="h-full bg-accent"
                      style={{ width: `${Math.round(ratio * 100)}%` }}
                    />
                  </div>
                ) : null}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="text-xs font-semibold text-fg/50 tabular-nums shrink-0">
                    {ep.episode_num}
                  </span>
                  <span className="text-base font-semibold text-fg line-clamp-1">
                    {ep.title ?? `Episode ${ep.episode_num}`}
                  </span>
                </div>
                {ep.overview ? (
                  <p className="mt-1 text-sm text-fg/60 line-clamp-2">
                    {ep.overview}
                  </p>
                ) : null}
              </div>

              <div className="flex items-center gap-3 shrink-0 self-start sm:self-center">
                {runtime ? (
                  <span className="text-xs text-fg/50 tabular-nums hidden sm:inline">
                    {runtime}
                  </span>
                ) : null}
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-fg/10 text-fg group-hover:bg-accent group-hover:text-white transition-colors">
                  <Play size={16} fill="currentColor" />
                </span>
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
