import { useQuery } from '@tanstack/react-query';
import { ChevronLeft } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  EpisodeList,
  type EpisodeProgress,
} from '../components/EpisodeList.js';
import { FeaturedTile } from '../components/FeaturedTile.js';
import { SourcePicker } from '../components/SourcePicker.js';
import { media, watch, type ContinueItem } from '../lib/api.js';
import type { Episode, TorrentResult } from '../../shared/types.js';

type ResumeTarget = {
  episode: Episode;
  positionSeconds: number;
  isResume: boolean;
};

function pickResumeTarget(
  episodes: Episode[],
  tmdbId: number,
  continueItems: ContinueItem[],
  progressById: Record<number, EpisodeProgress>,
): ResumeTarget | null {
  if (episodes.length === 0) return null;

  const sorted = [...episodes].sort(
    (a, b) => a.season - b.season || a.episode_num - b.episode_num,
  );

  // Rule 1: most recently played episode of this show, if incomplete.
  const showContinue = continueItems
    .filter(
      (c) =>
        c.target_type === 'episode' &&
        c.media.tmdb_id === tmdbId &&
        c.episode !== undefined,
    )
    .sort((a, b) => b.updated_at - a.updated_at);

  for (const c of showContinue) {
    const ep = sorted.find(
      (e) =>
        e.season === c.episode!.season &&
        e.episode_num === c.episode!.episode_num,
    );
    if (!ep) continue;
    const prog = progressById[ep.id];
    if (prog && !prog.completed) {
      return {
        episode: ep,
        positionSeconds: Math.floor(c.position_seconds),
        isResume: true,
      };
    }
  }

  // Rule 2: next unwatched after most recently completed.
  let lastCompletedIndex = -1;
  sorted.forEach((ep, i) => {
    if (progressById[ep.id]?.completed) lastCompletedIndex = i;
  });
  if (lastCompletedIndex >= 0 && lastCompletedIndex < sorted.length - 1) {
    const next = sorted[lastCompletedIndex + 1];
    if (next) return { episode: next, positionSeconds: 0, isResume: false };
  }

  // Rule 3: S01E01 (or first available).
  const first = sorted[0];
  if (!first) return null;
  return { episode: first, positionSeconds: 0, isResume: false };
}

export function Show() {
  const { tmdbId } = useParams<{ tmdbId: string }>();
  const navigate = useNavigate();
  const id = tmdbId ?? '';

  const detail = useQuery({
    queryKey: ['media', 'show', id],
    queryFn: () => media.get('show', id),
    enabled: id.length > 0,
  });

  const continueQuery = useQuery({
    queryKey: ['watch', 'continue', 'show-resume'],
    queryFn: () => watch.continue(50),
    enabled: id.length > 0,
  });

  const item = detail.data?.item;
  const episodes = detail.data?.episodes ?? [];

  const seasons = useMemo(() => {
    const set = new Set<number>();
    for (const ep of episodes) set.add(ep.season);
    return [...set].sort((a, b) => a - b);
  }, [episodes]);

  const [activeSeason, setActiveSeason] = useState<number | null>(null);
  const currentSeason = activeSeason ?? seasons[0] ?? null;

  const seasonEpisodes = useMemo(() => {
    if (currentSeason === null) return [];
    return episodes
      .filter((e) => e.season === currentSeason)
      .sort((a, b) => a.episode_num - b.episode_num);
  }, [episodes, currentSeason]);

  // TODO: implement spec resume rule fully — needs per-episode progress map from
  // a dedicated endpoint. For now we derive what we can from /watch-state/continue.
  const progressById: Record<number, EpisodeProgress> = useMemo(() => {
    const map: Record<number, EpisodeProgress> = {};
    if (!item) return map;
    const items = continueQuery.data?.items ?? [];
    for (const c of items) {
      if (c.target_type !== 'episode' || !c.episode) continue;
      if (c.media.tmdb_id !== item.tmdb_id) continue;
      const ep = episodes.find(
        (e) =>
          e.season === c.episode!.season &&
          e.episode_num === c.episode!.episode_num,
      );
      if (!ep) continue;
      const completed =
        c.duration_seconds != null &&
        c.duration_seconds > 0 &&
        c.position_seconds / c.duration_seconds >= 0.9;
      map[ep.id] = {
        positionSeconds: c.position_seconds,
        durationSeconds: c.duration_seconds,
        completed,
      };
    }
    return map;
  }, [continueQuery.data, episodes, item]);

  const resume = useMemo(() => {
    if (!item) return null;
    return pickResumeTarget(
      episodes,
      item.tmdb_id,
      continueQuery.data?.items ?? [],
      progressById,
    );
  }, [item, episodes, continueQuery.data, progressById]);

  const playEpisode = (ep: Episode, resumeSec = 0) => {
    if (!item) return;
    const base = `/watch/show/${item.tmdb_id}/${ep.season}/${ep.episode_num}`;
    navigate(resumeSec > 0 ? `${base}?resume=${resumeSec}` : base);
  };

  const onPlay = () => {
    if (!resume) return;
    playEpisode(resume.episode, resume.positionSeconds);
  };

  const [sourcesEpisode, setSourcesEpisode] = useState<Episode | null>(null);

  const onSources = () => {
    if (resume) setSourcesEpisode(resume.episode);
  };

  const onPickSource = (r: TorrentResult) => {
    if (!item || !sourcesEpisode) return;
    const ep = sourcesEpisode;
    setSourcesEpisode(null);
    const base = `/watch/show/${item.tmdb_id}/${ep.season}/${ep.episode_num}`;
    const prog = progressById[ep.id];
    const resumeSec = prog && !prog.completed ? Math.floor(prog.positionSeconds) : 0;
    const url = resumeSec > 0 ? `${base}?resume=${resumeSec}` : base;
    navigate(url, { state: { presetMagnet: r.magnet_uri } });
  };

  const resumeLabel = (() => {
    if (!resume) return 'Play';
    const s = String(resume.episode.season).padStart(2, '0');
    const e = String(resume.episode.episode_num).padStart(2, '0');
    if (resume.isResume) return `Resume S${s}E${e}`;
    return `Play S${s}E${e}`;
  })();

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
            Couldn&apos;t load this show.
          </div>
        ) : (
          <>
            <FeaturedTile
              item={{
                tmdb_id: item.tmdb_id,
                type: 'show',
                title: item.title,
                year: item.year,
                overview: item.overview,
                backdrop_url: item.backdrop_url,
                poster_url: item.poster_url,
              }}
              playLabel={resumeLabel}
              onPlay={onPlay}
              onSources={onSources}
            />

            {seasons.length > 0 ? (
              <section className="mt-8 md:mt-12">
                <div className="border-b border-border/40 mb-2 overflow-x-auto">
                  <div className="flex gap-1 sm:gap-2 min-w-max">
                    {seasons.map((s) => {
                      const active = s === currentSeason;
                      return (
                        <button
                          key={s}
                          type="button"
                          onClick={() => setActiveSeason(s)}
                          className={`px-3 sm:px-4 py-2.5 text-sm font-medium transition-colors -mb-px border-b-2 ${
                            active
                              ? 'border-accent text-fg'
                              : 'border-transparent text-fg/60 hover:text-fg'
                          }`}
                        >
                          Season {s}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <EpisodeList
                  episodes={seasonEpisodes}
                  watchProgress={progressById}
                  onPlay={(ep) => {
                    const prog = progressById[ep.id];
                    const sec =
                      prog && !prog.completed
                        ? Math.floor(prog.positionSeconds)
                        : 0;
                    playEpisode(ep, sec);
                  }}
                  highlightEpisodeId={resume?.episode.id}
                />
              </section>
            ) : (
              <div className="mt-12 text-center text-fg/50">
                No episodes available.
              </div>
            )}
          </>
        )}

        {item && sourcesEpisode ? (
          <SourcePicker
            tmdbId={item.tmdb_id}
            type="show"
            season={sourcesEpisode.season}
            episode={sourcesEpisode.episode_num}
            open={true}
            onClose={() => setSourcesEpisode(null)}
            onPick={onPickSource}
          />
        ) : null}
    </div>
  );
}

export default Show;
