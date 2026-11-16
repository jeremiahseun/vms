import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type Context,
  activate,
  addMembers,
  buildCommand,
  createContext,
  createWorkspace,
  deactivate,
  deleteWorkspace,
  exportWorkspace,
  extend,
  findWorkspaceByPath,
  formatDuration,
  getWorkspace,
  gitBranch,
  importWorkspace,
  listWorkspaces,
  memberStatus,
  parseDuration,
  remainingMs,
  removeMember,
  setPermanent,
  sweepExpired,
  syncWorkspace,
} from './index';

const H = 3_600_000;
let tmp: string;
let ctx: Context;
let clock: number;
let projects: { api: string; web: string; lib: string };

function project(rel: string): string {
  const p = path.join(tmp, 'code', rel);
  fs.mkdirSync(p, { recursive: true });
  fs.writeFileSync(path.join(p, 'index.ts'), `// ${rel}\n`);
  return fs.realpathSync(p);
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vws-test-'));
  clock = Date.parse('2026-01-01T00:00:00Z');
  ctx = createContext({
    home: path.join(tmp, 'state'),
    workspacesDir: path.join(tmp, 'ws'),
    now: () => clock,
  });
  projects = { api: project('api'), web: project('web'), lib: project('libs/lib') };
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const make = (extra: Partial<Parameters<typeof createWorkspace>[1]> = {}) =>
  createWorkspace(ctx, {
    name: 'acme',
    members: [{ path: projects.api }, { path: projects.web }],
    ...extra,
  });

describe('time', () => {
  it('parses durations', () => {
    expect(parseDuration('72h')).toBe(72 * H);
    expect(parseDuration('3d')).toBe(72 * H);
    expect(parseDuration('1d12h')).toBe(36 * H);
    expect(parseDuration('90m')).toBe(1.5 * H);
    expect(parseDuration('48')).toBe(48 * H);
    expect(() => parseDuration('soon')).toThrow();
    expect(() => parseDuration('3x')).toThrow();
  });
  it('formats durations', () => {
    expect(formatDuration(72 * H - 1000)).toBe('3d');
    expect(formatDuration(53 * H)).toBe('2d 5h');
    expect(formatDuration(5 * H + 30 * 60_000)).toBe('5h 30m');
    expect(formatDuration(30_000)).toBe('<1m');
  });
});

describe('create', () => {
  it('builds a folder of links plus agent/editor files, temporary for 72h', () => {
    const ws = make();
    expect(ws.root).toBe(path.join(tmp, 'ws', 'acme'));
    expect(fs.readlinkSync(path.join(ws.root, 'api'))).toBe(projects.api);
    expect(fs.readFileSync(path.join(ws.root, 'web', 'index.ts'), 'utf8')).toContain('web');
    expect(remainingMs(ctx, ws)).toBe(72 * H);
    for (const f of [
      'AGENTS.md',
      'CLAUDE.md',
      '.claude/settings.json',
      '.vscode/settings.json',
      'acme.code-workspace',
      '.vws.json',
    ]) {
      expect(fs.existsSync(path.join(ws.root, f)), f).toBe(true);
    }
    const claude = JSON.parse(fs.readFileSync(path.join(ws.root, '.claude/settings.json'), 'utf8'));
    expect(claude.permissions.additionalDirectories).toEqual([projects.api, projects.web]);
    expect(fs.readFileSync(path.join(ws.root, 'AGENTS.md'), 'utf8')).toContain('`api/`');
  });

  it('edits through the link land in the real project', () => {
    const ws = make();
    fs.writeFileSync(path.join(ws.root, 'api', 'new.ts'), 'hello');
    expect(fs.readFileSync(path.join(projects.api, 'new.ts'), 'utf8')).toBe('hello');
  });

  it('supports permanent and custom ttl', () => {
    expect(make({ name: 'p', permanent: true }).expiresAt).toBeNull();
    expect(remainingMs(ctx, make({ name: 't', ttl: '1d' }))).toBe(24 * H);
  });

  it('picks unique aliases for same-named folders', () => {
    const other = project('other/api');
    const ws = createWorkspace(ctx, {
      name: 'x',
      members: [{ path: projects.api }, { path: other }],
    });
    expect(ws.members.map((m) => m.alias)).toEqual(['api', 'other-api']);
  });

  it('rejects bad input', () => {
    expect(() => createWorkspace(ctx, { name: '../evil', members: [] })).toThrow(
      /Invalid workspace name/,
    );
    expect(() => createWorkspace(ctx, { name: 'a', members: [{ path: '/nope/nothing' }] })).toThrow(
      /not found/,
    );
    expect(() =>
      createWorkspace(ctx, {
        name: 'a',
        members: [{ path: projects.api }, { path: projects.api }],
      }),
    ).toThrow(/Already/);
    expect(() =>
      createWorkspace(ctx, {
        name: 'a',
        members: [{ path: path.dirname(projects.lib) }, { path: projects.lib }],
      }),
    ).toThrow(/overlaps/);
    expect(() =>
      createWorkspace(ctx, { name: 'a', members: [{ path: projects.api, alias: 'AGENTS.md' }] }),
    ).toThrow(/reserved/);
    make();
    expect(() => make()).toThrow(/already exists/);
  });

  it('refuses to take over a non-empty folder it did not create', () => {
    fs.mkdirSync(path.join(tmp, 'ws', 'acme'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'ws', 'acme', 'important.txt'), 'keep');
    expect(() => make()).toThrow(/not created by VWS/);
    expect(listWorkspaces(ctx)).toHaveLength(0);
  });
});

describe('members', () => {
  it('adds and removes without touching projects', () => {
    make();
    const [m] = addMembers(ctx, 'acme', [{ path: projects.lib, alias: 'shared' }]);
    expect(m.alias).toBe('shared');
    const root = getWorkspace(ctx, 'acme').root;
    expect(fs.readlinkSync(path.join(root, 'shared'))).toBe(projects.lib);
    removeMember(ctx, 'acme', 'shared');
    expect(fs.existsSync(path.join(root, 'shared'))).toBe(false);
    expect(fs.existsSync(path.join(projects.lib, 'index.ts'))).toBe(true);
    removeMember(ctx, 'acme', projects.web); // by path
    expect(getWorkspace(ctx, 'acme').members.map((x) => x.alias)).toEqual(['api']);
    expect(
      JSON.parse(fs.readFileSync(path.join(root, '.claude/settings.json'), 'utf8')).permissions
        .additionalDirectories,
    ).toEqual([projects.api]);
  });

  it('reports and repairs broken links', () => {
    const ws = make();
    fs.unlinkSync(path.join(ws.root, 'api'));
    expect(memberStatus(ws).find((m) => m.alias === 'api')!.health).toBe('missing-link');
    expect(syncWorkspace(ctx, 'acme').every((m) => m.health === 'ok')).toBe(true);
    fs.rmSync(projects.web, { recursive: true });
    expect(syncWorkspace(ctx, 'acme').find((m) => m.alias === 'web')!.health).toBe(
      'missing-target',
    );
  });

  it('detects git branches without spawning git', () => {
    execFileSync('git', ['init', '-q', '-b', 'feature/x'], { cwd: projects.api });
    expect(gitBranch(projects.api)).toBe('feature/x');
    expect(gitBranch(projects.web)).toBeNull();
  });
});

describe('lifetime', () => {
  it('keeps, makes temporary, extends', () => {
    make();
    expect(setPermanent(ctx, 'acme', true).expiresAt).toBeNull();
    expect(() => extend(ctx, 'acme', '1h')).toThrow(/permanent/);
    clock += 100 * H;
    expect(remainingMs(ctx, setPermanent(ctx, 'acme', false))).toBe(72 * H);
    expect(remainingMs(ctx, extend(ctx, 'acme', '24h'))).toBe(96 * H);
    expect(
      fs.readFileSync(path.join(getWorkspace(ctx, 'acme').root, 'AGENTS.md'), 'utf8'),
    ).toContain('temporary');
  });

  it('sweeps expired workspaces, preserving projects and root-level user files', () => {
    const ws = make();
    make({ name: 'perm', permanent: true });
    fs.writeFileSync(path.join(ws.root, 'notes.md'), 'agent notes');
    clock += 71 * H;
    expect(sweepExpired(ctx)).toEqual([]);
    clock += 1 * H;
    const swept = sweepExpired(ctx);
    expect(swept.map((s) => s.name)).toEqual(['acme']);
    expect(fs.existsSync(ws.root)).toBe(false);
    expect(fs.readFileSync(path.join(swept[0].trashedTo!, 'notes.md'), 'utf8')).toBe('agent notes');
    expect(fs.existsSync(path.join(swept[0].trashedTo!, 'api'))).toBe(false); // links never moved to trash
    expect(fs.readFileSync(path.join(projects.api, 'index.ts'), 'utf8')).toContain('api');
    expect(listWorkspaces(ctx).map((w) => w.name)).toEqual(['perm']);
  });

  it('deactivates and reactivates', () => {
    const ws = make();
    expect(deactivate(ctx, 'acme').trashedTo).toBeNull();
    expect(fs.existsSync(ws.root)).toBe(false);
    expect(getWorkspace(ctx, 'acme').active).toBe(false);
    activate(ctx, 'acme');
    expect(fs.readlinkSync(path.join(ws.root, 'web'))).toBe(projects.web);
  });

  it('delete removes only links and generated files', () => {
    const ws = make();
    deleteWorkspace(ctx, 'acme');
    expect(fs.existsSync(ws.root)).toBe(false);
    expect(fs.readdirSync(projects.api)).toEqual(['index.ts']);
    expect(listWorkspaces(ctx)).toHaveLength(0);
  });
});

describe('generated files', () => {
  it('stops updating a file the user edited', () => {
    const ws = make();
    const agents = path.join(ws.root, 'AGENTS.md');
    fs.writeFileSync(agents, 'my own rules');
    addMembers(ctx, 'acme', [{ path: projects.lib }]);
    expect(fs.readFileSync(agents, 'utf8')).toBe('my own rules');
    // and teardown keeps it (moved to trash, not deleted)
    const res = deleteWorkspace(ctx, 'acme');
    expect(fs.readFileSync(path.join(res.trashedTo!, 'AGENTS.md'), 'utf8')).toBe('my own rules');
  });
});

describe('misc', () => {
  it('finds a workspace from a path inside it (logical paths)', () => {
    const ws = make();
    expect(findWorkspaceByPath(ctx, path.join(ws.root, 'api', 'src'))?.name).toBe('acme');
    expect(findWorkspaceByPath(ctx, tmp)).toBeNull();
  });

  it('round-trips .vworkspace.json', () => {
    make();
    const file = path.join(tmp, 'share.vworkspace.json');
    fs.writeFileSync(file, JSON.stringify(exportWorkspace(ctx, 'acme')));
    const ws = importWorkspace(ctx, file, { name: 'copy' });
    expect(ws.members.map((m) => m.path)).toEqual([projects.api, projects.web]);
  });

  it('builds launch commands with per-project access for agents', () => {
    const ws = make();
    expect(buildCommand(ctx, ws, 'claude').args).toEqual([
      '--add-dir',
      projects.api,
      '--add-dir',
      projects.web,
    ]);
    expect(buildCommand(ctx, ws, 'code').args).toEqual([ws.root]);
    expect(buildCommand(ctx, ws, 'gemini', ['-y']).args).toEqual([
      '--include-directories',
      `${projects.api},${projects.web}`,
      '-y',
    ]);
    expect(() => buildCommand(ctx, ws, 'nope')).toThrow(/Unknown tool/);
  });
});
