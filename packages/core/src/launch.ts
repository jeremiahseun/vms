import { spawn, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Context } from './context';
import type { ToolDef, Workspace } from './types';

/**
 * Built-in launchers. Terminal agents get every real project path as an extra allowed
 * directory so their sandboxes / permission systems accept edits through the links.
 */
export const BUILTIN_TOOLS: Record<string, ToolDef> = {
  code: { command: 'code', args: ['{root}'], gui: true },
  'code-multi': { command: 'code', args: ['{workspaceFile}'], gui: true },
  cursor: { command: 'cursor', args: ['{root}'], gui: true },
  windsurf: { command: 'windsurf', args: ['{root}'], gui: true },
  zed: { command: 'zed', args: ['{root}'], gui: true },
  idea: { command: 'idea', args: ['{root}'], gui: true },
  webstorm: { command: 'webstorm', args: ['{root}'], gui: true },
  subl: { command: 'subl', args: ['{root}'], gui: true },
  claude: { command: 'claude', perMember: ['--add-dir', '{path}'] },
  codex: { command: 'codex', perMember: ['--add-dir', '{path}'] },
  gemini: { command: 'gemini', args: ['--include-directories', '{memberPaths}'] },
  aider: { command: 'aider' },
  opencode: { command: 'opencode', args: ['{root}'] },
};

export function availableTools(ctx: Context): Record<string, ToolDef> {
  return { ...BUILTIN_TOOLS, ...(ctx.config.tools ?? {}) };
}

export function buildCommand(
  ctx: Context,
  ws: Workspace,
  toolName: string,
  extra: string[] = [],
): { tool: ToolDef; command: string; args: string[] } {
  const tool = availableTools(ctx)[toolName];
  if (!tool) {
    throw new Error(
      `Unknown tool "${toolName}". Known: ${Object.keys(availableTools(ctx)).join(', ')}. ` +
        `Add your own under "tools" in ${ctx.configFile}.`,
    );
  }
  const vars: Record<string, string> = {
    root: ws.root,
    name: ws.name,
    workspaceFile: path.join(ws.root, `${ws.name}.code-workspace`),
    memberPaths: ws.members.map((m) => m.path).join(','),
  };
  const fill = (s: string, more: Record<string, string> = {}) =>
    s.replace(/\{(\w+)\}/g, (all, k: string) => more[k] ?? vars[k] ?? all);
  const args = [
    ...(tool.args ?? []).map((a) => fill(a)),
    ...ws.members.flatMap((m) =>
      (tool.perMember ?? []).map((a) => fill(a, { path: m.path, alias: m.alias })),
    ),
    ...extra,
  ];
  return { tool, command: fill(tool.command), args };
}

/** Locate an executable on PATH (honours PATHEXT on Windows). */
export function which(cmd: string, platform = process.platform): string | null {
  if (cmd.includes('/') || cmd.includes('\\')) return fs.existsSync(cmd) ? cmd : null;
  const exts = platform === 'win32' ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';') : [''];
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const full = path.join(dir, cmd + ext);
      try {
        if (fs.statSync(full).isFile()) return full;
      } catch {
        /* keep looking */
      }
    }
  }
  return null;
}

/** Launch a tool in the workspace. GUI apps detach; terminal agents inherit the terminal. */
export function launch(
  ctx: Context,
  ws: Workspace,
  toolName: string,
  extra: string[] = [],
): number {
  const { tool, command, args } = buildCommand(ctx, ws, toolName, extra);
  if (!which(command, ctx.platform))
    throw new Error(`"${command}" is not installed or not on PATH.`);
  const opts = {
    cwd: ws.root,
    env: { ...process.env, PWD: ws.root, VWS_WORKSPACE: ws.name, VWS_ROOT_PATH: ws.root },
    shell: ctx.platform === 'win32', // resolve .cmd shims (code.cmd, claude.cmd)
  };
  if (tool.gui) {
    const child = spawn(command, args, { ...opts, detached: true, stdio: 'ignore' });
    child.on('error', () => undefined);
    child.unref();
    return 0;
  }
  const res = spawnSync(command, args, { ...opts, stdio: 'inherit' });
  if (res.error) {
    const code = (res.error as NodeJS.ErrnoException).code;
    throw new Error(
      code === 'ENOENT' ? `"${command}" is not installed or not on PATH.` : res.error.message,
    );
  }
  return res.status ?? 0;
}
