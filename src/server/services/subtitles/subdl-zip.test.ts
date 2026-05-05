import { describe, it, expect } from 'vitest';
import AdmZip from 'adm-zip';
import { extractFirstSubFromZip } from './subdl.js';

function buildZip(files: Array<{ name: string; content: string }>): Buffer {
  const zip = new AdmZip();
  for (const f of files) {
    zip.addFile(f.name, Buffer.from(f.content, 'utf8'));
  }
  return zip.toBuffer();
}

describe('extractFirstSubFromZip', () => {
  it('zip with one .srt file → returns srt body and ext', () => {
    const buf = buildZip([{ name: 'movie.srt', content: '1\n00:00:01,000 --> 00:00:02,000\nHello\n' }]);
    const result = extractFirstSubFromZip(buf);
    expect(result).toEqual({
      body: '1\n00:00:01,000 --> 00:00:02,000\nHello\n',
      ext: '.srt',
    });
  });

  it('zip with one .vtt file → returns vtt body and ext', () => {
    const buf = buildZip([{ name: 'movie.vtt', content: 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHi\n' }]);
    const result = extractFirstSubFromZip(buf);
    expect(result).toEqual({
      body: 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHi\n',
      ext: '.vtt',
    });
  });

  it('zip with both .srt AND .vtt → returns the .srt (priority order)', () => {
    const buf = buildZip([
      { name: 'movie.vtt', content: 'WEBVTT\n' },
      { name: 'movie.srt', content: 'SRT-CONTENT' },
    ]);
    const result = extractFirstSubFromZip(buf);
    expect(result).toMatchObject({ body: 'SRT-CONTENT', ext: '.srt' });
  });

  it('zip with .ass + .srt → returns the .srt', () => {
    const buf = buildZip([
      { name: 'movie.ass', content: '[Script Info]\n' },
      { name: 'movie.srt', content: 'SRT-CONTENT' },
    ]);
    const result = extractFirstSubFromZip(buf);
    expect(result).toMatchObject({ body: 'SRT-CONTENT', ext: '.srt' });
  });

  it('zip with only .ass → returns ass body and ext', () => {
    const buf = buildZip([{ name: 'movie.ass', content: '[Script Info]\nTitle: Test\n' }]);
    const result = extractFirstSubFromZip(buf);
    expect(result).toMatchObject({ body: '[Script Info]\nTitle: Test\n', ext: '.ass' });
  });

  it('empty zip → null', () => {
    const buf = buildZip([]);
    expect(extractFirstSubFromZip(buf)).toBeNull();
  });

  it('zip with only .txt junk → null', () => {
    const buf = buildZip([
      { name: 'readme.txt', content: 'about the rip' },
      { name: 'notes.txt', content: 'release notes' },
    ]);
    expect(extractFirstSubFromZip(buf)).toBeNull();
  });

  it('corrupt buffer → null (AdmZip throw is handled)', () => {
    const garbage = Buffer.from('not a zip file at all, just random bytes here');
    expect(extractFirstSubFromZip(garbage)).toBeNull();
  });
});
