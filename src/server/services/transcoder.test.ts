import { describe, it, expect } from 'vitest';
import { decide, type ProbeResult, type TranscodeInput } from './transcoder.js';

const CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const SAFARI_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';

function probe(overrides: Partial<ProbeResult> = {}): ProbeResult {
  return {
    container: 'mp4',
    videoCodec: 'h264',
    videoProfile: 'High',
    audioCodec: 'aac',
    audioChannels: 2,
    isVfr: false,
    subtitleStreams: [],
    durationSeconds: 3600,
    ...overrides,
  };
}

function input(overrides: Partial<TranscodeInput> = {}): TranscodeInput {
  return {
    sessionId: 'sess-1',
    filePath: '/tmp/file.mp4',
    userAgent: CHROME_UA,
    ...overrides,
  };
}

describe('decide', () => {
  it('MP4 + H.264 + AAC + no subs + CFR → direct', async () => {
    const d = await decide(probe(), input());
    expect(d.pipeline).toBe('direct');
  });

  it('MKV + H.264 + AAC → remux', async () => {
    const d = await decide(probe({ container: 'mkv' }), input());
    expect(d.pipeline).toBe('remux');
  });

  it('MP4 + H.264 + DTS → audio_only', async () => {
    const d = await decide(probe({ audioCodec: 'dts' }), input());
    expect(d.pipeline).toBe('audio_only');
  });

  it('MP4 + H.264 + AAC + ASS subs + burnInOptIn=false → subs_convert', async () => {
    const d = await decide(
      probe(),
      input({
        desiredSubtitles: { vttPath: '/tmp/sub.vtt', format: 'ass' },
        burnInOptIn: false,
      }),
    );
    expect(d.pipeline).toBe('subs_convert');
  });

  it('MP4 + H.264 + AAC + ASS subs + burnInOptIn=true → burn_in', async () => {
    const d = await decide(
      probe(),
      input({
        desiredSubtitles: { vttPath: '/tmp/sub.vtt', format: 'ass' },
        burnInOptIn: true,
      }),
    );
    expect(d.pipeline).toBe('burn_in');
  });

  it('MP4 + H.264 + AAC + PGS subs → burn_in (opt-in irrelevant)', async () => {
    const d = await decide(
      probe(),
      input({
        desiredSubtitles: { vttPath: '/tmp/sub.vtt', format: 'pgs' },
        burnInOptIn: false,
      }),
    );
    expect(d.pipeline).toBe('burn_in');
  });

  it('MKV + HEVC on Chrome → full_transcode', async () => {
    const d = await decide(
      probe({ container: 'mkv', videoCodec: 'hevc' }),
      input({ userAgent: CHROME_UA }),
    );
    expect(d.pipeline).toBe('full_transcode');
  });

  it('MKV + HEVC on Safari → not full_transcode (videoOk on safari, container wrong → remux)', async () => {
    const d = await decide(
      probe({ container: 'mkv', videoCodec: 'hevc' }),
      input({ userAgent: SAFARI_UA }),
    );
    expect(d.pipeline).not.toBe('full_transcode');
    expect(d.pipeline).toBe('remux');
  });

  it('MP4 + AV1 + AAC on Chrome → direct', async () => {
    const d = await decide(
      probe({ videoCodec: 'av1', videoProfile: null }),
      input({ userAgent: CHROME_UA }),
    );
    expect(d.pipeline).toBe('direct');
  });

  it('MP4 + AV1 + AAC on Safari → full_transcode (AV1 not browser-friendly)', async () => {
    const d = await decide(
      probe({ videoCodec: 'av1', videoProfile: null }),
      input({ userAgent: SAFARI_UA }),
    );
    expect(d.pipeline).toBe('full_transcode');
  });

  it('VFR detected → full_transcode', async () => {
    const d = await decide(probe({ isVfr: true }), input());
    expect(d.pipeline).toBe('full_transcode');
  });

  it('H.264 High 10 profile → full_transcode (videoOk false)', async () => {
    const d = await decide(probe({ videoProfile: 'High 10' }), input());
    expect(d.pipeline).toBe('full_transcode');
  });

  it('non-direct decisions include outputDir + playlistUrl', async () => {
    const d = await decide(probe({ container: 'mkv' }), input());
    expect(d.pipeline).toBe('remux');
    expect(d.outputDir).toMatch(/transcode\/sess-1$/);
    expect(d.playlistUrl).toBe('/playlist.m3u8');
  });
});
