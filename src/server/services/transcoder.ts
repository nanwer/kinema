import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import type { Pipeline } from '../../shared/types.js';
import { env } from '../env.js';
import { logger } from '../logger.js';

export type SubtitleFormat = 'vtt' | 'ass' | 'ssa' | 'pgs';

export type TranscodeInput = {
  sessionId: string;
  filePath: string;
  // Optional readable stream that yields the input file's bytes from 0 to
  // end. When provided, ffmpeg reads from `pipe:0` and the stream is piped
  // into stdin. This is critical when the underlying file is being written
  // concurrently (e.g. by WebTorrent) — reading the file directly hits the
  // current EOF and ffmpeg exits prematurely.
  inputStream?: NodeJS.ReadableStream;
  userAgent: string;
  desiredSubtitles?: { vttPath: string; format: SubtitleFormat };
  burnInOptIn?: boolean;
};

export type TranscodeDecision = {
  pipeline: Pipeline;
  outputDir?: string;
  playlistUrl?: string;
};

export type ProbeStream = {
  index: number;
  codec_type: 'video' | 'audio' | 'subtitle' | string;
  codec_name?: string;
  profile?: string;
  channels?: number;
  channel_layout?: string;
  avg_frame_rate?: string;
  r_frame_rate?: string;
};

export type SubtitleStreamInfo = {
  index: number;
  codec: string;
};

export type ProbeResult = {
  container: string;
  videoCodec: string | null;
  videoProfile: string | null;
  audioCodec: string | null;
  audioChannels: number | null;
  isVfr: boolean;
  subtitleStreams: SubtitleStreamInfo[];
  durationSeconds: number | null;
};

const BROWSER_FRIENDLY_CONTAINERS = new Set(['mp4', 'webm', 'mov']);
const BROWSER_FRIENDLY_VIDEO = new Set(['h264', 'vp9']);
const BROWSER_FRIENDLY_AUDIO = new Set(['aac', 'opus', 'mp3']);
const VIDEO_HIGH10_PROFILES = new Set(['High 10', 'High 4:2:2', 'High 4:4:4 Predictive']);

function detectBrowser(ua: string): 'safari' | 'chromium' | 'firefox' | 'other' {
  const u = ua.toLowerCase();
  // Order matters: Safari ID must exclude Chrome/Edge.
  if (u.includes('edg/') || u.includes('chrome/')) return 'chromium';
  if (u.includes('firefox/')) return 'firefox';
  if (u.includes('safari/')) return 'safari';
  return 'other';
}

function parseFrameRate(s: string | undefined): number | null {
  if (!s) return null;
  const m = s.match(/^(\d+)\/(\d+)$/);
  if (!m) {
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  const num = Number(m[1]);
  const den = Number(m[2]);
  if (!den) return null;
  return num / den;
}

function detectContainer(formatName: string | undefined, filePath: string): string {
  if (formatName) {
    const first = formatName.split(',')[0]?.trim().toLowerCase();
    if (first) return first;
  }
  const ext = path.extname(filePath).slice(1).toLowerCase();
  return ext;
}

export function probe(filePath: string): Promise<ProbeResult> {
  return new Promise((resolve, reject) => {
    const args = [
      '-v',
      'error',
      '-print_format',
      'json',
      '-show_streams',
      '-show_format',
      filePath,
    ];
    const proc = spawn('ffprobe', args);
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (b) => (stdout += b.toString()));
    proc.stderr.on('data', (b) => (stderr += b.toString()));
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`ffprobe exited ${code}: ${stderr}`));
      }
      try {
        const json = JSON.parse(stdout);
        const streams: ProbeStream[] = json.streams ?? [];
        const video = streams.find((s) => s.codec_type === 'video');
        const audio = streams.find((s) => s.codec_type === 'audio');
        const subs = streams
          .filter((s) => s.codec_type === 'subtitle')
          .map((s) => ({ index: s.index, codec: s.codec_name ?? 'unknown' }));

        const avg = parseFrameRate(video?.avg_frame_rate);
        const r = parseFrameRate(video?.r_frame_rate);
        // VFR heuristic: average and reported framerates diverge meaningfully.
        const isVfr = avg !== null && r !== null && Math.abs(avg - r) > 0.5;

        resolve({
          container: detectContainer(json.format?.format_name, filePath),
          videoCodec: video?.codec_name ?? null,
          videoProfile: video?.profile ?? null,
          audioCodec: audio?.codec_name ?? null,
          audioChannels: audio?.channels ?? null,
          isVfr,
          subtitleStreams: subs,
          durationSeconds: json.format?.duration ? Number(json.format.duration) : null,
        });
      } catch (err) {
        reject(err);
      }
    });
  });
}

export async function decide(
  p: ProbeResult,
  input: TranscodeInput,
): Promise<TranscodeDecision> {
  const browser = detectBrowser(input.userAgent);
  const subFmt = input.desiredSubtitles?.format;
  const burnIn = !!input.burnInOptIn;

  // Burn-in is forced for image-based subtitles like PGS.
  const subsForcedBurnIn = subFmt === 'pgs';
  // Text-based subs (ASS/SSA) get a cheap convert-to-VTT path unless user opts into burn-in.
  const subsConvertOnly = (subFmt === 'ass' || subFmt === 'ssa') && !burnIn;
  const subsBurnIn = subsForcedBurnIn || ((subFmt === 'ass' || subFmt === 'ssa') && burnIn);

  const containerOk = BROWSER_FRIENDLY_CONTAINERS.has(p.container);
  const audioOk =
    p.audioCodec !== null &&
    BROWSER_FRIENDLY_AUDIO.has(p.audioCodec) &&
    (p.audioChannels === null || p.audioChannels <= 2);

  let videoOk = false;
  if (p.videoCodec === 'h264') {
    videoOk = !p.videoProfile || !VIDEO_HIGH10_PROFILES.has(p.videoProfile);
  } else if (p.videoCodec === 'vp9') {
    videoOk = true;
  } else if (p.videoCodec === 'av1') {
    videoOk = browser === 'chromium' || browser === 'firefox';
  } else if (p.videoCodec === 'hevc') {
    videoOk = browser === 'safari';
  }
  if (p.isVfr) videoOk = false;

  // 1. Direct play
  if (containerOk && videoOk && audioOk && !subsConvertOnly && !subsBurnIn) {
    return { pipeline: 'direct' };
  }

  const outputDir = path.join(env.DATA_DIR, 'transcode', input.sessionId);
  const playlistUrl = '/playlist.m3u8';

  // 2. Subs convert: video pipeline cheap, only subtitle stream is rewritten.
  if (subsConvertOnly && videoOk && audioOk && containerOk) {
    return { pipeline: 'subs_convert', outputDir, playlistUrl };
  }

  // 5. Burn-in (PGS or ASS/SSA + opt-in) — must transcode video to apply -vf subtitles.
  if (subsBurnIn) {
    return { pipeline: 'burn_in', outputDir, playlistUrl };
  }

  // 3. Remux: codecs all browser-friendly, container wrong.
  if (videoOk && audioOk && !containerOk) {
    return { pipeline: 'remux', outputDir, playlistUrl };
  }

  // 4. Audio-only: video OK, audio is incompatible (DTS, EAC3, TrueHD, >2ch).
  if (videoOk && !audioOk) {
    return { pipeline: 'audio_only', outputDir, playlistUrl };
  }

  // 6. Full transcode.
  return { pipeline: 'full_transcode', outputDir, playlistUrl };
}

function hlsCommonArgs(outputDir: string): string[] {
  // 6-second segments, 5-segment rolling window, delete older segments.
  return [
    '-f',
    'hls',
    '-hls_time',
    '6',
    '-hls_list_size',
    '5',
    '-hls_flags',
    'delete_segments+independent_segments+omit_endlist',
    '-hls_segment_filename',
    path.join(outputDir, 'seg_%05d.ts'),
    path.join(outputDir, 'playlist.m3u8'),
  ];
}

function buildFfmpegArgs(
  pipeline: Pipeline,
  input: TranscodeInput,
  outputDir: string,
): string[] {
  const inFile = input.inputStream ? 'pipe:0' : input.filePath;
  switch (pipeline) {
    case 'remux':
      return [
        '-hide_banner',
        '-nostats',
        '-i',
        inFile,
        '-map',
        '0:v:0',
        '-map',
        '0:a:0?',
        '-c',
        'copy',
        '-movflags',
        '+frag_keyframe+empty_moov',
        ...hlsCommonArgs(outputDir),
      ];
    case 'audio_only':
      return [
        '-hide_banner',
        '-nostats',
        '-i',
        inFile,
        '-map',
        '0:v:0',
        '-map',
        '0:a:0?',
        '-c:v',
        'copy',
        '-c:a',
        'aac',
        '-ac',
        '2',
        '-b:a',
        '192k',
        ...hlsCommonArgs(outputDir),
      ];
    case 'subs_convert':
      // Video and audio are already client-friendly; we still wrap as HLS so the player has a single transport.
      // The actual subtitle conversion to VTT is handled by the subtitles service before this runs;
      // this pipeline copies A/V into HLS without re-encoding.
      return [
        '-hide_banner',
        '-nostats',
        '-i',
        inFile,
        '-map',
        '0:v:0',
        '-map',
        '0:a:0?',
        '-c',
        'copy',
        ...hlsCommonArgs(outputDir),
      ];
    case 'burn_in': {
      const subPath = input.desiredSubtitles?.vttPath;
      if (!subPath) throw new Error('burn_in pipeline requires desiredSubtitles.vttPath');
      // ffmpeg's subtitles filter wants paths with colons/commas escaped.
      const escaped = subPath.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'");
      return [
        '-hide_banner',
        '-nostats',
        '-i',
        inFile,
        '-map',
        '0:v:0',
        '-map',
        '0:a:0?',
        '-vf',
        `subtitles='${escaped}'`,
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '22',
        '-c:a',
        'aac',
        '-ac',
        '2',
        '-b:a',
        '192k',
        ...hlsCommonArgs(outputDir),
      ];
    }
    case 'full_transcode':
      return [
        '-hide_banner',
        '-nostats',
        '-i',
        inFile,
        '-map',
        '0:v:0',
        '-map',
        '0:a:0?',
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '22',
        '-c:a',
        'aac',
        '-ac',
        '2',
        '-b:a',
        '192k',
        ...hlsCommonArgs(outputDir),
      ];
    case 'direct':
      throw new Error('direct pipeline does not run ffmpeg');
    default: {
      const _exhaustive: never = pipeline;
      throw new Error(`unknown pipeline: ${_exhaustive as string}`);
    }
  }
}

export async function start(
  decision: TranscodeDecision,
  input: TranscodeInput,
): Promise<{ stop: () => Promise<void> }> {
  if (decision.pipeline === 'direct') {
    return { stop: async () => {} };
  }
  if (!decision.outputDir) {
    throw new Error('non-direct pipeline requires outputDir');
  }

  const outputDir = decision.outputDir;
  if (existsSync(outputDir)) {
    rmSync(outputDir, { recursive: true, force: true });
  }
  mkdirSync(outputDir, { recursive: true });

  const args = buildFfmpegArgs(decision.pipeline, input, outputDir);
  logger.info(
    { sessionId: input.sessionId, pipeline: decision.pipeline, outputDir },
    'spawning ffmpeg',
  );
  logger.debug({ sessionId: input.sessionId, args }, 'ffmpeg args');

  const useStdin = !!input.inputStream;
  const child: ChildProcess = spawn('ffmpeg', args, {
    stdio: [useStdin ? 'pipe' : 'ignore', 'pipe', 'pipe'],
  });

  if (useStdin && input.inputStream && child.stdin) {
    // Pipe WebTorrent's read stream into ffmpeg's stdin. The stream blocks on
    // un-downloaded pieces, so ffmpeg waits naturally as the head-of-file
    // sequential download progresses. Errors here are usually benign (e.g.
    // ffmpeg closing stdin on its own when it's done with input).
    input.inputStream.on('error', (err: unknown) => {
      logger.warn({ sessionId: input.sessionId, err: String(err) }, 'transcode input stream error');
    });
    child.stdin.on('error', (err: unknown) => {
      logger.debug({ sessionId: input.sessionId, err: String(err) }, 'ffmpeg stdin pipe error');
    });
    input.inputStream.pipe(child.stdin);
  }

  child.stderr?.on('data', (b: Buffer) => {
    logger.debug({ sessionId: input.sessionId, ffmpeg: b.toString().trim() }, 'ffmpeg');
  });
  child.on('error', (err) => {
    logger.error({ sessionId: input.sessionId, err }, 'ffmpeg spawn error');
  });
  child.on('close', (code, signal) => {
    if (code === 0 || signal === 'SIGTERM') {
      logger.info({ sessionId: input.sessionId, code, signal }, 'ffmpeg exited');
    } else {
      logger.error({ sessionId: input.sessionId, code, signal }, 'ffmpeg crashed');
    }
  });

  let stopped = false;
  const stop = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    if (child.exitCode === null && !child.killed) {
      child.kill('SIGTERM');
      // Give ffmpeg ~2s to flush; then force-kill.
      await new Promise<void>((resolve) => {
        const t = setTimeout(() => {
          if (child.exitCode === null) child.kill('SIGKILL');
          resolve();
        }, 2000);
        child.once('close', () => {
          clearTimeout(t);
          resolve();
        });
      });
    }
    try {
      rmSync(outputDir, { recursive: true, force: true });
    } catch (err) {
      logger.warn({ sessionId: input.sessionId, err }, 'failed to clean transcode dir');
    }
  };

  return { stop };
}
