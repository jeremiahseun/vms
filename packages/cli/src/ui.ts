const color = (process.stdout.isTTY || process.stderr.isTTY) && !process.env.NO_COLOR;
const wrap = (code: string) => (s: string) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);

export const c = {
  bold: wrap('1'),
  dim: wrap('2'),
  red: wrap('31'),
  green: wrap('32'),
  yellow: wrap('33'),
  blue: wrap('34'),
  cyan: wrap('36'),
};

export const out = (s = ''): void => void process.stdout.write(s + '\n');
export const err = (s = ''): void => void process.stderr.write(s + '\n');
export const ok = (s: string) => out(`${c.green('✔')} ${s}`);
export const warn = (s: string) => err(`${c.yellow('⚠')} ${s}`);

export function table(rows: string[][]): string {
  // eslint-disable-next-line no-control-regex
  const visible = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '').length;
  const widths: number[] = [];
  for (const r of rows)
    r.forEach((cell, i) => (widths[i] = Math.max(widths[i] ?? 0, visible(cell))));
  return rows
    .map((r) =>
      r
        .map((cell, i) =>
          i === r.length - 1 ? cell : cell + ' '.repeat(widths[i] - visible(cell)),
        )
        .join('  '),
    )
    .join('\n');
}

export async function confirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  process.stderr.write(`${question} [y/N] `);
  return new Promise((resolve) => {
    process.stdin.setEncoding('utf8');
    process.stdin.once('data', (d) => {
      process.stdin.pause();
      resolve(/^y(es)?$/i.test(String(d).trim()));
    });
  });
}
