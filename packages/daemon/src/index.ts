/**
 * VWS Session Daemon — Background process that monitors the parent process
 * and cleans up the virtual root when the parent exits.
 *
 * Usage: node daemon.js <virtualRootPath> <sessionId> <parentPid>
 *
 * This script is spawned in detached mode by SessionManager and periodically
 * checks if the parent process is still alive. When the parent exits, the
 * daemon destroys the virtual root and removes the session file.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

const POLL_INTERVAL_MS = 5000;

/** Resolve the VWS config directory. */
function getConfigDir(): string {
    return path.join(os.homedir(), '.vws');
}

/** Check if a process is still alive by sending signal 0. */
function isProcessAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

/**
 * Remove the virtual root directory safely.
 * Removes symlinks individually to avoid following them into real projects.
 */
function destroyVirtualRoot(rootPath: string): void {
    if (!fs.existsSync(rootPath)) {
        return;
    }

    try {
        const entries = fs.readdirSync(rootPath, { withFileTypes: true });
        for (const entry of entries) {
            const entryPath = path.join(rootPath, entry.name);
            const stats = fs.lstatSync(entryPath);

            if (stats.isSymbolicLink()) {
                fs.unlinkSync(entryPath);
            } else if (process.platform === 'win32' && stats.isDirectory()) {
                try {
                    fs.readlinkSync(entryPath);
                    fs.rmdirSync(entryPath); // Windows junction
                } catch {
                    fs.rmSync(entryPath, { recursive: true, force: true });
                }
            } else {
                fs.rmSync(entryPath, { recursive: true, force: true });
            }
        }

        fs.rmdirSync(rootPath);
    } catch (err) {
        // Best-effort cleanup; log and continue.
        logDaemon(`Error destroying virtual root: ${err}`);
    }
}

/** Remove the session state file. */
function removeSessionFile(sessionId: string): void {
    const sessionFile = path.join(getConfigDir(), 'sessions', `${sessionId}.json`);
    try {
        if (fs.existsSync(sessionFile)) {
            fs.unlinkSync(sessionFile);
        }
    } catch {
        // Best-effort.
    }
}

/** Append a log entry for daemon activity. */
function logDaemon(message: string): void {
    try {
        const logFile = path.join(getConfigDir(), 'logs', 'vws.log');
        const timestamp = new Date().toISOString();
        fs.appendFileSync(logFile, `[${timestamp}] [daemon] ${message}\n`, 'utf-8');
    } catch {
        // Logging failure should not crash the daemon.
    }
}

// ─── Entry Point ───────────────────────────────────────────────

function main(): void {
    const args = process.argv.slice(2);

    if (args.length < 3) {
        console.error('Usage: node daemon.js <virtualRootPath> <sessionId> <parentPid>');
        process.exit(1);
    }

    const [virtualRootPath, sessionId, parentPidStr] = args;
    const parentPid = parseInt(parentPidStr, 10);

    if (isNaN(parentPid)) {
        console.error(`Invalid parent PID: ${parentPidStr}`);
        process.exit(1);
    }

    logDaemon(`Daemon started for session "${sessionId}", watching parent PID ${parentPid}`);
    logDaemon(`Virtual root: ${virtualRootPath}`);

    const interval = setInterval(() => {
        if (!isProcessAlive(parentPid)) {
            logDaemon(`Parent PID ${parentPid} is gone. Cleaning up session "${sessionId}".`);

            clearInterval(interval);
            destroyVirtualRoot(virtualRootPath);
            removeSessionFile(sessionId);

            logDaemon(`Cleanup complete for session "${sessionId}". Daemon exiting.`);
            process.exit(0);
        }
    }, POLL_INTERVAL_MS);

    // Handle SIGTERM from `vws close`.
    process.on('SIGTERM', () => {
        logDaemon(`Daemon received SIGTERM for session "${sessionId}". Exiting gracefully.`);
        clearInterval(interval);
        process.exit(0);
    });

    // Prevent unhandled exceptions from crashing the daemon silently.
    process.on('uncaughtException', (err) => {
        logDaemon(`Daemon uncaught exception: ${err.message}`);
    });
}

main();
