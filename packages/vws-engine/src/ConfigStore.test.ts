/**
 * Unit tests for ConfigStore.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { ConfigStore } from './ConfigStore.js';

describe('ConfigStore', () => {
    let tempDir: string;
    let store: ConfigStore;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vws-config-test-'));
        store = new ConfigStore(tempDir);
    });

    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('should create required directories', () => {
        store.ensureDirectories();

        expect(fs.existsSync(store.configDir)).toBe(true);
        expect(fs.existsSync(store.sessionsDir)).toBe(true);
        expect(fs.existsSync(store.logsDir)).toBe(true);
    });

    it('should write and read JSON files', () => {
        store.ensureDirectories();

        const data = { hello: 'world', count: 42 };
        const filePath = path.join(tempDir, 'test.json');

        store.writeJSON(filePath, data);
        const result = store.readJSON<typeof data>(filePath);

        expect(result).toEqual(data);
    });

    it('should return null for nonexistent JSON files', () => {
        const result = store.readJSON('/nonexistent/file.json');
        expect(result).toBeNull();
    });

    it('should generate correct session file paths', () => {
        const sessionPath = store.sessionFilePath('abc123');
        expect(sessionPath).toBe(path.join(tempDir, 'sessions', 'abc123.json'));
    });

    it('should list session files', () => {
        store.ensureDirectories();

        // Create some session files.
        store.writeJSON(store.sessionFilePath('session-1'), { id: 'session-1' });
        store.writeJSON(store.sessionFilePath('session-2'), { id: 'session-2' });

        const files = store.listSessionFiles();
        expect(files).toHaveLength(2);
    });

    it('should append log entries', () => {
        store.ensureDirectories();

        store.log('Test message 1');
        store.log('Test message 2');

        const logFile = path.join(store.logsDir, 'vws.log');
        const content = fs.readFileSync(logFile, 'utf-8');

        expect(content).toContain('Test message 1');
        expect(content).toContain('Test message 2');
    });
});
