import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { FeaturedTile } from '../components/FeaturedTile.js';
import { SourcePicker } from '../components/SourcePicker.js';
import { media, watch } from '../lib/api.js';
import type { TorrentResult } from '../../shared/types.js';

export function Movie() {
  const { tmdbId } = useParams<{ tmdbId: string }>();
  const navigate = useNavigate();
  const id = tmdbId ?? '';
  const [sourcesOpen, setSourcesOpen] = useState(false);

  const detail = useQuery({
    queryKey: ['media', 'movie', id],
    queryFn: () => media.get('movie', id),
    enabled: id.length > 0,
  });

  const continueQuery = useQuery({
    queryKey: ['watch', 'continue', 'movie-resume'],
    queryFn: () => watch.continue(50),
    enabled: id.length > 0,
  });

  const item = detail.data?.item;
  const resumePosition = (() => {
    if (!item) return 0;
    const match = continueQuery.data?.items.find(
      (c) =>
        c.target_type === 'movie' &&
        c.media.tmdb_id === item.tmdb_id &&
        c.media.type === 'movie',
    );
    if (!match) return 0;
    return Math.floor(match.position_seconds);
  })();

  const onPlay = () => {
    if (!item) return;
    const url = resumePosition > 0
      ? `/watch/movie/${item.tmdb_id}?resume=${resumePosition}`
      : `/watch/movie/${item.tmdb_id}`;
    navigate(url);
  };

  const onSources = () => {
    if (!item) return;
    setSourcesOpen(true);
  };

  const onPickSource = (r: TorrentResult) => {
    if (!item) return;
    setSourcesOpen(false);
    const url =
      resumePosition > 0
        ? `/watch/movie/${item.tmdb_id}?resume=${resumePosition}`
        : `/watch/movie/${item.tmdb_id}`;
    navigate(url, { state: { presetMagnet: r.magnet_uri } });
  };

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 py-6 md:py-10">
        <Link
          to="/"
          className="inline-flex items-center gap-1 text-sm text-fg/60 hover:text-fg mb-4 transition-colors"
        >
          <ChevronLeft size={16} />
          <span>Back</span>
        </Link>

        {detail.isLoading ? (
          <div className="aspect-[4/3] md:aspect-[16/9] rounded-2xl bg-muted/70 animate-pulse" />
        ) : detail.isError || !item ? (
          <div className="rounded-2xl ring-1 ring-border/30 bg-muted/40 px-6 py-16 text-center text-fg/60">
            Couldn&apos;t load this movie.
          </div>
        ) : (
          <>
            <FeaturedTile
              item={{
                tmdb_id: item.tmdb_id,
                type: 'movie',
                title: item.title,
                year: item.year,
                overview: item.overview,
                backdrop_url: item.backdrop_url,
                poster_url: item.poster_url,
              }}
              playLabel={resumePosition > 0 ? 'Resume' : 'Play'}
              onPlay={onPlay}
              onSources={onSources}
            />

            <section className="mt-8 md:mt-12 grid grid-cols-1 md:grid-cols-3 gap-8">
              <div className="md:col-span-2 space-y-4">
                <h2 className="text-base font-semibold tracking-tight text-fg/80 uppercase text-xs">
                  Overview
                </h2>
                <p className="text-fg/80 leading-relaxed text-base">
                  {item.overview ?? 'No overview available.'}
                </p>
              </div>
              <aside className="space-y-4 text-sm">
                {item.year ? (
                  <div>
                    <div className="text-xs uppercase tracking-[0.18em] text-fg/50">
                      Year
                    </div>
                    <div className="text-fg mt-1">{item.year}</div>
                  </div>
                ) : null}
                <div>
                  <div className="text-xs uppercase tracking-[0.18em] text-fg/50">
                    Type
                  </div>
                  <div className="text-fg mt-1">Movie</div>
                </div>
              </aside>
            </section>
          </>
        )}

        {item ? (
          <SourcePicker
            tmdbId={item.tmdb_id}
            type="movie"
            open={sourcesOpen}
            onClose={() => setSourcesOpen(false)}
            onPick={onPickSource}
          />
        ) : null}
    </div>
  );
}

export default Movie;
