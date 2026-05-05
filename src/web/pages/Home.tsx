import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { FeaturedTile } from '../components/FeaturedTile.js';
import { PosterGrid, type PosterItem } from '../components/PosterGrid.js';
import { watch, type ContinueItem } from '../lib/api.js';

function continueHref(c: ContinueItem): string {
  if (c.target_type === 'episode' && c.episode) {
    return `/watch/show/${c.media.tmdb_id}/${c.episode.season}/${c.episode.episode_num}?resume=${Math.floor(c.position_seconds)}`;
  }
  return `/watch/movie/${c.media.tmdb_id}?resume=${Math.floor(c.position_seconds)}`;
}

function detailHref(c: ContinueItem): string {
  return `/${c.media.type}/${c.media.tmdb_id}`;
}

function continueSubtitle(c: ContinueItem): string {
  if (c.target_type === 'episode' && c.episode) {
    const s = String(c.episode.season).padStart(2, '0');
    const e = String(c.episode.episode_num).padStart(2, '0');
    return `S${s}E${e}`;
  }
  return 'Resume';
}

function FeaturedSkeleton() {
  return (
    <div className="aspect-[4/3] md:aspect-[16/9] rounded-2xl bg-muted/70 animate-pulse" />
  );
}

export function Home() {
  const navigate = useNavigate();

  const continueQuery = useQuery({
    queryKey: ['watch', 'continue', 24],
    queryFn: () => watch.continue(24),
  });

  const items = continueQuery.data?.items ?? [];
  const featured = items[0];
  const continueItems: PosterItem[] = items.slice(0, 6).map((c) => ({
    key: `${c.target_type}-${c.media.tmdb_id}-${c.episode?.season ?? 'm'}-${c.episode?.episode_num ?? 'm'}`,
    tmdb_id: c.media.tmdb_id,
    type: c.media.type,
    title: c.media.title,
    poster_url: c.media.poster_url,
    subtitle: continueSubtitle(c),
  }));

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 py-6 md:py-10 space-y-12">
        <section>
          {continueQuery.isLoading ? (
            <FeaturedSkeleton />
          ) : featured ? (
            <FeaturedTile
              item={{
                tmdb_id: featured.media.tmdb_id,
                type: featured.media.type,
                title: featured.media.title,
                backdrop_url: featured.media.backdrop_url,
                poster_url: featured.media.poster_url,
              }}
              playLabel="Resume"
              onPlay={() => navigate(continueHref(featured))}
              onSources={() => navigate(detailHref(featured))}
            />
          ) : (
            <div className="rounded-2xl ring-1 ring-border/30 bg-muted/40 px-6 py-12 md:px-12 md:py-20 text-center">
              <div className="text-[11px] uppercase tracking-[0.18em] text-fg/50 mb-3">
                Welcome
              </div>
              <h1 className="text-3xl md:text-5xl font-extrabold tracking-tight">
                Find something to watch
              </h1>
              <p className="mt-4 text-fg/60 max-w-md mx-auto">
                Search any movie or show to get started. Your continue-watching
                lineup will live here.
              </p>
              <button
                type="button"
                onClick={() => navigate('/search')}
                className="mt-6 inline-flex items-center gap-2 rounded-full bg-accent text-white px-5 h-11 text-sm font-semibold hover:brightness-110 transition"
              >
                Open search
              </button>
            </div>
          )}
        </section>

        {items.length > 0 ? (
          <section>
            <div className="flex items-baseline justify-between mb-4">
              <h2 className="text-lg md:text-xl font-semibold tracking-tight">
                Continue Watching
              </h2>
            </div>
            <PosterGrid
              items={continueItems}
              loading={continueQuery.isLoading}
            />
          </section>
        ) : null}
    </div>
  );
}

export default Home;
