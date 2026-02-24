/**
 * Shared utilities for CLI commands — instantiates engine components.
 */

import { ConfigStore, WorkspaceRegistry, SessionManager, SymlinkEngine } from 'vws-engine';
import type { ToolAdapter } from 'vws-engine';

/** Pre-configured instances for CLI use. */
const store = new ConfigStore();
const engine = new SymlinkEngine();
const registry = new WorkspaceRegistry(store, engine);
const sessionManager = new SessionManager(store, engine);

export { store, engine, registry, sessionManager };

/** Built-in tool adapters for the --with flag. */
export const BUILT_IN_ADAPTERS: ToolAdapter[] = [
    { name: 'cursor', command: 'cursor {path}' },
    { name: 'code', command: 'code {path}' },
    { name: 'windsurf', command: 'windsurf {path}' },
    { name: 'claude', command: 'claude --context {path}' },
    { name: 'zed', command: 'zed {path}' },
    { name: 'antigravity', command: 'antigravity {path}' },
];

/**
 * Resolve a tool adapter by name.
 * Checks built-in adapters first, then user-defined adapters in adapters.json.
 */
export function resolveAdapter(toolName: string): ToolAdapter | undefined {
    // Check built-in first.
    const builtIn = BUILT_IN_ADAPTERS.find((a) => a.name === toolName);
    if (builtIn) return builtIn;

    // Check user-defined adapters.
    const userAdapters = store.readJSON<ToolAdapter[]>(store.adaptersFilePath);
    if (userAdapters) {
        return userAdapters.find((a) => a.name === toolName);
    }

    return undefined;
}

/**
 * Print an error message and exit.
 */
export function exitWithError(message: string): never {
    console.error(`\x1b[31m✗ ${message}\x1b[0m`);
    process.exit(1);
}

/**
 * Print a success message.
 */
export function printSuccess(message: string): void {
    console.log(`\x1b[32m✓ ${message}\x1b[0m`);
}

/**
 * Print an info message.
 */
export function printInfo(message: string): void {
    console.log(`\x1b[36mℹ ${message}\x1b[0m`);
}
