import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Config } from './types';

export const DEFAULT_TTL = '72h';

/** Every filesystem location VWS uses. Passed around so tests can sandbox it. */
export interface Context {
  /** State dir, default ~/.vws (override: VWS_HOME). */
  home: string;
  stateFile: string;
  configFile: string;
  lockDir: string;
  trashDir: string;
  logFile: string;
  config: Config;
  /** Folder workspace folders are created in (override: VWS_ROOT or config.root). */
  workspacesDir: string;
  platform: NodeJS.Platform;
  now: () => number;
}

export function expandHome(p: string): string {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(os.homedir(), p.slice(2));
  return p;
}

export function createContext(
  opts: { home?: string; workspacesDir?: string; now?: () => number } = {},
): Context {
  const home = path.resolve(
    expandHome(opts.home ?? process.env.VWS_HOME ?? path.join(os.homedir(), '.vws')),
  );
  const configFile = path.join(home, 'config.json');
  let config: Config = {};
  try {
    config = JSON.parse(fs.readFileSync(configFile, 'utf8')) as Config;
  } catch {
    /* no config yet */
  }
  const workspacesDir = path.resolve(
    expandHome(
      opts.workspacesDir ?? process.env.VWS_ROOT ?? config.root ?? path.join(os.homedir(), 'vws'),
    ),
  );
  return {
    home,
    stateFile: path.join(home, 'state.json'),
    configFile,
    lockDir: path.join(home, 'state.lock'),
    trashDir: path.join(home, 'trash'),
    logFile: path.join(home, 'vws.log'),
    config,
    workspacesDir,
    platform: process.platform,
    now: opts.now ?? Date.now,
  };
}

export function saveConfig(ctx: Context, config: Config): void {
  fs.mkdirSync(ctx.home, { recursive: true });
  fs.writeFileSync(ctx.configFile, JSON.stringify(config, null, 2) + '\n');
  ctx.config = config;
}

export function log(ctx: Context, message: string): void {
  try {
    fs.mkdirSync(ctx.home, { recursive: true });
    fs.appendFileSync(ctx.logFile, `[${new Date(ctx.now()).toISOString()}] ${message}\n`);
  } catch {
    /* logging must never break a command */
  }
}
