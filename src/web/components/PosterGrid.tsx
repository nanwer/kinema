import { Link } from 'react-router-dom';
import type { MediaType } from '../../shared/types.js';

export type PosterItem = {
  key: string;
  tmdb_id: number;
  type: MediaType;
  title: string;
  poster_url: string | null;
  subtitle?: string;
};

type Props = {
  items: PosterItem[];
  loading?: boolean;
};

const GRID_CLASSES =
  'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 md:gap-5';

function PosterTile({ item }: { item: PosterItem }) {
  const href = `/${item.type}/${item.tmdb_id}`;
  return (
    <Link
      to={href}
      className="group block focus:outline-none"
      aria-label={item.title}
    >
      <div className="relative aspect-[2/3] overflow-hidden rounded-lg bg-muted ring-1 ring-border/30 transition-transform duration-200 group-hover:scale-[1.02] group-focus-visible:scale-[1.02]">
        {item.poster_url ? (
          <img
            src={item.poster_url}
            alt={item.title}
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          <div
            className="flex h-full w-full items-center justify-center p-3 text-center"
            style={{
              background:
                'linear-gradient(135deg, #1E1B4B 0%, #0F0F23 60%, #000000 100%)',
            }}
          >
            <span className="text-sm font-medium text-fg/80 line-clamp-4">
              {item.title}
            </span>
          </div>
        )}
      </div>
      <div className="mt-2 px-0.5">
        <div className="text-[13px] md:text-sm font-medium text-fg line-clamp-1">
          {item.title}
        </div>
        {item.subtitle ? (
          <div className="text-xs text-fg/50 line-clamp-1">{item.subtitle}</div>
        ) : null}
      </div>
    </Link>
  );
}

function SkeletonTile() {
  return (
    <div>
      <div className="aspect-[2/3] rounded-lg bg-muted/70 animate-pulse" />
      <div className="mt-2 h-3 w-3/4 rounded bg-muted/70 animate-pulse" />
      <div className="mt-1.5 h-2.5 w-1/2 rounded bg-muted/50 animate-pulse" />
    </div>
  );
}

export function PosterGrid({ items, loading }: Props) {
  if (loading) {
    return (
      <div className={GRID_CLASSES}>
        {Array.from({ length: 12 }).map((_, i) => (
          <SkeletonTile key={i} />
        ))}
      </div>
    );
  }

  return (
    <div className={GRID_CLASSES}>
      {items.map((item) => (
        <PosterTile key={item.key} item={item} />
      ))}
    </div>
  );
}
