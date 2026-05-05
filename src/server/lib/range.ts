// HTTP Range header parser. Pure function — no I/O.
//
// Returns:
//   null      → no Range header at all (treat as full request)
//   'invalid' → header present but malformed or unsatisfiable (caller responds 416)
//   {start,end} → satisfiable range, end clamped to size-1
export function parseRange(
  header: string | undefined,
  size: number,
): { start: number; end: number } | null | 'invalid' {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return 'invalid';
  const startStr = m[1];
  const endStr = m[2];
  let start: number;
  let end: number;
  if (startStr === '' && endStr === '') return 'invalid';
  if (startStr === '') {
    const suffix = Number(endStr);
    if (!Number.isFinite(suffix) || suffix <= 0) return 'invalid';
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(startStr);
    end = endStr === '' ? size - 1 : Number(endStr);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return 'invalid';
  }
  if (start < 0 || end < start || start >= size) return 'invalid';
  if (end >= size) end = size - 1;
  return { start, end };
}
