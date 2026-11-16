import * as fs from 'node:fs';

const STALE_MS = 15_000;
const TIMEOUT_MS = 8_000;
const sleeper = new Int32Array(new SharedArrayBuffer(4));

function sleep(ms: number): void {
  Atomics.wait(sleeper, 0, 0, ms);
}

/** Cross-process mutex using an atomic mkdir. Keeps CLI and editor extension from racing. */
export function withLock<T>(lockDir: string, fn: () => T): T {
  const start = Date.now();
  for (;;) {
    try {
      fs.mkdirSync(lockDir);
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      try {
        if (Date.now() - fs.statSync(lockDir).mtimeMs > STALE_MS) {
          fs.rmdirSync(lockDir);
          continue;
        }
      } catch {
        continue;
      }
      if (Date.now() - start > TIMEOUT_MS) {
        throw new Error(
          `Timed out waiting for lock ${lockDir}. If no other vws is running, delete it.`,
        );
      }
      sleep(25);
    }
  }
  try {
    return fn();
  } finally {
    try {
      fs.rmdirSync(lockDir);
    } catch {
      /* already gone */
    }
  }
}
