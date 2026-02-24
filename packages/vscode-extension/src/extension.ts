/**
 * VWS — VSCode Extension entry point.
 *
 * Manages the lifecycle of virtual workspaces within VSCode/Cursor/Windsurf.
 * Activates on command invocation or when .vworkspace.json is detected.
 */

import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs';
import {
    ConfigStore,
    SymlinkEngine,
    SessionManager,
    WorkspaceRegistry,
} from 'vws-engine';
import type { VirtualRoot, WorkspaceConfig, VWorkspaceFile } from 'vws-engine';
import { WorkspaceTreeProvider } from './views/WorkspaceTreeView.js';
import { VWSStatusBar } from './views/StatusBarItem.js';

let store: ConfigStore;
let engine: SymlinkEngine;
let sessionManager: SessionManager;
let registry: WorkspaceRegistry;
let treeProvider: WorkspaceTreeProvider;
let statusBar: VWSStatusBar;
let activeRoot: VirtualRoot | null = null;

export function activate(context: vscode.ExtensionContext): void {
    // Initialize engine components.
    store = new ConfigStore();
    engine = new SymlinkEngine();
    sessionManager = new SessionManager(store, engine);
    registry = new WorkspaceRegistry(store, engine);

    store.ensureDirectories();

    // Initialize views.
    treeProvider = new WorkspaceTreeProvider();
    statusBar = new VWSStatusBar();

    const treeView = vscode.window.createTreeView('vwsWorkspaceTree', {
        treeDataProvider: treeProvider,
    });

    context.subscriptions.push(treeView);
    context.subscriptions.push(statusBar);

    // ─── Register Commands ────────────────────────────────────

    context.subscriptions.push(
        vscode.commands.registerCommand('vws.openWorkspace', handleOpenWorkspace),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('vws.closeSession', handleCloseSession),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('vws.addFolder', handleAddFolder),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('vws.removeFolder', handleRemoveFolder),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('vws.deleteWorkspace', handleDeleteWorkspace),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('vws.refreshTree', () => {
            treeProvider.refresh();
        }),
    );

    // ─── Auto-open detection ──────────────────────────────────

    detectVWorkspaceFile();

    store.log('VWS extension activated.');
}

export async function deactivate(): Promise<void> {
    // Clean up the active session when the editor closes.
    if (activeRoot) {
        try {
            await sessionManager.close(activeRoot.id);
            store.log(`Extension deactivate: closed session "${activeRoot.id}".`);
        } catch (err) {
            store.log(`Extension deactivate: error closing session — ${err}`);
        }
        activeRoot = null;
    }
}

// ─── Command Handlers ─────────────────────────────────────────

async function handleOpenWorkspace(): Promise<void> {
    const workspaces = registry.loadAll();

    if (workspaces.length === 0) {
        const action = await vscode.window.showInformationMessage(
            'No VWS workspaces configured. Would you like to create one?',
            'Create Workspace',
        );

        if (action === 'Create Workspace') {
            await createWorkspaceInteractive();
        }
        return;
    }

    const items = workspaces.map((ws) => ({
        label: ws.name,
        description: `${ws.members.length} member(s)`,
        workspace: ws,
    }));

    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select a workspace to open',
    });

    if (!selected) return;

    await openWorkspace(selected.workspace);
}

async function handleCloseSession(): Promise<void> {
    if (!activeRoot) {
        vscode.window.showInformationMessage('No active VWS session to close.');
        return;
    }

    try {
        await sessionManager.close(activeRoot.id);
        vscode.window.showInformationMessage(`VWS session "${activeRoot.id}" closed.`);
        activeRoot = null;
        refreshViews();
    } catch (err) {
        vscode.window.showErrorMessage(`Failed to close session: ${(err as Error).message}`);
    }
}

async function handleAddFolder(): Promise<void> {
    const workspaces = registry.loadAll();
    if (workspaces.length === 0) {
        vscode.window.showWarningMessage('No workspaces exist. Create one first with VWS: Open Workspace.');
        return;
    }

    const uris = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectFiles: false,
        canSelectMany: true,
        openLabel: 'Add to Workspace',
    });

    if (!uris || uris.length === 0) return;

    // If multiple workspaces, ask which one.
    let targetWorkspace: WorkspaceConfig;
    if (workspaces.length === 1) {
        targetWorkspace = workspaces[0];
    } else {
        const items = workspaces.map((ws) => ({ label: ws.name, workspace: ws }));
        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Add to which workspace?',
        });
        if (!selected) return;
        targetWorkspace = selected.workspace;
    }

    for (const uri of uris) {
        try {
            registry.addMember(targetWorkspace.name, { path: uri.fsPath });
        } catch (err) {
            vscode.window.showWarningMessage(`Could not add ${uri.fsPath}: ${(err as Error).message}`);
        }
    }

    vscode.window.showInformationMessage(
        `Added ${uris.length} folder(s) to workspace "${targetWorkspace.name}".`,
    );
    refreshViews();
}

async function handleRemoveFolder(): Promise<void> {
    if (!activeRoot || activeRoot.members.length === 0) {
        vscode.window.showInformationMessage('No active session or members to remove.');
        return;
    }

    const items = activeRoot.members.map((m) => ({
        label: m.alias ?? path.basename(m.path),
        description: m.path,
        member: m,
    }));

    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select a member to remove',
    });

    if (!selected) return;

    const alias = selected.member.alias ?? path.basename(selected.member.path);

    try {
        await engine.removeMember(activeRoot, alias);
        vscode.window.showInformationMessage(`Removed "${alias}" from the virtual root.`);
        refreshViews();
    } catch (err) {
        vscode.window.showErrorMessage(`Failed to remove member: ${(err as Error).message}`);
    }
}

async function handleDeleteWorkspace(): Promise<void> {
    const workspaces = registry.loadAll();
    if (workspaces.length === 0) {
        vscode.window.showInformationMessage('No workspaces to delete.');
        return;
    }

    const items = workspaces.map((ws) => ({
        label: ws.name,
        description: `${ws.members.length} member(s)`,
        workspace: ws,
    }));

    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select a workspace to delete PERMANENTLY',
    });

    if (!selected) return;

    if (activeRoot && activeRoot.id === selected.workspace.name) {
        // We are deleting the active workspace, close it first
        await handleCloseSession();
    }

    try {
        registry.delete(selected.workspace.name);
        vscode.window.showInformationMessage(`Deleted workspace: ${selected.workspace.name}`);
        refreshViews();
    } catch (err) {
        vscode.window.showErrorMessage(`Failed to delete workspace: ${(err as Error).message}`);
    }
}

// ─── Helpers ──────────────────────────────────────────────────

async function openWorkspace(workspace: WorkspaceConfig): Promise<void> {
    if (workspace.members.length === 0) {
        vscode.window.showWarningMessage(
            `Workspace "${workspace.name}" has no members. Add folders first.`,
        );
        return;
    }

    try {
        // Close existing session if one is active.
        if (activeRoot) {
            await sessionManager.close(activeRoot.id);
        }

        activeRoot = await sessionManager.open(workspace.name, workspace.members);

        refreshViews();

        vscode.window.showInformationMessage(
            `VWS workspace "${workspace.name}" opened at ${activeRoot.path}`,
        );

        // Offer to open the virtual root in a new window.
        const action = await vscode.window.showInformationMessage(
            `Open the virtual workspace root in a new window?`,
            'Open',
            'Copy Path',
        );

        if (action === 'Open') {
            const uri = vscode.Uri.file(activeRoot.path);
            await vscode.commands.executeCommand('vscode.openFolder', uri, true);
        } else if (action === 'Copy Path') {
            await vscode.env.clipboard.writeText(activeRoot.path);
            vscode.window.showInformationMessage('Virtual root path copied to clipboard.');
        }
    } catch (err) {
        vscode.window.showErrorMessage(`Failed to open workspace: ${(err as Error).message}`);
    }
}

async function createWorkspaceInteractive(): Promise<void> {
    const name = await vscode.window.showInputBox({
        prompt: 'Enter a name for the new workspace',
        placeHolder: 'my-fullstack-project',
        validateInput: (value) => {
            if (!value || value.trim().length === 0) return 'Name is required.';
            if (registry.get(value)) return 'A workspace with this name already exists.';
            return null;
        },
    });

    if (!name) return;

    try {
        registry.create(name.trim());
        vscode.window.showInformationMessage(`Workspace "${name}" created. Add folders with VWS: Add Folder.`);
        refreshViews();
    } catch (err) {
        vscode.window.showErrorMessage(`Failed to create workspace: ${(err as Error).message}`);
    }
}

function detectVWorkspaceFile(): void {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) return;

    for (const folder of workspaceFolders) {
        const configFile = path.join(folder.uri.fsPath, '.vworkspace.json');
        if (fs.existsSync(configFile)) {
            vscode.window
                .showInformationMessage(
                    `Found .vworkspace.json in "${folder.name}". Import this workspace?`,
                    'Import',
                    'Ignore',
                )
                .then((action) => {
                    if (action === 'Import') {
                        try {
                            const workspace = registry.importFromFile(configFile);
                            vscode.window.showInformationMessage(
                                `Imported workspace "${workspace.name}". Use VWS: Open Workspace to activate.`,
                            );
                            refreshViews();
                        } catch (err) {
                            vscode.window.showErrorMessage(`Import failed: ${(err as Error).message}`);
                        }
                    }
                });
            break; // Only prompt for the first one found.
        }
    }
}

function refreshViews(): void {
    treeProvider.setMembers(activeRoot?.members ?? []);
    treeProvider.refresh();
    statusBar.update(activeRoot);
}
