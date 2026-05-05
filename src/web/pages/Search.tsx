import { useQuery } from '@tanstack/react-query';
import { Search as SearchIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { PosterGrid, type PosterItem } from '../components/PosterGrid.js';
import { search } from '../lib/api.js';

function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export function Search() {
  const [input, setInput] = useState('');
  const debounced = useDebouncedValue(input.trim(), 300);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const enabled = debounced.length > 0;
  const query = useQuery({
    queryKey: ['search', debounced],
    queryFn: () => search.query(debounced),
    enabled,
    staleTime: 60_000,
  });

  const results: PosterItem[] = (query.data?.results ?? []).map((r) => ({
    key: `${r.type}-${r.tmdb_id}`,
    tmdb_id: r.tmdb_id,
    type: r.type,
    title: r.title,
    poster_url: r.poster_url,
    subtitle: r.year ? String(r.year) : r.type === 'movie' ? 'Movie' : 'Show',
  }));

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 py-6 md:py-10">
        <div className="relative mb-8">
          <SearchIcon
            size={20}
            className="absolute left-4 top-1/2 -translate-y-1/2 text-fg/50 pointer-events-none"
          />
          <input
            ref={inputRef}
            type="search"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Search movies and shows"
            autoComplete="off"
            spellCheck={false}
            className="w-full bg-muted/60 ring-1 ring-border/40 focus:ring-accent focus:bg-muted text-fg placeholder:text-fg/40 rounded-full h-12 md:h-14 pl-12 pr-5 text-base md:text-lg outline-none transition-colors"
          />
        </div>

        {!enabled ? (
          <div className="mt-16 text-center text-fg/50">
            Search for any movie or show
          </div>
        ) : query.isLoading || query.isFetching ? (
          <PosterGrid items={[]} loading />
        ) : query.isError ? (
          <div className="mt-16 text-center text-fg/60">
            Something went wrong. Try again.
          </div>
        ) : results.length === 0 ? (
          <div className="mt-16 text-center text-fg/50">
            No results for &ldquo;{debounced}&rdquo;
          </div>
        ) : (
          <PosterGrid items={results} />
        )}
    </div>
  );
}

export default Search;
