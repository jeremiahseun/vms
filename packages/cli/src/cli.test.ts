import { execFileSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { buildSync } from 'esbuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let tmp: string;
let bin: string;
let env: NodeJS.ProcessEnv;

function vws(args: string[], cwd = tmp) {
  const r = spawnSync(process.execPath, [bin, ...args], {
    cwd,
    env: { ...env, PWD: cwd },
    encoding: 'utf8',
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

beforeAll(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vws-cli-')));
  bin = path.join(tmp, 'vws.js');
  buildSync({
    entryPoints: [path.join(__dirname, 'main.ts')],
    bundle: true,
    platform: 'node',
    outfile: bin,
    logLevel: 'silent',
  });
  env = {
    ...process.env,
    VWS_HOME: path.join(tmp, 'state'),
    VWS_ROOT: path.join(tmp, 'ws'),
    NO_COLOR: '1',
  };
  for (const p of ['api', 'web']) fs.mkdirSync(path.join(tmp, 'code', p), { recursive: true });
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: path.join(tmp, 'code', 'api') });
});

afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('vws cli', () => {
  it('runs the full lifecycle', () => {
    const created = vws(['new', 'acme', 'code/api', 'code/web']);
    expect(created.code, created.err).toBe(0);
    expect(created.out).toContain('Created acme');
    const root = path.join(tmp, 'ws', 'acme');
    expect(vws(['path', 'acme']).out.trim()).toBe(root);

    const ls = vws(['ls']);
    expect(ls.out).toMatch(/acme\s+active\s+⏳ 3d left/);

    // name is inferred from the current directory, including inside a linked project
    const inside = path.join(root, 'api');
    expect(vws(['prompt'], inside).out).toBe('vws:acme ⏳3d');
    expect(vws(['info'], inside).out).toContain('(main)');

    expect(vws(['keep'], root).out).toContain('permanent');
    expect(vws(['prompt'], root).out).toBe('vws:acme');
    expect(vws(['temp', 'acme', '--ttl', '5h']).out).toContain('5h left');
    expect(vws(['rm', 'acme', 'web']).code).toBe(0);
    expect(fs.existsSync(path.join(root, 'web'))).toBe(false);
    expect(vws(['add', 'acme', 'code/web', '--as', 'frontend']).code).toBe(0);
    expect(fs.readlinkSync(path.join(root, 'frontend'))).toBe(path.join(tmp, 'code', 'web'));

    expect(JSON.parse(vws(['export', 'acme']).out).members).toHaveLength(2);
    expect(vws(['delete', 'acme']).code).toBe(0);
    expect(fs.existsSync(root)).toBe(false);
    expect(fs.existsSync(path.join(tmp, 'code', 'api', '.git'))).toBe(true);
  });

  it('fails cleanly', () => {
    const r = vws(['new', 'bad', 'does/not/exist']);
    expect(r.code).toBe(1);
    expect(r.err).toContain('Folder not found');
    expect(vws(['bogus']).code).toBe(2);
  });
});
