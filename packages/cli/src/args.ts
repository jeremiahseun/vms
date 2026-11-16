export interface Parsed {
  _: string[];
  flags: Record<string, string | boolean>;
  /** Everything after a bare "--", passed through to launched tools. */
  rest: string[];
}

/**
 * Tiny argv parser. `valueFlags` lists flags that take a value; everything else is boolean.
 * Supports --flag value, --flag=value, -y and a trailing "--" passthrough.
 */
export function parseArgs(
  argv: string[],
  valueFlags: Set<string>,
  aliases: Record<string, string> = {},
): Parsed {
  const out: Parsed = { _: [], flags: {}, rest: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') {
      out.rest = argv.slice(i + 1);
      break;
    }
    if (a.startsWith('--') || (a.startsWith('-') && a.length === 2 && !/\d/.test(a[1]))) {
      let key = a.replace(/^--?/, '');
      let value: string | undefined;
      const eq = key.indexOf('=');
      if (eq >= 0) {
        value = key.slice(eq + 1);
        key = key.slice(0, eq);
      }
      key = aliases[key] ?? key;
      if (valueFlags.has(key)) {
        if (value === undefined) {
          value = argv[++i];
          if (value === undefined) throw new Error(`--${key} needs a value`);
        }
        out.flags[key] = value;
      } else {
        out.flags[key] = value === undefined ? true : value !== 'false';
      }
    } else {
      out._.push(a);
    }
  }
  return out;
}
