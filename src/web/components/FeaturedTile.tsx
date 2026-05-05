import { Layers, Play } from 'lucide-react';
import type { ReactNode } from 'react';
import type { MediaType } from '../../shared/types.js';

type Props = {
  item: {
    tmdb_id: number;
    type: MediaType;
    title: string;
    year?: number | null;
    overview?: string | null;
    backdrop_url?: string | null;
    poster_url?: string | null;
  };
  onPlay?: () => void;
  onSources?: () => void;
  playLabel?: string;
  actions?: ReactNode;
};

export function FeaturedTile({
  item,
  onPlay,
  onSources,
  playLabel = 'Play',
  actions,
}: Props) {
  const bg = item.backdrop_url ?? item.poster_url ?? null;
  const typeLabel = item.type === 'movie' ? 'Movie' : 'Show';

  return (
    <section
      className="relative overflow-hidden rounded-2xl ring-1 ring-border/30 bg-muted aspect-[4/3] md:aspect-[16/9]"
      aria-label={item.title}
    >
      {bg ? (
        <img
          src={bg}
          alt=""
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <div
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(135deg, #1E1B4B 0%, #0F0F23 60%, #000000 100%)',
          }}
        />
      )}

      <div
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(to right, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.55) 45%, rgba(0,0,0,0) 80%)',
        }}
      />
      <div
        className="absolute inset-x-0 bottom-0 h-1/2"
        style={{
          background:
            'linear-gradient(to top, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0) 100%)',
        }}
      />

      <div className="relative z-10 flex h-full flex-col justify-end p-5 sm:p-8 md:p-10">
        <div className="max-w-2xl">
          <div className="text-[11px] sm:text-xs uppercase tracking-[0.18em] text-fg/60 mb-2 flex items-center gap-2">
            <span>{typeLabel}</span>
            {item.year ? (
              <>
                <span aria-hidden="true">·</span>
                <span>{item.year}</span>
              </>
            ) : null}
          </div>
          <h1 className="text-3xl md:text-5xl font-extrabold tracking-tight text-fg">
            {item.title}
          </h1>
          {item.overview ? (
            <p className="mt-3 hidden sm:block text-fg/70 text-sm md:text-base line-clamp-3 max-w-xl">
              {item.overview}
            </p>
          ) : null}

          <div className="mt-5 flex flex-wrap items-center gap-3">
            {actions ?? (
              <>
                <button
                  type="button"
                  onClick={onPlay}
                  className="inline-flex items-center gap-2 rounded-full bg-accent text-white px-5 h-11 text-sm font-semibold hover:brightness-110 transition"
                >
                  <Play size={18} fill="currentColor" />
                  <span>{playLabel}</span>
                </button>
                <button
                  type="button"
                  onClick={onSources}
                  className="inline-flex items-center gap-2 rounded-full bg-fg/10 text-fg px-5 h-11 text-sm font-semibold hover:bg-fg/15 transition border border-border/40"
                >
                  <Layers size={18} />
                  <span>Sources</span>
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
