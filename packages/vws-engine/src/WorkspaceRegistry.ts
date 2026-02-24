/**
 * WorkspaceRegistry — Manages the persistent workspace configurations.
 *
 * Read/write operations for ~/.vws/workspaces.json and .vworkspace.json files.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
    WorkspaceConfig,
    WorkspacesRegistry,
    VWorkspaceFile,
    Member,
} from './types.js';
import { ConfigStore } from './ConfigStore.js';
import { SymlinkEngine } from './SymlinkEngine.js';

export class WorkspaceRegistry {
    private readonly store: ConfigStore;
    private readonly engine: SymlinkEngine;

    constructor(store: ConfigStore, engine?: SymlinkEngine) {
        this.store = store;
        this.engine = engine ?? new SymlinkEngine();
    }

    /**
     * Load all workspaces from the registry.
     */
    loadAll(): WorkspaceConfig[] {
        this.store.ensureDirectories();
        const registry = this.store.readJSON<WorkspacesRegistry>(this.store.workspacesFilePath);
        return registry?.workspaces ?? [];
    }

    /**
     * Save the full workspace list back to disk.
     */
    private saveAll(workspaces: WorkspaceConfig[]): void {
        this.store.ensureDirectories();
        const registry: WorkspacesRegistry = { workspaces };
        this.store.writeJSON(this.store.workspacesFilePath, registry);
    }

    /**
     * Get a workspace by name.
     */
    get(name: string): WorkspaceConfig | undefined {
        return this.loadAll().find((w) => w.name === name);
    }

    /**
     * Create a new named workspace. Throws if one with the same name already exists.
     */
    create(name: string, members: Member[] = [], options?: WorkspaceConfig['options']): WorkspaceConfig {
        const workspaces = this.loadAll();

        if (workspaces.some((w) => w.name === name)) {
            throw new Error(`Workspace "${name}" already exists. Use a different name.`);
        }

        const workspace: WorkspaceConfig = { name, members, options };
        workspaces.push(workspace);
        this.saveAll(workspaces);

        this.store.log(`Created workspace "${name}"`);
        return workspace;
    }

    /**
     * Delete a workspace by name.
     */
    delete(name: string): void {
        const workspaces = this.loadAll();
        const filtered = workspaces.filter((w) => w.name !== name);

        if (filtered.length === workspaces.length) {
            throw new Error(`Workspace "${name}" not found.`);
        }

        this.saveAll(filtered);
        this.store.log(`Deleted workspace "${name}"`);
    }

    /**
     * Add a member to a workspace.
     */
    addMember(workspaceName: string, member: Member): void {
        const workspaces = this.loadAll();
        const workspace = workspaces.find((w) => w.name === workspaceName);

        if (!workspace) {
            throw new Error(`Workspace "${workspaceName}" not found.`);
        }

        const resolvedPath = this.engine.resolvePath(member.path);

        if (!fs.existsSync(resolvedPath)) {
            throw new Error(`Directory does not exist: ${resolvedPath}`);
        }
        if (!fs.statSync(resolvedPath).isDirectory()) {
            throw new Error(`Path is not a directory: ${resolvedPath}`);
        }

        const alias = member.alias ?? path.basename(resolvedPath);

        // Check for duplicates by resolved path or alias.
        const duplicate = workspace.members.find((m) => {
            const existingResolved = this.engine.resolvePath(m.path);
            const existingAlias = this.engine.resolveAlias(m);
            return existingResolved === resolvedPath || existingAlias === alias;
        });

        if (duplicate) {
            throw new Error(
                `A member with path "${resolvedPath}" or alias "${alias}" already exists in workspace "${workspaceName}".`,
            );
        }

        workspace.members.push({ path: resolvedPath, alias: member.alias });
        this.saveAll(workspaces);
        this.store.log(`Added member "${resolvedPath}" (alias: ${alias}) to workspace "${workspaceName}"`);
    }

    /**
     * Remove a member from a workspace by path or alias.
     */
    removeMember(workspaceName: string, pathOrAlias: string): void {
        const workspaces = this.loadAll();
        const workspace = workspaces.find((w) => w.name === workspaceName);

        if (!workspace) {
            throw new Error(`Workspace "${workspaceName}" not found.`);
        }

        const initialLength = workspace.members.length;
        workspace.members = workspace.members.filter((m) => {
            const resolvedPath = this.engine.resolvePath(m.path);
            const alias = this.engine.resolveAlias(m);
            return resolvedPath !== pathOrAlias && alias !== pathOrAlias && m.path !== pathOrAlias;
        });

        if (workspace.members.length === initialLength) {
            throw new Error(`Member "${pathOrAlias}" not found in workspace "${workspaceName}".`);
        }

        this.saveAll(workspaces);
        this.store.log(`Removed member "${pathOrAlias}" from workspace "${workspaceName}"`);
    }

    /**
     * Import a workspace from a .vworkspace.json file.
     */
    importFromFile(filePath: string): WorkspaceConfig {
        if (!fs.existsSync(filePath)) {
            throw new Error(`File not found: ${filePath}`);
        }

        const raw = fs.readFileSync(filePath, 'utf-8');
        const vwFile = JSON.parse(raw) as VWorkspaceFile;

        if (!vwFile.name || !vwFile.members || !Array.isArray(vwFile.members)) {
            throw new Error(`Invalid .vworkspace.json: missing "name" or "members" fields.`);
        }

        // Resolve all member paths relative to the file's location.
        const fileDir = path.dirname(path.resolve(filePath));
        const resolvedMembers: Member[] = vwFile.members.map((m) => ({
            path: this.engine.resolvePath(m.path),
            alias: m.alias,
        }));

        return this.create(vwFile.name, resolvedMembers, vwFile.options);
    }

    /**
     * Export a workspace to a .vworkspace.json file.
     */
    exportToFile(workspaceName: string, outputPath: string): void {
        const workspace = this.get(workspaceName);

        if (!workspace) {
            throw new Error(`Workspace "${workspaceName}" not found.`);
        }

        const vwFile: VWorkspaceFile = {
            $schema: 'https://vws.dev/schema/vworkspace.json',
            name: workspace.name,
            version: '1',
            members: workspace.members,
            options: workspace.options,
        };

        this.store.writeJSON(outputPath, vwFile);
        this.store.log(`Exported workspace "${workspaceName}" to ${outputPath}`);
    }
}
