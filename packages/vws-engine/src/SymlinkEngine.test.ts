/**
 * Unit tests for SymlinkEngine.
 *
 * Tests create real temporary directories and symlinks to verify filesystem
 * operations work correctly. No mocking of fs — real symlink calls only.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { SymlinkEngine } from './SymlinkEngine.js';
import type { Member } from './types.js';

describe('SymlinkEngine', () => {
    let engine: SymlinkEngine;
    let tempDir: string;
    let projectA: string;
    let projectB: string;

    beforeEach(() => {
        engine = new SymlinkEngine();

        // Create fresh temp directories to act as "real projects".
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vws-test-'));
        projectA = path.join(tempDir, 'project-a');
        projectB = path.join(tempDir, 'project-b');
        fs.mkdirSync(projectA);
        fs.mkdirSync(projectB);

        // Place a marker file in each so we can verify reads work through symlinks.
        fs.writeFileSync(path.join(projectA, 'marker.txt'), 'project-a-content');
        fs.writeFileSync(path.join(projectB, 'marker.txt'), 'project-b-content');
    });

    afterEach(() => {
        // Clean up all temp directories.
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('should create a virtual root with symlinks to members', async () => {
        const members: Member[] = [
            { path: projectA },
            { path: projectB, alias: 'beta' },
        ];

        const root = await engine.create(members, { tempDir });

        // Root directory should exist.
        expect(fs.existsSync(root.path)).toBe(true);

        // Symlinks should exist with correct names.
        const linkA = path.join(root.path, 'project-a');
        const linkB = path.join(root.path, 'beta');
        expect(fs.existsSync(linkA)).toBe(true);
        expect(fs.existsSync(linkB)).toBe(true);

        // Verify they are actually symlinks.
        expect(fs.lstatSync(linkA).isSymbolicLink()).toBe(true);
        expect(fs.lstatSync(linkB).isSymbolicLink()).toBe(true);

        // Verify symlink targets.
        expect(fs.readlinkSync(linkA)).toBe(projectA);
        expect(fs.readlinkSync(linkB)).toBe(projectB);

        // Verify reads through symlinks work.
        const contentA = fs.readFileSync(path.join(linkA, 'marker.txt'), 'utf-8');
        expect(contentA).toBe('project-a-content');

        const contentB = fs.readFileSync(path.join(linkB, 'marker.txt'), 'utf-8');
        expect(contentB).toBe('project-b-content');

        // Clean up.
        await engine.destroy(root);
        expect(fs.existsSync(root.path)).toBe(false);
    });

    it('should destroy a virtual root without affecting real projects', async () => {
        const members: Member[] = [{ path: projectA }];
        const root = await engine.create(members, { tempDir });

        await engine.destroy(root);

        // Virtual root should be gone.
        expect(fs.existsSync(root.path)).toBe(false);

        // Real project should still exist.
        expect(fs.existsSync(projectA)).toBe(true);
        expect(fs.readFileSync(path.join(projectA, 'marker.txt'), 'utf-8')).toBe('project-a-content');
    });

    it('should add a member to an existing virtual root', async () => {
        const members: Member[] = [{ path: projectA }];
        const root = await engine.create(members, { tempDir });

        await engine.addMember(root, { path: projectB, alias: 'beta' });

        const linkB = path.join(root.path, 'beta');
        expect(fs.existsSync(linkB)).toBe(true);
        expect(fs.lstatSync(linkB).isSymbolicLink()).toBe(true);
        expect(root.members).toHaveLength(2);

        // Clean up.
        await engine.destroy(root);
    });

    it('should remove a member from an existing virtual root', async () => {
        const members: Member[] = [
            { path: projectA },
            { path: projectB, alias: 'beta' },
        ];
        const root = await engine.create(members, { tempDir });

        await engine.removeMember(root, 'beta');

        const linkB = path.join(root.path, 'beta');
        expect(fs.existsSync(linkB)).toBe(false);
        expect(root.members).toHaveLength(1);

        // project-a symlink should still exist.
        expect(fs.existsSync(path.join(root.path, 'project-a'))).toBe(true);

        // Clean up.
        await engine.destroy(root);
    });

    it('should throw if member path does not exist', async () => {
        const members: Member[] = [{ path: '/nonexistent/path/xyz' }];
        await expect(engine.create(members, { tempDir })).rejects.toThrow('does not exist');
    });

    it('should throw on duplicate alias', async () => {
        const members: Member[] = [
            { path: projectA, alias: 'shared' },
            { path: projectB, alias: 'shared' },
        ];
        await expect(engine.create(members, { tempDir })).rejects.toThrow('already exists');
    });

    it('should resolve ~ in paths', () => {
        const resolved = engine.resolvePath('~/some/path');
        expect(resolved).toBe(path.join(os.homedir(), 'some/path'));
    });

    it('should resolve alias from basename when no alias is set', () => {
        const alias = engine.resolveAlias({ path: '/foo/bar/my-project' });
        expect(alias).toBe('my-project');
    });

    it('should use explicit alias when set', () => {
        const alias = engine.resolveAlias({ path: '/foo/bar/my-project', alias: 'custom' });
        expect(alias).toBe('custom');
    });

    it('should write through symlinks to real files', async () => {
        const members: Member[] = [{ path: projectA }];
        const root = await engine.create(members, { tempDir });

        // Write through the symlink.
        const symlinkFile = path.join(root.path, 'project-a', 'new-file.txt');
        fs.writeFileSync(symlinkFile, 'written-through-symlink');

        // Read from the real location.
        const realFile = path.join(projectA, 'new-file.txt');
        expect(fs.existsSync(realFile)).toBe(true);
        expect(fs.readFileSync(realFile, 'utf-8')).toBe('written-through-symlink');

        // Clean up.
        await engine.destroy(root);
    });
});
