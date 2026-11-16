import * as fs from 'node:fs';
import * as path from 'node:path';

/** Locate the HEAD file for a repo root, handling worktrees and submodules (.git file). */
function headFile(dir: string): string | null {
  const dotGit = path.join(dir, '.git');
  try {
    const st = fs.statSync(dotGit);
    if (st.isDirectory()) return path.join(dotGit, 'HEAD');
    const m = /^gitdir:\s*(.+)\s*$/m.exec(fs.readFileSync(dotGit, 'utf8'));
    if (m) return path.join(path.resolve(dir, m[1].trim()), 'HEAD');
  } catch {
    /* not a repo root */
  }
  return null;
}

/** Current branch without spawning git (fast). Detached HEAD returns the short sha. */
export function gitBranch(dir: string): string | null {
  const head = headFile(dir);
  if (!head) return null;
  try {
    const content = fs.readFileSync(head, 'utf8').trim();
    const ref = /^ref:\s*refs\/heads\/(.+)$/.exec(content);
    if (ref) return ref[1];
    if (/^[0-9a-f]{40,64}$/.test(content)) return `detached@${content.slice(0, 7)}`;
  } catch {
    /* unreadable */
  }
  return null;
}
