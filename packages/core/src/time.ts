const UNITS: Record<string, number> = {
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
};

/** Parse "72h", "3d", "90m", "1w", "1d12h" or a bare number of hours into milliseconds. */
export function parseDuration(input: string | number): number {
  if (typeof input === 'number') return input * UNITS.h;
  const s = input.trim().toLowerCase();
  if (/^\d+(\.\d+)?$/.test(s)) return parseFloat(s) * UNITS.h;
  const re = /(\d+(?:\.\d+)?)\s*([mhdw])/g;
  let total = 0;
  let consumed = '';
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    total += parseFloat(m[1]) * UNITS[m[2]];
    consumed += m[0];
  }
  if (!total || consumed.replace(/\s/g, '') !== s.replace(/\s/g, '')) {
    throw new Error(`Invalid duration "${input}". Use forms like 72h, 3d, 90m, 1w.`);
  }
  return total;
}

/** Compact human duration: "2d 5h", "41m", "<1m". */
export function formatDuration(ms: number): string {
  if (ms < 60_000) return '<1m';
  ms = Math.ceil(ms / 60_000) * 60_000; // 71h59m59s reads as 3d, not 2d 23h
  const d = Math.floor(ms / UNITS.d);
  const h = Math.floor((ms % UNITS.d) / UNITS.h);
  const m = Math.floor((ms % UNITS.h) / UNITS.m);
  if (d > 0) return h ? `${d}d ${h}h` : `${d}d`;
  if (h > 0) return m && h < 6 ? `${h}h ${m}m` : `${h}h`;
  return `${m}m`;
}
