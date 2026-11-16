import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  type Context,
  type MemberStatus,
  type Workspace,
  activate,
  addMembers,
  availableTools,
  createContext,
  createWorkspace,
  deactivate,
  deleteWorkspace,
  expiringSoon,
  exportWorkspace,
  extend,
  findWorkspaceByPath,
  formatDuration,
  getWorkspace,
  importWorkspace,
  launch,
  listWorkspaces,
  markWarned,
  memberStatus,
  parseDuration,
  remainingMs,
  removeMember,
  saveConfig,
  setPermanent,
  sweepExpired,
  syncWorkspace,
} from '@vws/core';
import { parseArgs } from './args';
import { c, confirm, err, ok, out, table, warn } from './ui';

const VERSION = '2.0.0';
const SOON_MS = 12 * 3_600_000;

const HELP = `${c.bold('vws')} — join project folders into one virtual monorepo for IDEs and coding agents

${c.bold('Create & use')}
  vws new <name> <folder...> [--ttl 72h] [--keep] [--with <tool>]   create (temporary by default)
  vws open [name] [--with <tool>] [-- tool args]                    open in an IDE / agent
  vws path [name]                                                   print the folder path
  vws add [name] <folder...> [--as <alias>]                         add projects
  vws rm  [name] <alias|folder>                                     remove a project (never deletes it)

${c.bold('Lifetime')}
  vws ls                                   list workspaces with time left
  vws info [name]                          members, branches, health, expiry
  vws keep [name]                          make permanent
  vws temp [name] [--ttl 72h]              make temporary again
  vws extend [name] [72h]                  add time
  vws off [name] / vws on [name]           deactivate (remove folder, keep definition) / reactivate
  vws delete [name] [-y]                   delete workspace (projects untouched)
  vws sync [name]                          repair links, refresh branches + agent files
  vws gc [--notify]                        delete expired workspaces now

${c.bold('Integrations')}
  vws prompt                               short status for your shell prompt
  vws schedule install|uninstall           hourly background cleanup + expiry notifications
  vws export [name] [file] / vws import <file> [--name n]   share via .vworkspace.json
  vws config [set <root|ttl> <value>]      show or change settings

Tools for --with: ${'{tools}'}
[name] defaults to the workspace you are in (cd into it), or the only one you have.
Docs: https://github.com/jeremiahseun/vms`;

// ─── helpers ───────────────────────────────────────────────────────────────

function tilde(p: string): string {
  const home = os.homedir();
  return p === home || p.startsWith(home + path.sep) ? '~' + p.slice(home.length) : p;
}

/** The logical cwd: keeps symlinked paths (process.cwd() resolves them away). */
function logicalCwd(): string {
  const pwd = process.env.PWD;
  try {
    if (pwd && fs.realpathSync(pwd) === fs.realpathSync(process.cwd())) return pwd;
  } catch {
    /* fall through */
  }
  return process.cwd();
}

function lifetime(ctx: Context, ws: Workspace): string {
  const r = remainingMs(ctx, ws);
  if (r === null) return c.green('● permanent');
  if (r <= 0) return c.red('expired');
  const text = `⏳ ${formatDuration(r)} left`;
  return r <= SOON_MS ? c.yellow(text) : text;
}

function resolveName(ctx: Context, given: string | undefined): string {
  if (given) return given;
  const here = findWorkspaceByPath(ctx, logicalCwd());
  if (here) return here.name;
  const all = listWorkspaces(ctx);
  if (all.length === 1) return all[0].name;
  throw new Error(
    all.length
      ? `Which workspace? Pass a name (${all.map((w) => w.name).join(', ')}) or cd into one.`
      : 'No workspaces yet. Create one: vws new <name> <folder...>',
  );
}

/** For add/rm: first positional is a name only if such a workspace exists. */
function splitNameAndArgs(ctx: Context, args: string[]): [string, string[]] {
  const names = new Set(listWorkspaces(ctx).map((w) => w.name));
  if (args.length > 1 && names.has(args[0])) return [args[0], args.slice(1)];
  if (args.length === 1 && names.has(args[0]) && !fs.existsSync(args[0])) return [args[0], []];
  return [resolveName(ctx, undefined), args];
}

function healthLabel(m: MemberStatus): string {
  switch (m.health) {
    case 'ok':
      return '';
    case 'missing-target':
      return c.red(' ✖ project folder missing');
    case 'missing-link':
      return c.yellow(' ⚠ link missing (vws sync)');
    case 'wrong-link':
      return c.yellow(' ⚠ link points elsewhere (vws sync)');
    case 'blocked':
      return c.red(' ✖ a real folder is in the way');
  }
}

function printMembers(members: MemberStatus[]): void {
  if (!members.length) return out(c.dim('    (no projects yet — vws add <folder>)'));
  out(
    table(
      members.map((m) => [
        `    ${c.bold(m.alias)}`,
        c.dim('→'),
        tilde(m.path),
        (m.branch ? c.cyan(`(${m.branch})`) : c.dim('(no git)')) + healthLabel(m),
      ]),
    ),
  );
}

function printWorkspace(ctx: Context, ws: Workspace): void {
  const state = ws.active ? c.green('active') : c.dim('inactive');
  out(`${c.bold(ws.name)}  ${state}  ${lifetime(ctx, ws)}`);
  out(`  ${tilde(ws.root)}${ws.active ? '' : c.dim('  (not on disk — vws on ' + ws.name + ')')}`);
  printMembers(memberStatus(ws));
  if (ws.expiresAt) {
    out(
      c.dim(`  Expires ${new Date(ws.expiresAt).toLocaleString()} · keep it: vws keep ${ws.name}`),
    );
  }
}

function notify(title: string, body: string): void {
  try {
    if (process.platform === 'darwin') {
      const esc = (s: string) => s.replace(/["\\]/g, '\\$&');
      spawnSync('osascript', [
        '-e',
        `display notification "${esc(body)}" with title "${esc(title)}"`,
      ]);
    } else if (process.platform === 'linux') {
      spawnSync('notify-send', ['-a', 'vws', title, body]);
    }
  } catch {
    /* notifications are best-effort */
  }
}

// ─── commands ──────────────────────────────────────────────────────────────

type Cmd = (
  ctx: Context,
  a: ReturnType<typeof parseArgs>,
) => Promise<number | void> | number | void;

const commands: Record<string, Cmd> = {
  new(ctx, a) {
    const [name, ...folders] = a._;
    if (!name) throw new Error('Usage: vws new <name> <folder...>');
    const aliases = typeof a.flags.as === 'string' ? a.flags.as.split(',') : [];
    const ws = createWorkspace(ctx, {
      name,
      members: folders.map((p, i) => ({ path: p, alias: aliases[i] || undefined })),
      ttl: a.flags.ttl as string | undefined,
      permanent: Boolean(a.flags.keep),
    });
    ok(`Created ${c.bold(ws.name)}`);
    printWorkspace(ctx, ws);
    out();
    out(
      `  Open it:  ${c.cyan(`vws open ${ws.name} --with code`)}   ${c.dim('(or cursor, claude, codex, …)')}`,
    );
    out(`  Or point any IDE/agent at: ${c.cyan(ws.root)}`);
    if (ws.expiresAt) out(`  Keep it:  ${c.cyan(`vws keep ${ws.name}`)}`);
    if (typeof a.flags.with === 'string') return launch(ctx, ws, a.flags.with, a.rest);
  },

  add(ctx, a) {
    const [name, folders] = splitNameAndArgs(ctx, a._);
    if (!folders.length) throw new Error('Usage: vws add [name] <folder...> [--as alias]');
    const aliases = typeof a.flags.as === 'string' ? a.flags.as.split(',') : [];
    const added = addMembers(
      ctx,
      name,
      folders.map((p, i) => ({ path: p, alias: aliases[i] || undefined })),
      logicalCwd(),
    );
    for (const m of added) ok(`Added ${c.bold(m.alias)} → ${tilde(m.path)} to ${name}`);
  },

  rm(ctx, a) {
    const [name, targets] = splitNameAndArgs(ctx, a._);
    if (!targets.length) throw new Error('Usage: vws rm [name] <alias|folder>');
    for (const t of targets) {
      const m = removeMember(ctx, name, t);
      ok(`Removed ${c.bold(m.alias)} from ${name} ${c.dim('(project folder untouched)')}`);
    }
  },

  ls(ctx, a) {
    const all = listWorkspaces(ctx);
    if (a.flags.json) return out(JSON.stringify(all, null, 2));
    if (!all.length) {
      out('No workspaces yet.');
      out(`Create one: ${c.cyan('vws new my-stack ~/code/api ~/code/web')}`);
      return;
    }
    const rows = [
      [c.dim('NAME'), c.dim('STATUS'), c.dim('LIFETIME'), c.dim('PROJECTS'), c.dim('PATH')],
    ];
    for (const ws of all) {
      rows.push([
        c.bold(ws.name),
        ws.active ? c.green('active') : c.dim('off'),
        lifetime(ctx, ws),
        String(ws.members.length),
        tilde(ws.root),
      ]);
    }
    out(table(rows));
  },

  info(ctx, a) {
    const ws = getWorkspace(ctx, resolveName(ctx, a._[0]));
    if (a.flags.json)
      return out(
        JSON.stringify(
          { ...ws, members: memberStatus(ws), remainingMs: remainingMs(ctx, ws) },
          null,
          2,
        ),
      );
    printWorkspace(ctx, ws);
  },

  path(ctx, a) {
    out(getWorkspace(ctx, resolveName(ctx, a._[0])).root);
  },

  open(ctx, a) {
    let ws = getWorkspace(ctx, resolveName(ctx, a._[0]));
    if (!ws.active) {
      ws = activate(ctx, ws.name);
      ok(`Reactivated ${ws.name}`);
    } else {
      syncWorkspace(ctx, ws.name); // cheap: refreshes branches and repairs links
    }
    const tool = (a.flags.with as string | undefined) ?? a._[1];
    if (!tool) {
      out(ws.root);
      err(
        c.dim(`Tip: vws open ${ws.name} --with code|cursor|claude|codex   (${lifetime(ctx, ws)})`),
      );
      return;
    }
    if (ws.expiresAt)
      err(c.dim(`${ws.name}: ${lifetime(ctx, ws)} · vws keep ${ws.name} to keep it`));
    return launch(ctx, ws, tool, a.rest);
  },

  keep(ctx, a) {
    const ws = setPermanent(ctx, resolveName(ctx, a._[0]), true);
    ok(`${c.bold(ws.name)} is now permanent at ${tilde(ws.root)}`);
  },

  temp(ctx, a) {
    const ws = setPermanent(
      ctx,
      resolveName(ctx, a._[0]),
      false,
      a.flags.ttl as string | undefined,
    );
    ok(`${c.bold(ws.name)} is temporary again: ${lifetime(ctx, ws)}`);
  },

  extend(ctx, a) {
    let [name, by] = a._;
    if (name && !by && /^\d/.test(name)) [name, by] = [undefined as unknown as string, name];
    const ws = extend(ctx, resolveName(ctx, name), by ?? (a.flags.by as string | undefined));
    ok(
      `${c.bold(ws.name)}: ${lifetime(ctx, ws)} (until ${new Date(ws.expiresAt!).toLocaleString()})`,
    );
  },

  off(ctx, a) {
    const name = resolveName(ctx, a._[0]);
    const res = deactivate(ctx, name);
    ok(
      `${c.bold(name)} deactivated. Folder removed; definition kept. Bring it back: vws on ${name}`,
    );
    if (res.trashedTo)
      warn(`Files you created at the workspace root were kept in ${tilde(res.trashedTo)}`);
  },

  on(ctx, a) {
    const ws = activate(ctx, resolveName(ctx, a._[0]));
    ok(`${c.bold(ws.name)} is active at ${tilde(ws.root)}`);
  },

  async delete(ctx, a) {
    const name = resolveName(ctx, a._[0]);
    if (!a.flags.yes && !a._[0]) {
      if (!(await confirm(`Delete workspace "${name}"? Your project folders are not touched.`))) {
        err('Cancelled. (Pass the name or -y to skip this question.)');
        return 1;
      }
    }
    const res = deleteWorkspace(ctx, name);
    ok(`Deleted ${c.bold(name)} ${c.dim('(projects untouched)')}`);
    if (res.trashedTo)
      warn(`Files you created at the workspace root were kept in ${tilde(res.trashedTo)}`);
  },

  sync(ctx, a) {
    const names =
      a._[0] || a.flags.all
        ? a.flags.all
          ? listWorkspaces(ctx).map((w) => w.name)
          : [a._[0]]
        : [resolveName(ctx, undefined)];
    for (const name of names) {
      const status = syncWorkspace(ctx, name);
      const bad = status.filter((m) => m.health !== 'ok');
      if (bad.length) {
        warn(`${name}: ${bad.length} problem(s)`);
        printMembers(bad);
      } else ok(`${name}: ${status.length} project(s) linked`);
    }
  },

  gc(ctx, a) {
    // sweep already ran in main(); report what is left
    const soon = expiringSoon(ctx, SOON_MS);
    if (a.flags.notify) {
      const fresh = soon.filter((w) => !w.warnedAt);
      for (const w of fresh) {
        notify(
          `VWS: "${w.name}" expires in ${formatDuration(remainingMs(ctx, w)!)}`,
          `Run "vws keep ${w.name}" to keep it, or "vws extend ${w.name}".`,
        );
      }
      markWarned(
        ctx,
        fresh.map((w) => w.name),
      );
    }
    if (!a.flags.quiet)
      ok(`Clean. ${listWorkspaces(ctx).length} workspace(s), ${soon.length} expiring within 12h.`);
  },

  prompt(ctx) {
    const ws = findWorkspaceByPath(ctx, logicalCwd());
    if (!ws) return;
    const r = remainingMs(ctx, ws);
    process.stdout.write(
      r === null ? `vws:${ws.name}` : `vws:${ws.name} ⏳${formatDuration(Math.max(r, 0))}`,
    );
  },

  schedule(ctx, a) {
    const action = a._[0] ?? 'status';
    const script = path.resolve(process.argv[1]);
    const tag = '# vws-gc';
    if (process.platform === 'win32') {
      const tr = `"${process.execPath}" "${script}" gc --notify --quiet`;
      const args =
        action === 'install'
          ? ['/Create', '/F', '/SC', 'HOURLY', '/TN', 'vws-gc', '/TR', tr]
          : action === 'uninstall'
            ? ['/Delete', '/F', '/TN', 'vws-gc']
            : ['/Query', '/TN', 'vws-gc'];
      const res = spawnSync('schtasks', args, { stdio: 'inherit' });
      return res.status ?? 1;
    }
    const current = spawnSync('crontab', ['-l'], { encoding: 'utf8' });
    if (current.error) throw new Error('crontab is not available on this system.');
    const lines = (current.status === 0 ? current.stdout : '')
      .split('\n')
      .filter((l) => l && !l.includes(tag));
    const installed = (current.stdout ?? '').includes(tag);
    if (action === 'status') {
      out(
        installed
          ? 'Hourly cleanup is installed (crontab).'
          : 'Not installed. Run: vws schedule install',
      );
      return;
    }
    if (action === 'install') {
      const env = ctx.home !== path.join(os.homedir(), '.vws') ? `VWS_HOME="${ctx.home}" ` : '';
      const display = process.platform === 'linux' ? 'DISPLAY=:0 ' : '';
      lines.push(
        `17 * * * * ${display}${env}"${process.execPath}" "${script}" gc --notify --quiet ${tag}`,
      );
    } else if (action !== 'uninstall')
      throw new Error('Usage: vws schedule install|uninstall|status');
    const res = spawnSync('crontab', ['-'], { input: lines.join('\n') + '\n', encoding: 'utf8' });
    if (res.status !== 0) throw new Error(`crontab failed: ${res.stderr}`);
    ok(
      action === 'install'
        ? 'Hourly cleanup + expiry notifications installed.'
        : 'Hourly cleanup removed.',
    );
  },

  export(ctx, a) {
    const name = resolveName(ctx, a._[0]);
    const json = JSON.stringify(exportWorkspace(ctx, name), null, 2) + '\n';
    const file = a._[1];
    if (!file) return void process.stdout.write(json);
    fs.writeFileSync(file, json);
    ok(`Wrote ${file}`);
  },

  import(ctx, a) {
    if (!a._[0])
      throw new Error('Usage: vws import <file.vworkspace.json> [--name n] [--keep] [--ttl 72h]');
    const ws = importWorkspace(ctx, a._[0], {
      name: a.flags.name as string | undefined,
      permanent: a.flags.keep ? true : undefined,
      ttl: a.flags.ttl as string | undefined,
    });
    ok(`Imported ${c.bold(ws.name)}`);
    printWorkspace(ctx, ws);
  },

  config(ctx, a) {
    const [action, key, value] = a._;
    if (action === 'set') {
      if (key === 'ttl') parseDuration(value);
      else if (key !== 'root') throw new Error('Settable keys: root, ttl');
      if (!value) throw new Error(`Usage: vws config set ${key} <value>`);
      saveConfig(ctx, { ...ctx.config, [key]: value });
      ok(`${key} = ${value}${key === 'root' ? c.dim(' (applies to new workspaces)') : ''}`);
      return;
    }
    out(`state     ${tilde(ctx.home)}`);
    out(`root      ${tilde(ctx.workspacesDir)}`);
    out(`ttl       ${ctx.config.ttl ?? '72h'}`);
    out(`config    ${tilde(ctx.configFile)}`);
  },

  help(ctx) {
    out(HELP.replace('{tools}', Object.keys(availableTools(ctx)).join(', ')));
  },

  version() {
    out(VERSION);
  },
};

const ALIASES: Record<string, string> = {
  create: 'new',
  init: 'new',
  remove: 'rm',
  list: 'ls',
  status: 'info',
  pin: 'keep',
  permanent: 'keep',
  unpin: 'temp',
  renew: 'extend',
  deactivate: 'off',
  activate: 'on',
  del: 'delete',
  repair: 'sync',
  '--help': 'help',
  '-h': 'help',
  '--version': 'version',
  '-v': 'version',
};

const QUIET = new Set(['prompt', 'path', 'export', 'version', 'gc']);
/** Commands whose own output already shows the lifetime; no extra banner. */
const SHOWS_LIFETIME = new Set(['ls', 'info', 'keep', 'temp', 'extend', 'new', 'import', 'help']);

async function main(argv: string[]): Promise<number> {
  const ctx = createContext();
  let name = argv[0] ?? '';
  name = ALIASES[name] ?? name;
  if (!name) name = findWorkspaceByPath(ctx, logicalCwd()) ? 'info' : 'ls';
  const cmd = commands[name];
  if (!cmd) {
    err(`Unknown command "${argv[0]}". Run ${c.cyan('vws help')}.`);
    return 2;
  }
  const a = parseArgs(argv.slice(1), new Set(['ttl', 'with', 'as', 'name', 'by']), {
    y: 'yes',
    w: 'with',
  });

  // Lazy expiry: every invocation deletes anything past its deadline. No daemon needed.
  if (name !== 'prompt') {
    for (const s of sweepExpired(ctx)) {
      if (!QUIET.has(name) || name === 'gc') {
        warn(`Workspace "${s.name}" reached its time limit and was removed (projects untouched).`);
        if (s.trashedTo) warn(`  Root-level files kept in ${tilde(s.trashedTo)}`);
      }
    }
  }

  const code = (await cmd(ctx, a)) ?? 0;

  if (!QUIET.has(name) && !SHOWS_LIFETIME.has(name) && !a.flags.json) {
    for (const w of expiringSoon(ctx, SOON_MS)) {
      warn(
        `"${w.name}" will be removed in ${formatDuration(remainingMs(ctx, w)!)}. Keep it: vws keep ${w.name}`,
      );
    }
  }
  return code;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (e: Error) => {
    err(`${c.red('✖')} ${e.message}`);
    if (process.env.VWS_DEBUG) err(e.stack ?? '');
    process.exit(1);
  },
);
