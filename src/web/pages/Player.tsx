import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, Loader2 } from 'lucide-react';
import type {
  MediaType,
  StreamStartResponse,
  TorrentResult,
} from '../../shared/types.js';
import { settings, stream as streamApi, subtitles, torrents } from '../lib/api.js';
import { VideoPlayer } from '../components/VideoPlayer.js';

type RouteKind = 'movie' | 'show';

type Params = {
  tmdbId: string;
  season?: string;
  episode?: string;
};

function isHlsUrl(url: string): boolean {
  return /\.m3u8(\?|$)/i.test(url);
}

export function Player({ kind }: { kind?: RouteKind } = {}) {
  const params = useParams<Params>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();

  // SourcePicker can pre-select a torrent via navigate(url, { state: { presetMagnet } }).
  // We only honor it on the FIRST attempt; "Try next source" falls through to ranked auto-pick.
  const presetMagnetRef = useRef<string | null>(
    (location.state as { presetMagnet?: string } | null)?.presetMagnet ?? null,
  );

  const tmdbId = params.tmdbId ? Number(params.tmdbId) : NaN;
  const season = params.season ? Number(params.season) : undefined;
  const episode = params.episode ? Number(params.episode) : undefined;
  const resumeParam = searchParams.get('resume');
  const resumeFromQuery = resumeParam ? Number(resumeParam) : 0;

  // When mounted directly from a route, params decide the kind.
  const inferredKind: RouteKind = season !== undefined ? 'show' : 'movie';
  const effectiveKind: RouteKind = kind ?? inferredKind;
  const mediaType: MediaType = effectiveKind === 'movie' ? 'movie' : 'show';

  const [pickedIndex, setPickedIndex] = useState<number>(0);
  const [resumeOverride, setResumeOverride] = useState<number>(resumeFromQuery);
  const [session, setSession] = useState<StreamStartResponse | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [overlayVisible, setOverlayVisible] = useState<boolean>(true);
  const lastPositionRef = useRef<number>(0);
  const overlayTimerRef = useRef<number | null>(null);
  // The session id we currently hold so we can cleanly DELETE on unmount/swap.
  const activeSessionIdRef = useRef<string | null>(null);

  // Step 1: ranked torrent list.
  const torrentsQuery = useQuery({
    queryKey: ['torrents', mediaType, tmdbId, season, episode, 'player'],
    queryFn: () =>
      torrents.list({
        type: mediaType,
        tmdb_id: tmdbId,
        season,
        episode,
        prefer_direct_play: true,
      }),
    enabled: Number.isFinite(tmdbId),
  });

  const fetchedResults: TorrentResult[] = torrentsQuery.data?.results ?? [];

  // If the user pre-selected a magnet via SourcePicker, prepend it to the
  // ranked list (or replace its position if it's already there). This makes
  // pickedIndex=0 always start with their choice while preserving the rest of
  // the list for "Try next source" fallbacks.
  const results: TorrentResult[] = useMemo(() => {
    const preset = presetMagnetRef.current;
    if (!preset) return fetchedResults;
    const existingIdx = fetchedResults.findIndex((r) => r.magnet_uri === preset);
    if (existingIdx === 0) return fetchedResults;
    if (existingIdx > 0) {
      const reordered = [...fetchedResults];
      const [chosen] = reordered.splice(existingIdx, 1);
      if (chosen) reordered.unshift(chosen);
      return reordered;
    }
    // Magnet wasn't in the ranked results (Prowlarr cache changed, or empty list).
    // Synthesize a minimal entry so we still play it.
    const synthetic: TorrentResult = {
      id: `preset-${preset.slice(0, 24)}`,
      title: '(user-selected source)',
      magnet_uri: preset,
      size_bytes: 0,
      seeders: 0,
      leechers: 0,
      source: 'manual',
      resolution: null,
      codec: null,
      container: null,
      score: 0,
    };
    return [synthetic, ...fetchedResults];
  }, [fetchedResults]);

  const picked = results[pickedIndex] ?? null;

  // Step 2: start the stream when we have a pick.
  useEffect(() => {
    if (!picked) return;
    let aborted = false;
    setSession(null);
    setStartError(null);

    // Backend resolves tmdb_id (+ season/episode for shows) into the right DB
    // row id (media_items.id or episodes.id) and writes it into watch_state.
    streamApi
      .start({
        magnet_uri: picked.magnet_uri,
        target_type: effectiveKind === 'movie' ? 'movie' : 'episode',
        tmdb_id: tmdbId,
        season,
        episode,
        prefer_direct_play: true,
      })
      .then((resp) => {
        if (aborted) return;
        setSession(resp);
        activeSessionIdRef.current = resp.session_id;
      })
      .catch((err: unknown) => {
        if (aborted) return;
        const msg = err instanceof Error ? err.message : 'Failed to start stream';
        setStartError(msg);
      });

    return () => {
      aborted = true;
    };
  }, [picked, effectiveKind, tmdbId, season, episode]);

  // Step 3a: read default subtitle language from app settings (long staleTime).
  const settingsQuery = useQuery({
    queryKey: ['app-settings'],
    queryFn: () => settings.get(),
    staleTime: 5 * 60_000,
  });
  const subtitleLang =
    (settingsQuery.data?.settings?.['default_subtitle_language'] as string | undefined)?.trim() ||
    'en';

  // Step 3b: subtitles. Lang from settings, falls back to 'en'.
  const subtitleQuery = useQuery({
    queryKey: ['subtitles', mediaType, tmdbId, season, episode, subtitleLang],
    queryFn: () =>
      subtitles.find({
        tmdb_id: tmdbId,
        type: mediaType,
        season,
        episode,
        lang: subtitleLang,
      }),
    enabled: Number.isFinite(tmdbId) && !settingsQuery.isLoading,
    staleTime: 5 * 60_000,
  });

  // Step 4: status polling. Stops once we reach a terminal-ish state.
  const sessionId = session?.session_id ?? null;
  const statusQuery = useQuery({
    queryKey: ['stream-status', sessionId],
    queryFn: () => streamApi.status(sessionId as string),
    enabled: !!sessionId,
    refetchInterval: (q) => {
      const s = q.state.data?.state;
      if (s === 'playing' || s === 'degraded' || s === 'ended') return false;
      return 2_000;
    },
  });

  // Explicit teardown on unmount (in-app navigation). The VideoPlayer's
  // sendBeacon hooks handle the tab-close path.
  useEffect(() => {
    return () => {
      const id = activeSessionIdRef.current;
      if (id) {
        void streamApi.end(id).catch(() => {
          // best-effort
        });
        activeSessionIdRef.current = null;
      }
    };
  }, []);

  // Top-bar auto-hide on inactivity.
  useEffect(() => {
    const reset = () => {
      setOverlayVisible(true);
      if (overlayTimerRef.current) window.clearTimeout(overlayTimerRef.current);
      overlayTimerRef.current = window.setTimeout(() => {
        setOverlayVisible(false);
      }, 3_000);
    };
    reset();
    window.addEventListener('mousemove', reset);
    window.addEventListener('touchstart', reset);
    return () => {
      window.removeEventListener('mousemove', reset);
      window.removeEventListener('touchstart', reset);
      if (overlayTimerRef.current) window.clearTimeout(overlayTimerRef.current);
    };
  }, []);

  const handlePositionUpdate = useCallback((pos: number) => {
    lastPositionRef.current = pos;
    // Backend heartbeat (driven by VideoPlayer) already updates watch_state.
  }, []);

  const handleTryNextSource = useCallback(async () => {
    const currentId = activeSessionIdRef.current;
    const next = pickedIndex + 1;
    if (next >= results.length) return;
    const carryPosition = lastPositionRef.current;
    if (currentId) {
      try {
        await streamApi.end(currentId);
      } catch {
        // ignore
      }
      activeSessionIdRef.current = null;
    }
    setResumeOverride(carryPosition);
    setPickedIndex(next);
  }, [pickedIndex, results.length]);

  const onEnded = useCallback(() => {
    // For v1, leaving the user on the player after end is fine. Hook for autoplay-next later.
  }, []);

  const titleText = useMemo(() => {
    if (effectiveKind === 'show' && season && episode) {
      return `S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`;
    }
    return '';
  }, [effectiveKind, season, episode]);

  const goBack = useCallback(() => {
    navigate(-1);
  }, [navigate]);

  if (!Number.isFinite(tmdbId)) {
    return <CenterMessage>Invalid URL.</CenterMessage>;
  }

  if (torrentsQuery.isLoading) {
    return <CenterMessage spinner>Searching for sources…</CenterMessage>;
  }

  if (torrentsQuery.isError) {
    return (
      <CenterMessage>
        Failed to load sources. Check your indexers and try again.
      </CenterMessage>
    );
  }

  if (!torrentsQuery.isLoading && results.length === 0) {
    return (
      <CenterMessage>
        No torrents available for this title. Try a different release or check
        Prowlarr indexers.
      </CenterMessage>
    );
  }

  if (startError) {
    return (
      <CenterMessage>
        Couldn&apos;t start stream: {startError}
      </CenterMessage>
    );
  }

  if (!session) {
    return <CenterMessage spinner>Starting stream…</CenterMessage>;
  }

  const status = statusQuery.data ?? null;
  const isHls = isHlsUrl(session.url);
  const subtitleVttUrl = subtitleQuery.data?.url ?? null;
  const initialPosition = resumeOverride > 0 ? resumeOverride : resumeFromQuery;

  return (
    <div className="fixed inset-0 bg-black text-fg flex flex-col">
      <div
        className={
          'absolute top-0 left-0 right-0 z-30 transition-opacity duration-300 ' +
          (overlayVisible ? 'opacity-100' : 'opacity-0 pointer-events-none')
        }
      >
        <div className="flex items-center gap-3 px-4 sm:px-6 py-3 bg-gradient-to-b from-black/80 to-transparent">
          <button
            type="button"
            onClick={goBack}
            className="inline-flex items-center gap-1 text-fg/90 hover:text-fg text-sm"
            aria-label="Back"
          >
            <ChevronLeft size={18} />
            <span>Back</span>
          </button>
          <div className="flex-1 text-center text-sm text-fg/80 truncate">
            {titleText}
          </div>
          <div className="w-12" />
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center">
        <VideoPlayer
          // Forces a fresh mount when we swap sources, so HLS/native are torn
          // down cleanly and the resume seek runs again on the new <video>.
          key={session.session_id}
          sessionId={session.session_id}
          streamUrl={session.url}
          pipeline={session.pipeline}
          isHls={isHls}
          initialPositionSeconds={initialPosition}
          subtitleVttUrl={subtitleVttUrl}
          subtitleLang={subtitleLang}
          status={status}
          onPositionUpdate={handlePositionUpdate}
          onEnded={onEnded}
          onTryNextSource={
            pickedIndex + 1 < results.length ? handleTryNextSource : undefined
          }
        />
      </div>
    </div>
  );
}

function CenterMessage({
  children,
  spinner,
}: {
  children: React.ReactNode;
  spinner?: boolean;
}) {
  return (
    <div className="fixed inset-0 bg-black text-fg flex items-center justify-center px-6">
      <div className="text-center space-y-3 max-w-md">
        {spinner ? (
          <Loader2 className="mx-auto animate-spin text-fg/70" size={28} />
        ) : null}
        <div className="text-sm text-fg/80">{children}</div>
      </div>
    </div>
  );
}

export function MoviePlayer() {
  return <Player kind="movie" />;
}

export function ShowPlayer() {
  return <Player kind="show" />;
}

export default Player;
