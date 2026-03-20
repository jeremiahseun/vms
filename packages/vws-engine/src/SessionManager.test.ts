/**
 * Unit tests for SessionManager.
 *
 * Tests verify session lifecycle: open, close, orphan cleanup, and custom naming.
 * Uses real temp directories and the in-process cleanup fallback (no daemon script).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { ConfigStore } from './ConfigStore.js';
import { SymlinkEngine } from './SymlinkEngine.js';
import { SessionManager } from './SessionManager.js';

describe('SessionManager', () => {
    let tempConfigDir: string;
    let tempProjectDir: string;
    let store: ConfigStore;
    let engine: SymlinkEngine;
    let manager: SessionManager;
    let projectA: string;
    let projectB: string;

    beforeEach(() => {
        tempConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vws-session-test-'));
        tempProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vws-projects-'));
        store = new ConfigStore(tempConfigDir);
        engine = new SymlinkEngine();
        manager = new SessionManager(store, engine);

        // Create fake project directories.
        projectA = path.join(tempProjectDir, 'project-a');
        projectB = path.join(tempProjectDir, 'project-b');
        fs.mkdirSync(projectA);
        fs.mkdirSync(projectB);

        // Marker files for verification.
        fs.writeFileSync(path.join(projectA, 'marker.txt'), 'project-a');
        fs.writeFileSync(path.join(projectB, 'marker.txt'), 'project-b');
    });

    afterEach(() => {
        fs.rmSync(tempConfigDir, { recursive: true, force: true });
        fs.rmSync(tempProjectDir, { recursive: true, force: true });
    });

    it('should open a session and create a virtual root', async () => {
        const root = await manager.open('test-workspace', [
            { path: projectA },
            { path: projectB, alias: 'beta' },
        ]);

        expect(root.id).toBeDefined();
        expect(root.path).toBeTruthy();
        expect(fs.existsSync(root.path)).toBe(true);
        expect(root.members).toHaveLength(2);

        // Verify symlinks exist in the virtual root.
        expect(fs.existsSync(path.join(root.path, 'project-a'))).toBe(true);
        expect(fs.existsSync(path.join(root.path, 'beta'))).toBe(true);

        // Verify session state file was persisted.
        const sessionFile = store.sessionFilePath(root.id);
        expect(fs.existsSync(sessionFile)).toBe(true);

        // Clean up.
        await manager.close(root.id);
    });

    it('should close a session and destroy the virtual root completely', async () => {
        const root = await manager.open('test-workspace', [
            { path: projectA },
        ]);

        const rootPath = root.path;
        const sessionFile = store.sessionFilePath(root.id);

        // Verify root and session file exist before close.
        expect(fs.existsSync(rootPath)).toBe(true);
        expect(fs.existsSync(sessionFile)).toBe(true);

        await manager.close(root.id);

        // Virtual root must be completely gone.
        expect(fs.existsSync(rootPath)).toBe(false);
        // Session file must be removed.
        expect(fs.existsSync(sessionFile)).toBe(false);
        // Real projects must still exist.
        expect(fs.existsSync(projectA)).toBe(true);
    });

    it('should close the most recent session when no ID is given', async () => {
        const root = await manager.open('test-workspace', [
            { path: projectA },
        ]);

        const rootPath = root.path;

        // Close without specifying a session ID.
        await manager.close();

        expect(fs.existsSync(rootPath)).toBe(false);
    });

    it('should return the active session', async () => {
        const root = await manager.open('test-workspace', [
            { path: projectA },
        ]);

        const active = manager.getActiveSession();
        expect(active).not.toBeNull();
        expect(active?.id).toBe(root.id);
        expect(active?.workspaceName).toBe('test-workspace');

        await manager.close(root.id);
    });

    it('should return null when no session is active', () => {
        const active = manager.getActiveSession();
        expect(active).toBeNull();
    });

    it('should throw when closing a nonexistent session', async () => {
        await expect(manager.close('nonexistent-id')).rejects.toThrow('not found');
    });

    it('should throw when no active session exists for close()', async () => {
        await expect(manager.close()).rejects.toThrow('No active session');
    });

    it('should support custom virtual root names', async () => {
        const root = await manager.open(
            'test-workspace',
            [{ path: projectA }],
            { name: 'my-custom-root' },
        );

        expect(root.id).toBe('my-custom-root');
        expect(root.path).toContain('vws-my-custom-root');
        expect(fs.existsSync(root.path)).toBe(true);

        await manager.close(root.id);
        expect(fs.existsSync(root.path)).toBe(false);
    });

    it('should clean up orphaned sessions', async () => {
        store.ensureDirectories();

        // Create a fake orphan session file with a dead PID.
        const orphanSession = {
            id: 'orphan-123',
            virtualRootPath: path.join(os.tmpdir(), 'vws-orphan-test-fake'),
            workspaceName: 'orphan-workspace',
            members: [],
            daemonPid: 999999999, // Almost certainly not a real PID.
            parentPid: 999999998,
            createdAt: new Date().toISOString(),
        };
        store.writeJSON(store.sessionFilePath('orphan-123'), orphanSession);

        // Verify the orphan session file exists.
        expect(fs.existsSync(store.sessionFilePath('orphan-123'))).toBe(true);

        // Cleanup should remove the orphan.
        manager.cleanupOrphans();

        expect(fs.existsSync(store.sessionFilePath('orphan-123'))).toBe(false);
    });

    it('should list all sessions', async () => {
        const root1 = await manager.open('ws-1', [{ path: projectA }]);
        const root2 = await manager.open('ws-2', [{ path: projectB }]);

        const sessions = manager.listSessions();
        expect(sessions.length).toBeGreaterThanOrEqual(2);

        // Clean up.
        await manager.close(root1.id);
        await manager.close(root2.id);
    });
});
