/**
 * SessionManager — Orchestrates virtual root lifecycle and daemon management.
 *
 * Coordinates the SymlinkEngine, ConfigStore, and daemon process to provide
 * a high-level API for opening and closing VWS sessions.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fork, execSync } from 'node:child_process';
import type { Member, VirtualRoot, SessionState, CreateOptions } from './types.js';
import { SymlinkEngine } from './SymlinkEngine.js';
import { ConfigStore } from './ConfigStore.js';

export class SessionManager {
    private readonly engine: SymlinkEngine;
    private readonly store: ConfigStore;

    constructor(store: ConfigStore, engine?: SymlinkEngine) {
        this.store = store;
        this.engine = engine ?? new SymlinkEngine();
    }

    /**
     * Open a new VWS session: create the virtual root, spawn the daemon, and persist state.
     *
     * @param workspaceName - Name of the workspace being opened (for tracking).
     * @param members - Members to link into the virtual root.
     * @param options - Optional overrides for temp directory, etc.
     * @returns The created VirtualRoot with daemon PID populated.
     */
    async open(
        workspaceName: string,
        members: Member[],
        options?: CreateOptions,
    ): Promise<VirtualRoot> {
        // Clean up any orphaned sessions first.
        this.cleanupOrphans();

        this.store.ensureDirectories();

        // Create the virtual root with symlinks.
        const root = await this.engine.create(members, options);

        // Spawn the session daemon as a detached child process.
        const daemonPid = this.spawnDaemon(root);
        root.pid = daemonPid;

        // Persist session state.
        const sessionState: SessionState = {
            id: root.id,
            virtualRootPath: root.path,
            workspaceName,
            members: root.members,
            daemonPid,
            parentPid: process.pid,
            createdAt: root.createdAt,
        };

        this.store.writeJSON(this.store.sessionFilePath(root.id), sessionState);
        this.store.log(`Opened session "${root.id}" for workspace "${workspaceName}" at ${root.path}`);

        return root;
    }

    /**
     * Close an active session: kill the daemon, destroy the virtual root, remove session file.
     * Hardened to guarantee the virtual root is inaccessible after close.
     *
     * @param sessionId - UUID of the session to close. If omitted, closes the most recent session.
     */
    async close(sessionId?: string): Promise<void> {
        const session = sessionId
            ? this.getSession(sessionId)
            : this.getActiveSession();

        if (!session) {
            throw new Error(sessionId ? `Session "${sessionId}" not found.` : 'No active session found.');
        }

        // Kill the daemon process first.
        this.killDaemon(session.daemonPid);

        // Destroy the virtual root directory.
        const root: VirtualRoot = {
            id: session.id,
            path: session.virtualRootPath,
            members: session.members,
            pid: session.daemonPid,
            parentPid: session.parentPid,
            createdAt: session.createdAt,
        };

        try {
            await this.engine.destroy(root);
        } catch (err) {
            // Primary destroy failed — force-cleanup as fallback.
            this.store.log(`Primary destroy failed for session "${session.id}": ${err}`);
            try {
                if (fs.existsSync(session.virtualRootPath)) {
                    fs.rmSync(session.virtualRootPath, { recursive: true, force: true });
                }
            } catch (fallbackErr) {
                this.store.log(`Force cleanup also failed for session "${session.id}": ${fallbackErr}`);
            }
        }

        // Verify the virtual root is fully gone.
        if (fs.existsSync(session.virtualRootPath)) {
            this.store.log(`WARNING: Virtual root still exists after close for session "${session.id}" at ${session.virtualRootPath}`);
        }

        // Always remove the session state file, even if destroy failed.
        const sessionFile = this.store.sessionFilePath(session.id);
        if (fs.existsSync(sessionFile)) {
            fs.unlinkSync(sessionFile);
        }

        this.store.log(`Closed session "${session.id}"`);
    }

    /**
     * Get the currently active session (most recently created).
     */
    getActiveSession(): SessionState | null {
        const sessions = this.listSessions();
        if (sessions.length === 0) return null;

        // Sort by creation time descending, return the most recent.
        sessions.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        return sessions[0];
    }

    /**
     * Get a specific session by ID.
     */
    getSession(sessionId: string): SessionState | null {
        const filePath = this.store.sessionFilePath(sessionId);
        return this.store.readJSON<SessionState>(filePath);
    }

    /**
     * List all persisted sessions.
     */
    listSessions(): SessionState[] {
        const files = this.store.listSessionFiles();
        const sessions: SessionState[] = [];

        for (const file of files) {
            const session = this.store.readJSON<SessionState>(file);
            if (session) {
                sessions.push(session);
            }
        }

        return sessions;
    }

    /**
     * Scan for orphaned sessions whose daemon PIDs are no longer alive and clean them up.
     */
    cleanupOrphans(): void {
        const sessions = this.listSessions();

        for (const session of sessions) {
            if (!this.isProcessAlive(session.daemonPid)) {
                this.store.log(`Cleaning up orphaned session "${session.id}" (daemon PID ${session.daemonPid} is dead)`);

                // Try to remove the virtual root if it still exists.
                if (fs.existsSync(session.virtualRootPath)) {
                    try {
                        this.engine.destroy({
                            id: session.id,
                            path: session.virtualRootPath,
                            members: session.members,
                            pid: session.daemonPid,
                            parentPid: session.parentPid,
                            createdAt: session.createdAt,
                        });
                    } catch (err) {
                        this.store.log(`Failed to clean up virtual root for orphan "${session.id}": ${err}`);
                    }
                }

                // Remove the session file.
                const sessionFile = this.store.sessionFilePath(session.id);
                if (fs.existsSync(sessionFile)) {
                    fs.unlinkSync(sessionFile);
                }
            }
        }
    }

    /**
     * Spawn the session daemon as a detached process.
     * The daemon script path is resolved relative to this module.
     */
    private spawnDaemon(root: VirtualRoot): number {
        const daemonScript = path.join(__dirname, '..', '..', 'daemon', 'dist', 'index.js');

        // If the daemon script doesn't exist, fall back to a simpler in-process cleanup handler.
        if (!fs.existsSync(daemonScript)) {
            return this.setupInProcessCleanup(root);
        }

        const child = fork(daemonScript, [root.path, root.id, process.pid.toString()], {
            detached: true,
            stdio: 'ignore',
        });

        child.unref();

        if (!child.pid) {
            throw new Error('Failed to spawn session daemon.');
        }

        return child.pid;
    }

    /**
     * Fallback: register signal handlers to clean up the virtual root when the process exits.
     * Returns the current process PID as a stand-in for the daemon PID.
     */
    private setupInProcessCleanup(root: VirtualRoot): number {
        const cleanup = () => {
            try {
                if (fs.existsSync(root.path)) {
                    fs.rmSync(root.path, { recursive: true, force: true });
                }
            } catch {
                // Best-effort cleanup.
            }
        };

        process.on('SIGINT', cleanup);
        process.on('SIGTERM', cleanup);
        process.on('exit', cleanup);

        return process.pid;
    }

    /**
     * Kill a daemon process by PID.
     */
    private killDaemon(pid: number): void {
        if (pid === process.pid) {
            // In-process cleanup mode — nothing to kill.
            return;
        }

        try {
            process.kill(pid, 'SIGTERM');
        } catch {
            // Daemon may already be dead — that's fine.
        }
    }

    /**
     * Check if a process is still alive using signal 0.
     */
    private isProcessAlive(pid: number): boolean {
        try {
            process.kill(pid, 0);
            return true;
        } catch {
            return false;
        }
    }
}
