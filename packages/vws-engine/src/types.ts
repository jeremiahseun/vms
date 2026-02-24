/**
 * VWS Engine — Shared types for the Virtual Workspace Aggregator.
 *
 * These types are consumed by the CLI, daemon, and VSCode extension.
 */

/** A single project registered in a workspace. */
export interface Member {
    /** Absolute path to the real project directory on disk. */
    path: string;
    /** Optional alias used as the symlink name in the virtual root. Defaults to basename of path. */
    alias?: string;
}

/** Represents an active virtual root created by VWS. */
export interface VirtualRoot {
    /** Unique session identifier (UUID). */
    id: string;
    /** Absolute path to the ephemeral virtual root directory (e.g. /tmp/vws-<uuid>). */
    path: string;
    /** List of members linked into this virtual root. */
    members: Member[];
    /** PID of the session daemon watching this root. */
    pid: number;
    /** PID of the parent process (shell/editor) the daemon monitors. */
    parentPid: number;
    /** ISO 8601 timestamp of session creation. */
    createdAt: string;
}

/** Configuration options for creating a virtual root. */
export interface CreateOptions {
    /** Override the temp directory prefix. Default: system temp dir. */
    tempDir?: string;
}

/** A named workspace configuration persisted in ~/.vws/workspaces.json. */
export interface WorkspaceConfig {
    /** Human-readable workspace name. */
    name: string;
    /** Project members registered in this workspace. */
    members: Member[];
    /** Optional workspace-level settings. */
    options?: WorkspaceOptions;
}

/** Optional settings stored per-workspace. */
export interface WorkspaceOptions {
    /** Tool adapter name to launch automatically with `vws open`. */
    launchWith?: string;
    /** Auto-activate when the parent project is opened in an IDE. */
    autoOpen?: boolean;
    /** Glob patterns excluded from symlink traversal hints. */
    excludePatterns?: string[];
}

/** Top-level shape of the ~/.vws/workspaces.json registry file. */
export interface WorkspacesRegistry {
    workspaces: WorkspaceConfig[];
}

/** Shape of ~/.vws/sessions/<uuid>.json. */
export interface SessionState {
    /** Session UUID. */
    id: string;
    /** Absolute path to the virtual root directory. */
    virtualRootPath: string;
    /** Name of the workspace this session was opened from. */
    workspaceName: string;
    /** Members linked in this session. */
    members: Member[];
    /** PID of the session daemon. */
    daemonPid: number;
    /** PID of the parent process being monitored. */
    parentPid: number;
    /** ISO 8601 timestamp of session creation. */
    createdAt: string;
}

/** Shape of the .vworkspace.json file committed to a project repo. */
export interface VWorkspaceFile {
    $schema?: string;
    name: string;
    version: string;
    members: Member[];
    options?: WorkspaceOptions;
}

/** A tool adapter entry for the --with flag. */
export interface ToolAdapter {
    /** Tool name (e.g. 'cursor', 'code'). */
    name: string;
    /** Command template with {path} placeholder. e.g. 'cursor {path}' */
    command: string;
}
