/**
 * ConfigStore — Manages the ~/.vws/ directory structure.
 *
 * Responsible for ensuring the config directory exists, and providing
 * read/write helpers for workspaces.json, session state, and logs.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

/** Default VWS config directory path. */
const DEFAULT_CONFIG_DIR = path.join(os.homedir(), '.vws');

export class ConfigStore {
    readonly configDir: string;
    readonly sessionsDir: string;
    readonly logsDir: string;
    readonly workspacesFilePath: string;
    readonly adaptersFilePath: string;

    constructor(configDir?: string) {
        this.configDir = configDir ?? DEFAULT_CONFIG_DIR;
        this.sessionsDir = path.join(this.configDir, 'sessions');
        this.logsDir = path.join(this.configDir, 'logs');
        this.workspacesFilePath = path.join(this.configDir, 'workspaces.json');
        this.adaptersFilePath = path.join(this.configDir, 'adapters.json');
    }

    /** Ensure all required directories exist. */
    ensureDirectories(): void {
        fs.mkdirSync(this.configDir, { recursive: true });
        fs.mkdirSync(this.sessionsDir, { recursive: true });
        fs.mkdirSync(this.logsDir, { recursive: true });
    }

    /** Read a JSON file, returning `null` if it does not exist. */
    readJSON<T>(filePath: string): T | null {
        try {
            const raw = fs.readFileSync(filePath, 'utf-8');
            return JSON.parse(raw) as T;
        } catch {
            return null;
        }
    }

    /** Write a JSON file with pretty formatting. */
    writeJSON<T>(filePath: string, data: T): void {
        const dir = path.dirname(filePath);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
    }

    /** Get the file path for a session state file. */
    sessionFilePath(sessionId: string): string {
        return path.join(this.sessionsDir, `${sessionId}.json`);
    }

    /** List all session files. */
    listSessionFiles(): string[] {
        try {
            return fs
                .readdirSync(this.sessionsDir)
                .filter((f) => f.endsWith('.json'))
                .map((f) => path.join(this.sessionsDir, f));
        } catch {
            return [];
        }
    }

    /** Append a log line to the VWS log file. */
    log(message: string): void {
        const logFile = path.join(this.logsDir, 'vws.log');
        const timestamp = new Date().toISOString();
        fs.appendFileSync(logFile, `[${timestamp}] ${message}\n`, 'utf-8');
    }
}
