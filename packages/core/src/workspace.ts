import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { type Context, DEFAULT_KEEP_EXPIRED, DEFAULT_TTL, expandHome, log } from './context';
import { MARKER, managedFiles } from './generate';
import { gitBranch } from './git';
import { createLink, exists, isLink, linkTarget, removeLink } from './links';
import { readState, updateState } from './store';
import { parseDuration } from './time';
import type { Member, MemberStatus, State, Workspace } from './types';
import {
  branchSlug,
  ensureWorktree,
  isDirty,
  mainRepo,
  removeWorktree,
  validateBranch,
} from './worktree';

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const RESERVED = new Set([MARKER, 'AGENTS.md', 'CLAUDE.md', '.claude', '.vscode']);

interface Marker {
  vws: 2;
  name: string;
  /** relative path -> sha256 of the content VWS last wrote. */
  managed: Record<string, string>;
}

export interface MemberSpec {
  path: string;
  alias?: string;
  /** Check out this branch of the repo at `path` as a git worktree. */
  branch?: string;
}

export interface TeardownResult {
  /** Where leftover user files were moved, if any. */
  trashedTo: string | null;
}

export interface ReleaseResult extends TeardownResult {
  /** VWS-created worktrees that were kept because they hold uncommitted work. */
  keptWorktrees: string[];
}

// ─── helpers ────────────────────────────────────────────────────────────────

function sha(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

export function validateName(name: string): void {
  if (!NAME_RE.test(name)) {
    throw new Error(
      `Invalid workspace name "${name}". Use letters, digits, ".", "_" or "-" (max 64, starts alphanumeric).`,
    );
  }
}

function must(state: State, name: string): Workspace {
  const ws = state.workspaces[name];
  if (!ws) {
    const names = Object.keys(state.workspaces);
    throw new Error(
      `No workspace named "${name}".` + (names.length ? ` Known: ${names.join(', ')}` : ''),
    );
  }
  return ws;
}

function resolveMemberPath(p: string, base = process.cwd()): string {
  const abs = path.resolve(base, expandHome(p));
  let real: string;
  try {
    real = fs.realpathSync(abs);
  } catch {
    throw new Error(`Folder not found: ${abs}`);
  }
  if (!fs.statSync(real).isDirectory()) throw new Error(`Not a folder: ${real}`);
  return real;
}

function sanitizeAlias(a: string): string {
  const s = a.replace(/[\\/:*?"<>|\0]/g, '-').trim();
  if (!s || s === '.' || s === '..') throw new Error(`Invalid alias "${a}"`);
  if (RESERVED.has(s) || s.endsWith('.code-workspace')) throw new Error(`Alias "${s}" is reserved`);
  return s;
}

/** Is `p` a branch checkout created (and therefore owned) by VWS? */
export function isManagedWorktree(ctx: Context, p: string): boolean {
  let real = ctx.worktreesDir;
  try {
    real = fs.realpathSync(ctx.worktreesDir);
  } catch {
    /* not created yet */
  }
  return p.startsWith(real + path.sep) || p.startsWith(ctx.worktreesDir + path.sep);
}

function defaultAlias(real: string, branch?: string): string {
  const base = sanitizeAlias(path.basename(real) || 'root');
  return branch ? `${base}@${branchSlug(branch)}` : base;
}

/**
 * Turn user specs into members: resolve paths, check out branches as worktrees, pick unique
 * aliases (api, other-api, api-2 / api@feature-x). All-or-nothing: worktrees created for a failed
 * batch are removed again.
 */
export function buildMembers(
  ctx: Context,
  existing: Member[],
  specs: MemberSpec[],
  base?: string,
): Member[] {
  const taken = new Set(existing.map((m) => m.alias.toLowerCase()));
  const paths = new Set(existing.map((m) => m.path));
  const out: Member[] = [];
  const createdHere: { repo: string; path: string }[] = [];
  try {
    for (const spec of specs) {
      let real = resolveMemberPath(spec.path, base);
      let worktree: Member['worktree'];
      if (spec.branch) {
        const repo = mainRepo(real);
        validateBranch(repo, spec.branch);
        worktree = { repo, branch: spec.branch };
        real = repo;
      }
      // Alias first, so we fail before creating anything on disk.
      let alias: string;
      if (spec.alias) {
        alias = sanitizeAlias(spec.alias);
        if (taken.has(alias.toLowerCase())) throw new Error(`Alias "${alias}" is already used`);
      } else {
        const baseName = defaultAlias(real, spec.branch);
        const parent = path.basename(path.dirname(real));
        const candidates = [baseName, parent && !spec.branch ? `${parent}-${baseName}` : ''].filter(
          Boolean,
        );
        alias = candidates.find((c) => !taken.has(c.toLowerCase())) ?? '';
        for (let i = 2; !alias; i++)
          if (!taken.has(`${baseName}-${i}`.toLowerCase())) alias = `${baseName}-${i}`;
      }
      if (worktree) {
        const before = fs.existsSync(
          path.join(ctx.worktreesDir, path.basename(worktree.repo), branchSlug(worktree.branch)),
        );
        real = ensureWorktree(worktree.repo, worktree.branch, ctx.worktreesDir).path;
        if (!before && isManagedWorktree(ctx, real))
          createdHere.push({ repo: worktree.repo, path: real });
        log(ctx, `worktree ${worktree.repo}@${worktree.branch} -> ${real}`);
      }
      if (paths.has(real)) throw new Error(`Already in workspace: ${real}`);
      for (const m of [...existing, ...out]) {
        if (real.startsWith(m.path + path.sep) || m.path.startsWith(real + path.sep)) {
          throw new Error(
            `${real} overlaps with member "${m.alias}" (${m.path}). Nested members are not allowed.`,
          );
        }
      }
      taken.add(alias.toLowerCase());
      paths.add(real);
      out.push(worktree ? { alias, path: real, worktree } : { alias, path: real });
    }
  } catch (err) {
    for (const w of createdHere) removeWorktree(w.repo, w.path);
    throw err;
  }
  return out;
}

/**
 * Remove VWS-created worktrees no workspace uses any more — only when they have no uncommitted
 * work. Branches (and all commits) stay in the repo.
 */
function releaseWorktrees(ctx: Context, state: State, members: Member[]): string[] {
  const inUse = new Set(
    Object.values(state.workspaces).flatMap((w) => w.members.map((m) => m.path)),
  );
  const kept: string[] = [];
  for (const m of members) {
    if (!m.worktree || !isManagedWorktree(ctx, m.path) || inUse.has(m.path)) continue;
    const outcome = removeWorktree(m.worktree.repo, m.path);
    log(ctx, `release worktree ${m.path}: ${outcome}`);
    if (outcome !== 'removed') kept.push(m.path);
  }
  return kept;
}

function readMarker(root: string): Marker | null {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(root, MARKER), 'utf8')) as Marker;
    return m && m.vws === 2 ? m : null;
  } catch {
    return null;
  }
}

function writeMarker(root: string, marker: Marker): void {
  fs.writeFileSync(path.join(root, MARKER), JSON.stringify(marker, null, 2) + '\n');
}

export function memberStatus(ws: Workspace): MemberStatus[] {
  return ws.members.map((m) => {
    const link = path.join(ws.root, m.alias);
    let health: MemberStatus['health'] = 'ok';
    if (!fs.existsSync(m.path)) health = 'missing-target';
    else if (ws.active) {
      if (!exists(link)) health = 'missing-link';
      else if (!isLink(link)) health = 'blocked';
      else if (linkTarget(link) !== m.path) health = 'wrong-link';
    }
    return { ...m, health, branch: gitBranch(m.path) };
  });
}

// ─── materialize / teardown ────────────────────────────────────────────────

/**
 * Make the workspace folder on disk match the definition: create/repair links, drop stale links,
 * (re)generate agent + editor files. Idempotent and cheap; safe to call any time.
 */
export function materialize(ctx: Context, ws: Workspace): MemberStatus[] {
  const root = ws.root;
  if (exists(root)) {
    if (isLink(root) || !fs.statSync(root).isDirectory())
      throw new Error(`${root} exists and is not a folder`);
    const marker = readMarker(root);
    if (!marker && fs.readdirSync(root).length > 0) {
      throw new Error(`${root} already exists and was not created by VWS. Pick another name.`);
    }
    if (marker && marker.name !== ws.name) {
      throw new Error(`${root} belongs to workspace "${marker.name}".`);
    }
  }
  fs.mkdirSync(root, { recursive: true });
  const marker: Marker = readMarker(root) ?? { vws: 2, name: ws.name, managed: {} };
  writeMarker(root, marker); // claim the folder before linking anything

  const wanted = new Map(ws.members.map((m) => [m.alias, m]));
  // Remove links that are no longer members (links only; never real files).
  for (const entry of fs.readdirSync(root)) {
    const p = path.join(root, entry);
    if (!wanted.has(entry) && isLink(p)) removeLink(p, ctx.platform);
  }
  for (const m of ws.members) {
    const link = path.join(root, m.alias);
    if (isLink(link)) {
      if (linkTarget(link) === m.path) continue;
      removeLink(link, ctx.platform);
    } else if (exists(link)) {
      log(ctx, `materialize ${ws.name}: ${link} is a real file/folder, not replacing`);
      continue;
    }
    if (!fs.existsSync(m.path) && m.worktree) {
      try {
        m.path = ensureWorktree(m.worktree.repo, m.worktree.branch, ctx.worktreesDir).path; // self-heal
      } catch (err) {
        log(
          ctx,
          `materialize ${ws.name}: could not restore worktree ${m.path}: ${(err as Error).message}`,
        );
      }
    }
    if (!fs.existsSync(m.path)) continue; // target gone; reported as missing-target
    createLink(m.path, link, ctx.platform);
  }

  const status = memberStatus(ws);
  const files = managedFiles(ws, status);
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(root, rel);
    const known = marker.managed[rel];
    if (exists(file)) {
      let current: string;
      try {
        current = fs.readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      // Not ours, or the user edited it: leave it alone.
      if (!known || sha(current) !== known) continue;
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    marker.managed[rel] = sha(content);
  }
  // Stop tracking files for renamed workspaces (e.g. old .code-workspace).
  for (const rel of Object.keys(marker.managed)) {
    if (!(rel in files)) {
      removeManaged(root, rel, marker.managed[rel]);
      delete marker.managed[rel];
    }
  }
  writeMarker(root, marker);
  return status;
}

function removeManaged(root: string, rel: string, hash: string): void {
  const file = path.join(root, rel);
  try {
    if (sha(fs.readFileSync(file, 'utf8')) === hash) fs.unlinkSync(file);
  } catch {
    /* gone already */
  }
}

/**
 * Remove the workspace folder. Only links and unmodified generated files are deleted; anything
 * else a user or agent created at the root is moved to the VWS trash, never destroyed.
 */
export function teardown(ctx: Context, ws: Workspace): TeardownResult {
  const root = ws.root;
  if (!exists(root)) return { trashedTo: null };
  if (isLink(root)) throw new Error(`Refusing to tear down ${root}: it is a link`);
  const marker = readMarker(root);
  if (marker && marker.name !== ws.name)
    throw new Error(`${root} belongs to workspace "${marker.name}"`);
  if (!marker && fs.readdirSync(root).some((e) => !isLink(path.join(root, e)))) {
    throw new Error(`${root} has no VWS marker; refusing to touch it`);
  }

  for (const entry of fs.readdirSync(root)) {
    const p = path.join(root, entry);
    if (isLink(p)) removeLink(p, ctx.platform);
  }
  if (marker) {
    for (const [rel, hash] of Object.entries(marker.managed)) removeManaged(root, rel, hash);
  }
  try {
    fs.unlinkSync(path.join(root, MARKER));
  } catch {
    /* ignore */
  }
  for (const dir of ['.claude', '.vscode']) {
    try {
      fs.rmdirSync(path.join(root, dir)); // only succeeds if empty
    } catch {
      /* not empty or missing */
    }
  }
  if (fs.readdirSync(root).length === 0) {
    fs.rmdirSync(root);
    return { trashedTo: null };
  }
  // Leftovers are user content. Keep them.
  fs.mkdirSync(ctx.trashDir, { recursive: true });
  const stamp = new Date(ctx.now()).toISOString().replace(/[:.]/g, '-');
  const dest = path.join(ctx.trashDir, `${ws.name}-${stamp}`);
  try {
    fs.renameSync(root, dest);
  } catch {
    // Cross-device: leave in place rather than risk a partial copy.
    log(ctx, `teardown ${ws.name}: could not move leftovers from ${root}`);
    return { trashedTo: root };
  }
  log(ctx, `teardown ${ws.name}: moved leftover files to ${dest}`);
  return { trashedTo: dest };
}

// ─── public API ────────────────────────────────────────────────────────────

export interface CreateOptions {
  name: string;
  members: MemberSpec[];
  /** Lifetime for a temporary workspace, e.g. "72h". Ignored when permanent. */
  ttl?: string;
  permanent?: boolean;
  /** Base directory for resolving relative member paths. */
  cwd?: string;
}

export function ttlMs(ctx: Context, ttl?: string): number {
  return parseDuration(ttl ?? ctx.config.ttl ?? DEFAULT_TTL);
}

export function keepExpiredMs(ctx: Context): number {
  return parseDuration(ctx.config.keepExpired ?? DEFAULT_KEEP_EXPIRED);
}

export function isArchived(ws: Workspace): boolean {
  return !!ws.archivedAt;
}

/** When an expired workspace stops being restorable. */
export function restorableUntil(ctx: Context, ws: Workspace): number | null {
  return ws.archivedAt ? Date.parse(ws.archivedAt) + keepExpiredMs(ctx) : null;
}

export function createWorkspace(ctx: Context, opts: CreateOptions): Workspace {
  validateName(opts.name);
  const lifetime = opts.permanent ? 0 : ttlMs(ctx, opts.ttl);
  return updateState(ctx, (state) => {
    const old = state.workspaces[opts.name];
    if (old && !isArchived(old)) throw new Error(`Workspace "${opts.name}" already exists.`);
    const now = ctx.now();
    const ws: Workspace = {
      name: opts.name,
      root: path.join(ctx.workspacesDir, opts.name),
      members: buildMembers(ctx, [], opts.members, opts.cwd),
      createdAt: new Date(now).toISOString(),
      expiresAt: opts.permanent ? null : new Date(now + lifetime).toISOString(),
      active: true,
    };
    materialize(ctx, ws);
    state.workspaces[ws.name] = ws; // replaces an expired one with the same name
    if (old) releaseWorktrees(ctx, state, old.members);
    log(ctx, `created ${ws.name} at ${ws.root} (${ws.members.length} members)`);
    return ws;
  });
}

/** All workspaces, including expired (archived) ones; filter with isArchived(). */
export function listWorkspaces(ctx: Context): Workspace[] {
  return Object.values(readState(ctx).workspaces).sort((a, b) => a.name.localeCompare(b.name));
}

export function getWorkspace(ctx: Context, name: string): Workspace {
  return must(readState(ctx), name);
}

/** Find the live workspace whose folder contains `p` (works with logical symlinked paths). */
export function findWorkspaceByPath(ctx: Context, p: string): Workspace | null {
  const abs = path.resolve(p);
  for (const ws of Object.values(readState(ctx).workspaces)) {
    if (isArchived(ws)) continue;
    if (abs === ws.root || abs.startsWith(ws.root + path.sep)) return ws;
  }
  return null;
}

function mutate(
  ctx: Context,
  name: string,
  fn: (ws: Workspace, state: State) => void,
  remat = true,
): Workspace {
  return updateState(ctx, (state) => {
    const ws = must(state, name);
    if (isArchived(ws)) {
      throw new Error(
        `"${name}" expired on ${new Date(ws.archivedAt!).toLocaleString()}. Restore it first: vws restore ${name}`,
      );
    }
    fn(ws, state);
    if (remat && ws.active) materialize(ctx, ws);
    return ws;
  });
}

export function addMembers(
  ctx: Context,
  name: string,
  specs: MemberSpec[],
  cwd?: string,
): Member[] {
  let added: Member[] = [];
  mutate(ctx, name, (ws) => {
    added = buildMembers(ctx, ws.members, specs, cwd);
    ws.members.push(...added);
  });
  return added;
}

/** Remove by alias or by (real) path. A VWS-created worktree is removed too if it is clean. */
export function removeMember(
  ctx: Context,
  name: string,
  aliasOrPath: string,
): Member & { keptWorktree: boolean } {
  let removed!: Member;
  let kept: string[] = [];
  mutate(
    ctx,
    name,
    (ws, state) => {
      let real: string | null = null;
      try {
        real = fs.realpathSync(path.resolve(expandHome(aliasOrPath)));
      } catch {
        /* not a path */
      }
      const idx = ws.members.findIndex((m) => m.alias === aliasOrPath || m.path === real);
      if (idx < 0) throw new Error(`"${aliasOrPath}" is not a member of ${name}`);
      removed = ws.members.splice(idx, 1)[0];
      if (ws.active) materialize(ctx, ws); // drop the link before removing its target
      kept = releaseWorktrees(ctx, state, [removed]);
    },
    false,
  );
  return { ...removed, keptWorktree: kept.length > 0 };
}

/** Make permanent (true) or temporary again with a fresh lifetime (false). */
export function setPermanent(
  ctx: Context,
  name: string,
  permanent: boolean,
  ttl?: string,
): Workspace {
  const lifetime = ttlMs(ctx, ttl);
  return mutate(ctx, name, (ws) => {
    ws.expiresAt = permanent ? null : new Date(ctx.now() + lifetime).toISOString();
    ws.warnedAt = null;
  });
}

/** Add time to a temporary workspace (from its current expiry, or from now if already past). */
export function extend(ctx: Context, name: string, by?: string): Workspace {
  const add = ttlMs(ctx, by);
  return mutate(ctx, name, (ws) => {
    if (!ws.expiresAt) throw new Error(`${name} is permanent; nothing to extend.`);
    const base = Math.max(ctx.now(), Date.parse(ws.expiresAt));
    ws.expiresAt = new Date(base + add).toISOString();
    ws.warnedAt = null;
  });
}

/** Bring back an expired workspace with a fresh lifetime (or permanently). */
export function restore(
  ctx: Context,
  name: string,
  opts: { permanent?: boolean; ttl?: string } = {},
): Workspace {
  const lifetime = ttlMs(ctx, opts.ttl);
  return updateState(ctx, (state) => {
    const ws = must(state, name);
    if (!isArchived(ws)) throw new Error(`"${name}" has not expired.`);
    ws.archivedAt = null;
    ws.active = true;
    ws.warnedAt = null;
    ws.expiresAt = opts.permanent ? null : new Date(ctx.now() + lifetime).toISOString();
    materialize(ctx, ws);
    log(ctx, `restored ${name}`);
    return ws;
  });
}

export function activate(ctx: Context, name: string): Workspace {
  return mutate(ctx, name, (ws) => {
    ws.active = true;
  });
}

export function deactivate(ctx: Context, name: string): TeardownResult {
  let result: TeardownResult = { trashedTo: null };
  mutate(
    ctx,
    name,
    (ws) => {
      result = teardown(ctx, ws);
      ws.active = false;
    },
    false,
  );
  return result;
}

/** Delete for good (also works on expired ones). Clean VWS-created worktrees are removed. */
export function deleteWorkspace(ctx: Context, name: string): ReleaseResult {
  return updateState(ctx, (state) => {
    const ws = must(state, name);
    const result = isArchived(ws) ? { trashedTo: null } : teardown(ctx, ws);
    delete state.workspaces[name];
    const keptWorktrees = releaseWorktrees(ctx, state, ws.members);
    log(ctx, `deleted ${name}`);
    return { ...result, keptWorktrees };
  });
}

/** Repair links and regenerate files. Returns member health after the repair. */
export function syncWorkspace(ctx: Context, name: string): MemberStatus[] {
  let status: MemberStatus[] = [];
  mutate(
    ctx,
    name,
    (ws) => {
      status = ws.active ? materialize(ctx, ws) : memberStatus(ws);
    },
    false,
  );
  return status;
}

export function remainingMs(ctx: Context, ws: Workspace): number | null {
  if (isArchived(ws)) return 0;
  return ws.expiresAt ? Date.parse(ws.expiresAt) - ctx.now() : null;
}

export interface SweepResult extends ReleaseResult {
  name: string;
  /** archived = expired, folder removed, still restorable; purged = gone for good. */
  action: 'archived' | 'purged';
}

/**
 * Expire temporary workspaces past their deadline (folder removed, definition archived and
 * restorable), and purge archives older than `keepExpired`. Lock-free when there is nothing to do.
 */
export function sweepExpired(ctx: Context): SweepResult[] {
  const now = ctx.now();
  const keep = keepExpiredMs(ctx);
  const due = (w: Workspace) =>
    isArchived(w)
      ? Date.parse(w.archivedAt!) + keep <= now
      : !!w.expiresAt && Date.parse(w.expiresAt) <= now;
  if (!Object.values(readState(ctx).workspaces).some(due)) return [];
  return updateState(ctx, (state) =>
    Object.values(state.workspaces)
      .filter(due)
      .map((ws): SweepResult => {
        if (isArchived(ws)) {
          delete state.workspaces[ws.name];
          const keptWorktrees = releaseWorktrees(ctx, state, ws.members);
          log(ctx, `purged expired ${ws.name}`);
          return { name: ws.name, action: 'purged', trashedTo: null, keptWorktrees };
        }
        let trashedTo: string | null = null;
        try {
          trashedTo = teardown(ctx, ws).trashedTo;
        } catch (err) {
          log(ctx, `sweep ${ws.name}: ${(err as Error).message}`);
        }
        ws.active = false;
        ws.archivedAt = new Date(now).toISOString();
        log(ctx, `expired ${ws.name} (restorable)`);
        return { name: ws.name, action: 'archived', trashedTo, keptWorktrees: [] };
      }),
  );
}

/** Temporary workspaces expiring within `withinMs`. */
export function expiringSoon(ctx: Context, withinMs: number): Workspace[] {
  return listWorkspaces(ctx).filter((w) => {
    const r = remainingMs(ctx, w);
    return !isArchived(w) && r !== null && r > 0 && r <= withinMs;
  });
}

export function markWarned(ctx: Context, names: string[]): void {
  if (!names.length) return;
  updateState(ctx, (state) => {
    for (const n of names)
      if (state.workspaces[n]) state.workspaces[n].warnedAt = new Date(ctx.now()).toISOString();
  });
}

export interface WorktreeReport {
  path: string;
  repo: string;
  branch: string;
  usedBy: string[];
  dirty: boolean;
}

/** Every worktree VWS created, who uses it, and whether it has unsaved work. */
export function listManagedWorktrees(ctx: Context): WorktreeReport[] {
  const byPath = new Map<string, WorktreeReport>();
  for (const ws of listWorkspaces(ctx)) {
    for (const m of ws.members) {
      if (!m.worktree || !isManagedWorktree(ctx, m.path)) continue;
      const r = byPath.get(m.path) ?? {
        path: m.path,
        repo: m.worktree.repo,
        branch: m.worktree.branch,
        usedBy: [],
        dirty: false,
      };
      r.usedBy.push(ws.name + (isArchived(ws) ? ' (expired)' : ''));
      byPath.set(m.path, r);
    }
  }
  // Orphans: still on disk but no workspace references them (e.g. kept because dirty).
  try {
    for (const repoDir of fs.readdirSync(ctx.worktreesDir)) {
      for (const b of fs.readdirSync(path.join(ctx.worktreesDir, repoDir))) {
        const p = path.join(ctx.worktreesDir, repoDir, b);
        if (byPath.has(p)) continue;
        let repo = '';
        try {
          repo = mainRepo(p);
        } catch {
          /* broken */
        }
        byPath.set(p, { path: p, repo, branch: gitBranch(p) ?? '?', usedBy: [], dirty: false });
      }
    }
  } catch {
    /* no worktrees yet */
  }
  return [...byPath.values()].map((r) => ({
    ...r,
    dirty: fs.existsSync(r.path) && isDirty(r.path),
  }));
}

/** Remove unused, clean VWS worktrees. Returns removed paths. */
export function pruneWorktrees(ctx: Context): string[] {
  return listManagedWorktrees(ctx)
    .filter((w) => !w.usedBy.length && !w.dirty && w.repo)
    .filter((w) => removeWorktree(w.repo, w.path) === 'removed')
    .map((w) => w.path);
}

// ─── share files (.vworkspace.json) ───────────────────────────────────────

export interface ShareFile {
  name: string;
  version: string;
  members: { path: string; alias?: string; branch?: string }[];
  permanent?: boolean;
  ttl?: string;
}

export function exportWorkspace(ctx: Context, name: string): ShareFile {
  const ws = getWorkspace(ctx, name);
  const home = os.homedir();
  const portable = (p: string) =>
    p.startsWith(home + path.sep) ? '~/' + path.relative(home, p).split(path.sep).join('/') : p;
  return {
    name: ws.name,
    version: '2',
    members: ws.members.map((m) =>
      m.worktree
        ? { path: portable(m.worktree.repo), branch: m.worktree.branch, alias: m.alias }
        : { path: portable(m.path), alias: m.alias },
    ),
    ...(ws.expiresAt ? {} : { permanent: true }),
  };
}

export function importWorkspace(
  ctx: Context,
  file: string,
  overrides: { name?: string; permanent?: boolean; ttl?: string } = {},
): Workspace {
  const abs = path.resolve(expandHome(file));
  const data = JSON.parse(fs.readFileSync(abs, 'utf8')) as ShareFile;
  if (!data || !Array.isArray(data.members))
    throw new Error(`${abs} is not a valid .vworkspace.json`);
  return createWorkspace(ctx, {
    name: overrides.name ?? data.name,
    members: data.members.map((m) => ({ path: m.path, alias: m.alias, branch: m.branch })),
    permanent: overrides.permanent ?? data.permanent ?? false,
    ttl: overrides.ttl ?? data.ttl,
    cwd: path.dirname(abs),
  });
}
