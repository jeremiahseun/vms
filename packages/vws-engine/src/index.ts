/**
 * vws-engine — Public API barrel file.
 *
 * Re-exports all types and classes needed by consumers (CLI, extension).
 */

export { SymlinkEngine } from './SymlinkEngine.js';
export { SessionManager } from './SessionManager.js';
export { WorkspaceRegistry } from './WorkspaceRegistry.js';
export { ConfigStore } from './ConfigStore.js';

export type {
    Member,
    VirtualRoot,
    CreateOptions,
    WorkspaceConfig,
    WorkspaceOptions,
    WorkspacesRegistry,
    SessionState,
    VWorkspaceFile,
    ToolAdapter,
} from './types.js';
