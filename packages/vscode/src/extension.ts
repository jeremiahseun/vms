import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  type Context,
  type Workspace,
  activate as activateWs,
  addMembers,
  createContext,
  createWorkspace,
  deactivate as deactivateWs,
  deleteWorkspace,
  extend,
  findWorkspaceByPath,
  formatDuration,
  getWorkspace,
  listWorkspaces,
  memberStatus,
  remainingMs,
  removeMember,
  setPermanent,
  sweepExpired,
  syncWorkspace,
  validateName,
} from '@vws/core';

let ctx: Context;
let status: vscode.StatusBarItem;
let tree: Tree;
const warned = new Set<string>();

// ─── helpers ───────────────────────────────────────────────────────────────

function lifeText(ws: Workspace): string {
  const r = remainingMs(ctx, ws);
  if (r === null) return 'permanent';
  return r <= 0 ? 'expired' : `${formatDuration(r)} left`;
}

function warnMs(): number {
  return vscode.workspace.getConfiguration('vws').get<number>('warnHours', 12) * 3_600_000;
}

/** The VWS workspace this window has open, if any. */
function current(): Workspace | null {
  for (const f of vscode.workspace.workspaceFolders ?? []) {
    const ws = findWorkspaceByPath(ctx, f.uri.fsPath);
    if (ws) return ws;
  }
  const file = vscode.workspace.workspaceFile;
  return file?.scheme === 'file' ? findWorkspaceByPath(ctx, file.fsPath) : null;
}

async function pickWorkspace(placeHolder = 'Select a workspace'): Promise<Workspace | undefined> {
  const all = listWorkspaces(ctx);
  if (!all.length) {
    const go = await vscode.window.showInformationMessage('No VWS workspaces yet.', 'Create one');
    if (go) await vscode.commands.executeCommand('vws.create');
    return undefined;
  }
  const picked = await vscode.window.showQuickPick(
    all.map((ws) => ({
      label: `${ws.expiresAt ? '$(clock)' : '$(pinned)'} ${ws.name}`,
      description: `${lifeText(ws)} · ${ws.members.length} project(s)${ws.active ? '' : ' · inactive'}`,
      detail: ws.members.map((m) => m.alias).join(', '),
      ws,
    })),
    { placeHolder },
  );
  return picked?.ws;
}

/** Commands receive a tree item, a name, or nothing (-> current window, else ask). */
async function target(arg: unknown): Promise<Workspace | undefined> {
  if (arg instanceof WsItem) return getWorkspace(ctx, arg.ws.name);
  if (typeof arg === 'string') return getWorkspace(ctx, arg);
  return current() ?? (await pickWorkspace());
}

async function run<T>(fn: () => T | Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (e) {
    void vscode.window.showErrorMessage(`VWS: ${(e as Error).message}`);
    return undefined;
  } finally {
    refresh();
  }
}

function openFolder(ws: Workspace): Thenable<unknown> {
  const newWindow = vscode.workspace.getConfiguration('vws').get<boolean>('openInNewWindow', true);
  return vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(ws.root), {
    forceNewWindow: newWindow && !!vscode.workspace.workspaceFolders?.length,
  });
}

// ─── status bar + expiry warnings ─────────────────────────────────────────

function refresh(): void {
  try {
    sweepExpired(ctx);
  } catch {
    /* lock busy; try next tick */
  }
  tree?.fire();
  const ws = current();
  if (!ws) {
    status.hide();
    return;
  }
  const r = remainingMs(ctx, ws);
  status.text = r === null ? `$(pinned) ${ws.name}` : `$(clock) ${ws.name} · ${lifeText(ws)}`;
  status.backgroundColor =
    r !== null && r <= warnMs()
      ? new vscode.ThemeColor('statusBarItem.warningBackground')
      : undefined;
  const md = new vscode.MarkdownString(
    `**VWS workspace \`${ws.name}\`** — ${r === null ? 'permanent' : `temporary, ${lifeText(ws)} (until ${new Date(ws.expiresAt!).toLocaleString()})`}\n\n` +
      memberStatus(ws)
        .map(
          (m) =>
            `- \`${m.alias}\` → ${m.path}${m.branch ? ` *(${m.branch})*` : ''}${m.health === 'ok' ? '' : ` ⚠ ${m.health}`}`,
        )
        .join('\n') +
      '\n\nClick for actions (keep, extend, add project, delete…)',
  );
  status.tooltip = md;
  status.show();

  if (r !== null && r > 0 && r <= warnMs() && !warned.has(ws.name)) {
    warned.add(ws.name);
    void vscode.window
      .showWarningMessage(
        `VWS: "${ws.name}" is temporary and will be removed in ${formatDuration(r)} (your projects stay untouched).`,
        'Keep permanently',
        'Extend 72h',
      )
      .then((choice) => {
        if (choice === 'Keep permanently') void run(() => setPermanent(ctx, ws.name, true));
        if (choice === 'Extend 72h') void run(() => extend(ctx, ws.name, '72h'));
      });
  }
}

// ─── tree view ─────────────────────────────────────────────────────────────

class WsItem extends vscode.TreeItem {
  constructor(public readonly ws: Workspace) {
    super(ws.name, vscode.TreeItemCollapsibleState.Collapsed);
    const r = remainingMs(ctx, ws);
    this.description = `${lifeText(ws)}${ws.active ? '' : ' · off'}`;
    this.tooltip = ws.root;
    this.iconPath = new vscode.ThemeIcon(
      !ws.active ? 'circle-slash' : r === null ? 'pinned' : 'clock',
      r !== null && r <= warnMs() ? new vscode.ThemeColor('list.warningForeground') : undefined,
    );
    this.contextValue = `ws-${ws.active ? 'on' : 'off'}-${r === null ? 'perm' : 'temp'}`;
  }
}

class MemberItem extends vscode.TreeItem {
  constructor(
    public readonly ws: Workspace,
    public readonly alias: string,
    p: string,
    branch: string | null,
    healthy: boolean,
  ) {
    super(alias, vscode.TreeItemCollapsibleState.None);
    this.description = `${branch ?? ''}  ${p}`;
    this.tooltip = p;
    this.iconPath = new vscode.ThemeIcon(healthy ? (branch ? 'repo' : 'folder') : 'warning');
    this.contextValue = 'member';
    this.resourceUri = vscode.Uri.file(p);
    this.command = { command: 'revealFileInOS', title: 'Reveal', arguments: [vscode.Uri.file(p)] };
  }
}

class Tree implements vscode.TreeDataProvider<vscode.TreeItem> {
  private emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;
  fire(): void {
    this.emitter.fire();
  }
  getTreeItem(e: vscode.TreeItem): vscode.TreeItem {
    return e;
  }
  getChildren(e?: vscode.TreeItem): vscode.TreeItem[] {
    if (!e) return listWorkspaces(ctx).map((ws) => new WsItem(ws));
    if (e instanceof WsItem) {
      return memberStatus(e.ws).map(
        (m) => new MemberItem(e.ws, m.alias, m.path, m.branch, m.health === 'ok'),
      );
    }
    return [];
  }
}

// ─── commands ──────────────────────────────────────────────────────────────

async function cmdCreate(): Promise<void> {
  const folders = await vscode.window.showOpenDialog({
    canSelectFolders: true,
    canSelectFiles: false,
    canSelectMany: true,
    openLabel: 'Join these folders',
    title: 'VWS: pick the project folders to join (hold Ctrl/Cmd for several)',
  });
  if (!folders?.length) return;
  const suggested = folders
    .map((f) => path.basename(f.fsPath))
    .join('-')
    .replace(/[^A-Za-z0-9._-]/g, '-')
    .slice(0, 40);
  const name = await vscode.window.showInputBox({
    title: 'VWS: workspace name',
    value: suggested,
    validateInput: (v) => {
      try {
        validateName(v);
        return listWorkspaces(ctx).some((w) => w.name === v)
          ? 'A workspace with this name exists'
          : null;
      } catch (e) {
        return (e as Error).message;
      }
    },
  });
  if (!name) return;
  const life = await vscode.window.showQuickPick(
    [
      {
        label: '$(clock) Temporary — 72 hours',
        description: 'auto-deleted; keep it any time',
        ttl: '72h',
      },
      { label: '$(clock) Temporary — 24 hours', ttl: '24h' },
      { label: '$(clock) Temporary — 7 days', ttl: '7d' },
      { label: '$(pinned) Permanent', description: 'until you delete it', ttl: null },
    ],
    { title: 'VWS: lifetime' },
  );
  if (!life) return;
  const ws = await run(() =>
    createWorkspace(ctx, {
      name,
      members: folders.map((f) => ({ path: f.fsPath })),
      ttl: life.ttl ?? undefined,
      permanent: life.ttl === null,
    }),
  );
  if (!ws) return;
  const choice = await vscode.window.showInformationMessage(
    `VWS: "${ws.name}" is ready at ${ws.root}`,
    'Open',
    'Copy path',
  );
  if (choice === 'Open') await openFolder(ws);
  if (choice === 'Copy path') await vscode.env.clipboard.writeText(ws.root);
}

async function cmdOpen(arg?: unknown): Promise<void> {
  const ws = arg ? await target(arg) : await pickWorkspace('Open which workspace?');
  if (!ws) return;
  const ready = await run(() =>
    ws.active ? (syncWorkspace(ctx, ws.name), ws) : activateWs(ctx, ws.name),
  );
  if (ready) await openFolder(ready);
}

async function cmdActions(): Promise<void> {
  const ws = await target(undefined);
  if (!ws) return;
  const temp = !!ws.expiresAt;
  const items: (vscode.QuickPickItem & { cmd: string })[] = [
    ...(temp
      ? [
          { label: '$(pinned) Make permanent', description: lifeText(ws), cmd: 'vws.keep' },
          { label: '$(history) Extend lifetime…', cmd: 'vws.extend' },
        ]
      : [{ label: '$(clock) Make temporary (72h)', cmd: 'vws.temp' }]),
    { label: '$(add) Add project folder…', cmd: 'vws.addFolder' },
    { label: '$(remove) Remove a project…', cmd: 'vws.removeMember' },
    { label: '$(sync) Repair & refresh (links, branches, agent files)', cmd: 'vws.sync' },
    { label: '$(copy) Copy workspace path', cmd: 'vws.copyPath' },
    { label: '$(folder-opened) Open another workspace…', cmd: 'vws.open' },
    {
      label: '$(trash) Delete workspace',
      description: 'projects are never touched',
      cmd: 'vws.delete',
    },
  ];
  const pick = await vscode.window.showQuickPick(items, {
    title: `VWS: ${ws.name} — ${lifeText(ws)}`,
  });
  if (pick)
    await vscode.commands.executeCommand(pick.cmd, pick.cmd === 'vws.open' ? undefined : ws.name);
}

async function cmdExtend(arg?: unknown): Promise<void> {
  const ws = await target(arg);
  if (!ws) return;
  const by = await vscode.window.showQuickPick(['24h', '72h', '7d', '30d'], {
    title: `Extend "${ws.name}" (${lifeText(ws)}) by…`,
  });
  if (!by) return;
  const res = await run(() => extend(ctx, ws.name, by));
  if (res) void vscode.window.showInformationMessage(`VWS: "${ws.name}" now has ${lifeText(res)}.`);
}

async function cmdAddFolder(arg?: unknown): Promise<void> {
  let folders: vscode.Uri[] | undefined;
  let ws: Workspace | undefined;
  if (arg instanceof vscode.Uri) {
    folders = [arg];
    ws = await pickWorkspace(`Add "${path.basename(arg.fsPath)}" to which workspace?`);
  } else {
    ws = await target(arg);
    if (!ws) return;
    folders = await vscode.window.showOpenDialog({
      canSelectFolders: true,
      canSelectMany: true,
      openLabel: `Add to ${ws.name}`,
    });
  }
  if (!ws || !folders?.length) return;
  const name = ws.name;
  const added = await run(() =>
    addMembers(
      ctx,
      name,
      folders!.map((f) => ({ path: f.fsPath })),
    ),
  );
  if (added)
    void vscode.window.showInformationMessage(
      `VWS: added ${added.map((m) => m.alias).join(', ')} to ${name}.`,
    );
}

async function cmdRemoveMember(arg?: unknown): Promise<void> {
  let name: string;
  let alias: string | undefined;
  if (arg instanceof MemberItem) {
    name = arg.ws.name;
    alias = arg.alias;
  } else {
    const ws = await target(arg);
    if (!ws) return;
    name = ws.name;
    alias = (
      await vscode.window.showQuickPick(
        ws.members.map((m) => ({ label: m.alias, description: m.path })),
      )
    )?.label;
  }
  if (!alias) return;
  const a = alias;
  await run(() => removeMember(ctx, name, a));
}

async function cmdDelete(arg?: unknown): Promise<void> {
  const ws = await target(arg);
  if (!ws) return;
  const ok = await vscode.window.showWarningMessage(
    `Delete VWS workspace "${ws.name}"? Only the links at ${ws.root} are removed — your projects are not touched.`,
    { modal: true },
    'Delete',
  );
  if (ok !== 'Delete') return;
  const res = await run(() => deleteWorkspace(ctx, ws.name));
  if (res?.trashedTo)
    void vscode.window.showInformationMessage(`VWS: root-level files kept in ${res.trashedTo}`);
}

export function activate(ext: vscode.ExtensionContext): void {
  ctx = createContext();
  tree = new Tree();
  status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  status.command = 'vws.actions';
  status.name = 'VWS workspace';

  const simple = (fn: (ws: Workspace) => unknown) => async (arg?: unknown) => {
    const ws = await target(arg);
    if (ws) await run(() => fn(ws));
  };

  ext.subscriptions.push(
    status,
    vscode.window.registerTreeDataProvider('vws.tree', tree),
    vscode.commands.registerCommand('vws.create', cmdCreate),
    vscode.commands.registerCommand('vws.open', cmdOpen),
    vscode.commands.registerCommand('vws.actions', cmdActions),
    vscode.commands.registerCommand('vws.extend', cmdExtend),
    vscode.commands.registerCommand('vws.addFolder', cmdAddFolder),
    vscode.commands.registerCommand('vws.removeMember', cmdRemoveMember),
    vscode.commands.registerCommand('vws.delete', cmdDelete),
    vscode.commands.registerCommand('vws.refresh', refresh),
    vscode.commands.registerCommand(
      'vws.keep',
      simple((ws) => setPermanent(ctx, ws.name, true)),
    ),
    vscode.commands.registerCommand(
      'vws.temp',
      simple((ws) => setPermanent(ctx, ws.name, false)),
    ),
    vscode.commands.registerCommand(
      'vws.sync',
      simple((ws) => syncWorkspace(ctx, ws.name)),
    ),
    vscode.commands.registerCommand(
      'vws.activate',
      simple((ws) => activateWs(ctx, ws.name)),
    ),
    vscode.commands.registerCommand(
      'vws.deactivate',
      simple((ws) => deactivateWs(ctx, ws.name)),
    ),
    vscode.commands.registerCommand(
      'vws.copyPath',
      simple((ws) => vscode.env.clipboard.writeText(ws.root)),
    ),
    vscode.workspace.onDidChangeWorkspaceFolders(refresh),
  );

  // React to CLI changes instantly; fall back to a 1-minute tick for the countdown.
  try {
    fs.mkdirSync(ctx.home, { recursive: true });
    const watcher = fs.watch(ctx.home, (_e, file) => {
      if (file === 'state.json') refresh();
    });
    ext.subscriptions.push({ dispose: () => watcher.close() });
  } catch {
    /* watching is an optimisation */
  }
  const timer = setInterval(refresh, 60_000);
  ext.subscriptions.push({ dispose: () => clearInterval(timer) });

  refresh();
}

export function deactivate(): void {
  /* nothing to clean up: workspaces outlive editor windows by design */
}
