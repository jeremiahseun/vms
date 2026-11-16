import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function gitOk(cwd: string, args: string[]): boolean {
  try {
    git(cwd, args);
    return true;
  } catch {
    return false;
  }
}

export interface WorktreeEntry {
  path: string;
  branch: string | null;
}

export function listWorktrees(repo: string): WorktreeEntry[] {
  const out = git(repo, ['worktree', 'list', '--porcelain']);
  const entries: WorktreeEntry[] = [];
  for (const block of out.split(/\n\n+/)) {
    const p = /^worktree (.+)$/m.exec(block)?.[1];
    if (!p) continue;
    const b = /^branch refs\/heads\/(.+)$/m.exec(block)?.[1] ?? null;
    entries.push({ path: realOr(p), branch: b });
  }
  return entries;
}

function realOr(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}

/** The main checkout of the repo containing `dir` (works when given a linked worktree too). */
export function mainRepo(dir: string): string {
  let top: string;
  try {
    top = git(dir, ['rev-parse', '--show-toplevel']);
  } catch {
    throw new Error(`${dir} is not inside a git repository, so it can't use a branch.`);
  }
  return listWorktrees(top)[0]?.path ?? realOr(top);
}

export function validateBranch(repo: string, branch: string): void {
  if (!branch || !gitOk(repo, ['check-ref-format', '--branch', branch])) {
    throw new Error(`"${branch}" is not a valid branch name.`);
  }
}

export function branchSlug(branch: string): string {
  return branch.replace(/[\\/:*?"<>|\s]+/g, '-');
}

export interface EnsuredWorktree {
  path: string;
  /** Human note about what happened (reused, created, new branch). */
  note: string;
}

/**
 * Get a checkout of `branch` for the repo. Reuses any existing checkout of that branch (git allows
 * a branch in only one worktree); otherwise creates one under `worktreesDir`.
 */
export function ensureWorktree(
  repoDir: string,
  branch: string,
  worktreesDir: string,
): EnsuredWorktree {
  const repo = mainRepo(repoDir);
  validateBranch(repo, branch);
  const existing = listWorktrees(repo).find((w) => w.branch === branch);
  if (existing && fs.existsSync(existing.path)) {
    return { path: existing.path, note: `using existing checkout of ${branch}` };
  }
  gitOk(repo, ['worktree', 'prune']);
  const dir = path.join(worktreesDir, path.basename(repo), branchSlug(branch));
  if (fs.existsSync(dir))
    throw new Error(`${dir} already exists but is not a checkout of ${branch}.`);
  fs.mkdirSync(path.dirname(dir), { recursive: true });

  const local = gitOk(repo, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`]);
  const remotes = local
    ? []
    : git(repo, ['for-each-ref', '--format=%(refname:short)', `refs/remotes/*/${branch}`])
        .split('\n')
        .filter(Boolean);
  let note: string;
  if (local) {
    git(repo, ['worktree', 'add', dir, branch]);
    note = `checked out ${branch}`;
  } else if (remotes.length) {
    git(repo, ['worktree', 'add', '--track', '-b', branch, dir, remotes[0]]);
    note = `checked out ${branch} tracking ${remotes[0]}`;
  } else {
    const base = git(repo, ['rev-parse', '--abbrev-ref', 'HEAD']);
    git(repo, ['worktree', 'add', '-b', branch, dir]);
    note = `created new branch ${branch} from ${base}`;
  }
  return { path: fs.realpathSync(dir), note };
}

/** Uncommitted or untracked changes? Errors count as dirty (never risk losing work). */
export function isDirty(dir: string): boolean {
  try {
    return git(dir, ['status', '--porcelain']).length > 0;
  } catch {
    return true;
  }
}

export type ReleaseOutcome = 'removed' | 'kept-dirty' | 'kept-error';

/** Remove a VWS-created worktree if (and only if) it has no uncommitted work. Branch is kept. */
export function removeWorktree(repo: string, dir: string): ReleaseOutcome {
  if (!fs.existsSync(dir)) {
    gitOk(repo, ['worktree', 'prune']);
    return 'removed';
  }
  if (isDirty(dir)) return 'kept-dirty';
  try {
    git(repo, ['worktree', 'remove', dir]); // no --force: git refuses if anything is unsaved
    return 'removed';
  } catch {
    return 'kept-error';
  }
}
