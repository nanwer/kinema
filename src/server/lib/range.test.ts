import { describe, it, expect } from 'vitest';
import { parseRange } from './range.js';

describe('parseRange', () => {
  it('bytes=0-1023 size=10000 → {start:0, end:1023}', () => {
    expect(parseRange('bytes=0-1023', 10000)).toEqual({ start: 0, end: 1023 });
  });

  it('bytes=100- size=10000 → {start:100, end:9999}', () => {
    expect(parseRange('bytes=100-', 10000)).toEqual({ start: 100, end: 9999 });
  });

  it('bytes=-200 size=10000 → suffix range from end', () => {
    expect(parseRange('bytes=-200', 10000)).toEqual({ start: 9800, end: 9999 });
  });

  it('bytes=0-99999 size=10000 → end clamped to size-1', () => {
    expect(parseRange('bytes=0-99999', 10000)).toEqual({ start: 0, end: 9999 });
  });

  it('bytes=10000-20000 size=10000 → invalid (start >= size)', () => {
    expect(parseRange('bytes=10000-20000', 10000)).toBe('invalid');
  });

  it('bytes=500-100 size=10000 → invalid (end < start)', () => {
    expect(parseRange('bytes=500-100', 10000)).toBe('invalid');
  });

  it('bytes=abc-def → invalid (non-numeric)', () => {
    expect(parseRange('bytes=abc-def', 10000)).toBe('invalid');
  });

  it('undefined → null (no range header is full request, not invalid)', () => {
    expect(parseRange(undefined, 10000)).toBeNull();
  });

  it('bytes= → invalid (no start, no end)', () => {
    expect(parseRange('bytes=', 10000)).toBe('invalid');
  });

  it('bytes=-0 → invalid (zero-length suffix)', () => {
    expect(parseRange('bytes=-0', 10000)).toBe('invalid');
  });

  it('bytes=0-0 → {start:0, end:0} (single byte)', () => {
    expect(parseRange('bytes=0-0', 10000)).toEqual({ start: 0, end: 0 });
  });

  it('whitespace around header is trimmed', () => {
    expect(parseRange('  bytes=0-99  ', 1000)).toEqual({ start: 0, end: 99 });
  });

  it('completely malformed header → invalid', () => {
    expect(parseRange('items=0-99', 10000)).toBe('invalid');
  });
});
