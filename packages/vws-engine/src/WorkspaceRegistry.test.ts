/**
 * Unit tests for WorkspaceRegistry.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { ConfigStore } from './ConfigStore.js';
import { WorkspaceRegistry } from './WorkspaceRegistry.js';
import { SymlinkEngine } from './SymlinkEngine.js';

describe('WorkspaceRegistry', () => {
    let tempConfigDir: string;
    let tempProjectDir: string;
    let store: ConfigStore;
    let registry: WorkspaceRegistry;

    beforeEach(() => {
        tempConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vws-registry-test-'));
        tempProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vws-projects-'));
        store = new ConfigStore(tempConfigDir);
        registry = new WorkspaceRegistry(store, new SymlinkEngine());

        // Create fake project directories.
        fs.mkdirSync(path.join(tempProjectDir, 'project-a'));
        fs.mkdirSync(path.join(tempProjectDir, 'project-b'));
    });

    afterEach(() => {
        fs.rmSync(tempConfigDir, { recursive: true, force: true });
        fs.rmSync(tempProjectDir, { recursive: true, force: true });
    });

    it('should create and retrieve a workspace', () => {
        registry.create('test-workspace');

        const workspace = registry.get('test-workspace');
        expect(workspace).toBeDefined();
        expect(workspace?.name).toBe('test-workspace');
        expect(workspace?.members).toEqual([]);
    });

    it('should throw on duplicate workspace names', () => {
        registry.create('test-workspace');
        expect(() => registry.create('test-workspace')).toThrow('already exists');
    });

    it('should add members to a workspace', () => {
        registry.create('test-workspace');

        const projectPath = path.join(tempProjectDir, 'project-a');
        registry.addMember('test-workspace', { path: projectPath });

        const workspace = registry.get('test-workspace');
        expect(workspace?.members).toHaveLength(1);
        expect(workspace?.members[0].path).toBe(projectPath);
    });

    it('should reject duplicate members', () => {
        registry.create('test-workspace');

        const projectPath = path.join(tempProjectDir, 'project-a');
        registry.addMember('test-workspace', { path: projectPath });

        expect(() => registry.addMember('test-workspace', { path: projectPath })).toThrow(
            'already exists',
        );
    });

    it('should remove members from a workspace', () => {
        registry.create('test-workspace');

        const projectPathA = path.join(tempProjectDir, 'project-a');
        const projectPathB = path.join(tempProjectDir, 'project-b');
        registry.addMember('test-workspace', { path: projectPathA });
        registry.addMember('test-workspace', { path: projectPathB, alias: 'beta' });

        registry.removeMember('test-workspace', 'beta');

        const workspace = registry.get('test-workspace');
        expect(workspace?.members).toHaveLength(1);
        expect(workspace?.members[0].path).toBe(projectPathA);
    });

    it('should delete a workspace', () => {
        registry.create('test-workspace');
        registry.delete('test-workspace');

        expect(registry.get('test-workspace')).toBeUndefined();
    });

    it('should list all workspaces', () => {
        registry.create('ws-1');
        registry.create('ws-2');
        registry.create('ws-3');

        const all = registry.loadAll();
        expect(all).toHaveLength(3);
    });

    it('should import from a .vworkspace.json file', () => {
        const vwFile = {
            name: 'imported-workspace',
            version: '1',
            members: [
                { path: path.join(tempProjectDir, 'project-a'), alias: 'alpha' },
                { path: path.join(tempProjectDir, 'project-b') },
            ],
        };

        const filePath = path.join(tempConfigDir, '.vworkspace.json');
        fs.writeFileSync(filePath, JSON.stringify(vwFile));

        const workspace = registry.importFromFile(filePath);
        expect(workspace.name).toBe('imported-workspace');
        expect(workspace.members).toHaveLength(2);
    });

    it('should export a workspace to a .vworkspace.json file', () => {
        registry.create('export-test');
        const projectPath = path.join(tempProjectDir, 'project-a');
        registry.addMember('export-test', { path: projectPath });

        const outputPath = path.join(tempConfigDir, 'exported.json');
        registry.exportToFile('export-test', outputPath);

        const exported = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));
        expect(exported.name).toBe('export-test');
        expect(exported.version).toBe('1');
        expect(exported.members).toHaveLength(1);
    });
});
