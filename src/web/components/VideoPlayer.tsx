import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import type { Pipeline, StreamStatus } from '../../shared/types.js';
import { stream as streamApi } from '../lib/api.js';

type Props = {
  sessionId: string;
  streamUrl: string;
  pipeline: Pipeline | null;
  isHls: boolean;
  initialPositionSeconds?: number;
  subtitleVttUrl?: string | null;
  subtitleLang?: string;
  onPositionUpdate?: (pos: number, duration: number | null) => void;
  onEnded?: () => void;
  status?: StreamStatus | null;
  onTryNextSource?: () => void;
};

const PIPELINE_LABEL: Record<Pipeline, string> = {
  direct: 'Direct',
  remux: 'Remux',
  audio_only: 'Audio xcode',
  subs_convert: 'Subs',
  burn_in: 'Burn-in',
  full_transcode: 'Transcode',
};

function formatKbps(kbps: number): string {
  if (kbps >= 1024) return `${(kbps / 1024).toFixed(1)} MB/s`;
  return `${Math.round(kbps)} KB/s`;
}

function bufferAhead(video: HTMLVideoElement): number {
  const t = video.currentTime;
  const ranges = video.buffered;
  for (let i = 0; i < ranges.length; i++) {
    if (ranges.start(i) <= t && ranges.end(i) >= t) {
      return Math.max(0, ranges.end(i) - t);
    }
  }
  return 0;
}

function teardownBeacon(sessionId: string): void {
  try {
    const blob = new Blob([''], { type: 'text/plain' });
    navigator.sendBeacon(`/api/stream/${encodeURIComponent(sessionId)}/end`, blob);
  } catch {
    // sendBeacon failed; nothing useful to do at unload time.
  }
}

export function VideoPlayer({
  sessionId,
  streamUrl,
  pipeline,
  isHls,
  initialPositionSeconds,
  subtitleVttUrl,
  subtitleLang,
  onPositionUpdate,
  onEnded,
  status,
  onTryNextSource,
}: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<{ destroy: () => void } | null>(null);
  const lastPositionEmitRef = useRef<number>(0);
  const seekedToResumeRef = useRef<boolean>(false);
  const [stallDismissed, setStallDismissed] = useState<boolean>(false);

  // When state recovers, allow the banner to reappear if it degrades again.
  useEffect(() => {
    if (status?.state === 'playing') setStallDismissed(false);
  }, [status?.state]);

  // Wire up the source (HLS via hls.js or native) and clean up on change/unmount.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let cancelled = false;
    seekedToResumeRef.current = false;

    if (isHls) {
      const native = video.canPlayType('application/vnd.apple.mpegurl');
      if (native === 'maybe' || native === 'probably') {
        video.src = streamUrl;
      } else {
        import('hls.js')
          .then((mod) => {
            if (cancelled) return;
            const Hls = mod.default;
            if (!Hls.isSupported()) {
              video.src = streamUrl;
              return;
            }
            const hls = new Hls();
            hls.attachMedia(video);
            hls.loadSource(streamUrl);
            hlsRef.current = hls;
          })
          .catch(() => {
            if (!cancelled) video.src = streamUrl;
          });
      }
    } else {
      video.src = streamUrl;
    }

    return () => {
      cancelled = true;
      if (hlsRef.current) {
        try {
          hlsRef.current.destroy();
        } catch {
          // ignore
        }
        hlsRef.current = null;
      }
    };
  }, [streamUrl, isHls]);

  // Heartbeat every 30s while playing.
  useEffect(() => {
    const id = window.setInterval(() => {
      const video = videoRef.current;
      if (!video || video.paused || video.ended) return;
      void streamApi
        .heartbeat(sessionId, {
          position_seconds: video.currentTime,
          buffer_seconds: bufferAhead(video),
        })
        .catch(() => {
          // Heartbeats are advisory; backend will time-out the session if needed.
        });
    }, 30_000);
    return () => window.clearInterval(id);
  }, [sessionId]);

  // sendBeacon teardown on tab close, hide, and unmount.
  useEffect(() => {
    const onPageHide = () => teardownBeacon(sessionId);
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') teardownBeacon(sessionId);
    };
    window.addEventListener('pagehide', onPageHide, { capture: true });
    document.addEventListener('visibilitychange', onVisibility, { capture: true });
    return () => {
      window.removeEventListener('pagehide', onPageHide, { capture: true });
      document.removeEventListener('visibilitychange', onVisibility, {
        capture: true,
      });
      teardownBeacon(sessionId);
    };
  }, [sessionId]);

  // Render queued state instead of the player surface entirely.
  if (status?.state === 'queued') {
    const ahead = status.queue_position ?? 0;
    return (
      <div className="relative aspect-video w-full bg-black flex items-center justify-center">
        <div className="text-center space-y-3 px-6">
          <Loader2 className="mx-auto animate-spin text-fg/70" size={36} />
          <div className="text-fg text-lg font-medium">
            Queued{ahead > 0 ? ` — ${ahead} stream${ahead === 1 ? '' : 's'} ahead` : ''}
          </div>
          <div className="text-fg/60 text-sm">
            Waiting for an available transcoder slot.
          </div>
        </div>
      </div>
    );
  }

  const dotColor =
    status?.state === 'playing'
      ? 'bg-emerald-400'
      : status?.state === 'degraded'
        ? 'bg-red-400'
        : 'bg-amber-400';

  const showStallBanner =
    status?.state === 'degraded' && !stallDismissed;

  const pipelineLabel = pipeline ? PIPELINE_LABEL[pipeline] : 'Probing…';

  return (
    <div className="relative w-full bg-black">
      <video
        ref={videoRef}
        controls
        controlsList="nodownload"
        playsInline
        className="w-full h-full max-h-screen aspect-video bg-black"
        onLoadedMetadata={() => {
          const video = videoRef.current;
          if (!video) return;
          if (
            !seekedToResumeRef.current &&
            initialPositionSeconds &&
            initialPositionSeconds > 5
          ) {
            try {
              video.currentTime = initialPositionSeconds;
            } catch {
              // some browsers throw if metadata isn't seekable yet
            }
            seekedToResumeRef.current = true;
          }
        }}
        onTimeUpdate={() => {
          const video = videoRef.current;
          if (!video) return;
          const now = Date.now();
          if (now - lastPositionEmitRef.current < 5_000) return;
          lastPositionEmitRef.current = now;
          const dur = Number.isFinite(video.duration) ? video.duration : null;
          onPositionUpdate?.(video.currentTime, dur);
        }}
        onEnded={() => onEnded?.()}
      >
        {subtitleVttUrl ? (
          <track
            kind="subtitles"
            src={subtitleVttUrl}
            srcLang={subtitleLang ?? 'en'}
            default
          />
        ) : null}
      </video>

      <div className="pointer-events-none absolute top-3 left-3 z-10">
        <div className="inline-flex items-center gap-2 rounded-full bg-black/70 backdrop-blur text-fg/90 text-xs px-3 py-1.5 border border-white/10">
          <span className={`h-2 w-2 rounded-full ${dotColor}`} />
          <span>{pipelineLabel}</span>
          <span className="text-fg/40">·</span>
          <span>{status?.peers ?? 0} peers</span>
          <span className="text-fg/40">·</span>
          <span>{formatKbps(status?.download_kbps ?? 0)}</span>
        </div>
      </div>

      {showStallBanner ? (
        <div className="absolute top-0 left-0 right-0 z-20 px-3 pt-3">
          <div className="mx-auto max-w-3xl flex items-center gap-3 rounded-md bg-amber-500/15 border border-amber-400/40 px-3 py-2 text-sm text-amber-100 backdrop-blur">
            <AlertTriangle size={16} className="shrink-0 text-amber-300" />
            <span className="flex-1">This source is slow. Try another?</span>
            <button
              type="button"
              onClick={() => setStallDismissed(true)}
              className="rounded px-2 py-1 text-xs text-amber-100/80 hover:text-amber-50"
            >
              Keep waiting
            </button>
            <button
              type="button"
              onClick={() => onTryNextSource?.()}
              className="rounded bg-amber-400 hover:bg-amber-300 text-black px-2.5 py-1 text-xs font-medium"
            >
              Try next source
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
