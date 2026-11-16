import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Context } from './context';
import { withLock } from './lock';
import type { State } from './types';

function empty(): State {
  return { version: 2, workspaces: {} };
}

/** Read state without locking (fast path for read-only commands). */
export function readState(ctx: Context): State {
  try {
    const raw = JSON.parse(fs.readFileSync(ctx.stateFile, 'utf8')) as State;
    if (raw && raw.version === 2 && raw.workspaces) return raw;
  } catch {
    /* missing or corrupt -> start fresh */
  }
  return empty();
}

function writeState(ctx: Context, state: State): void {
  const tmp = `${ctx.stateFile}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n');
  fs.renameSync(tmp, ctx.stateFile);
}

/** Read-modify-write the state under an exclusive lock, atomically. */
export function updateState<T>(ctx: Context, fn: (state: State) => T): T {
  fs.mkdirSync(ctx.home, { recursive: true });
  return withLock(ctx.lockDir, () => {
    const state = readState(ctx);
    const result = fn(state);
    writeState(ctx, state);
    return result;
  });
}

export function ensureDir(p: string): void {
  fs.mkdirSync(path.resolve(p), { recursive: true });
}
