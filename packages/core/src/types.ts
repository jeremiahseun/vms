/** A project linked into a workspace. */
export interface Member {
  /** Name of the entry inside the workspace folder (e.g. "api"). */
  alias: string;
  /** Absolute, symlink-resolved path of the real project folder. */
  path: string;
  /** Set when this member is a branch checkout (git worktree) of another repo. */
  worktree?: { repo: string; branch: string };
}

export interface Workspace {
  name: string;
  /** Absolute path of the workspace folder (what IDEs and agents open). */
  root: string;
  members: Member[];
  /** ISO timestamp. */
  createdAt: string;
  /** ISO timestamp when a temporary workspace is auto-deleted; null = permanent. */
  expiresAt: string | null;
  /** false = deactivated: definition kept, folder removed from disk. */
  active: boolean;
  /** ISO timestamp of the last "expiring soon" desktop notification. */
  warnedAt?: string | null;
  /** Set when a temporary workspace expired: folder removed, definition kept for restore. */
  archivedAt?: string | null;
}

export interface State {
  version: 2;
  workspaces: Record<string, Workspace>;
}

export interface ToolDef {
  /** Executable to run. */
  command: string;
  /** Arguments; "{root}" is replaced by the workspace path. */
  args?: string[];
  /** Arguments repeated once per member; "{path}" and "{alias}" are replaced. */
  perMember?: string[];
  /** GUI apps are started detached; terminal apps take over the terminal. */
  gui?: boolean;
  /** macOS app name used via `open -a` when the command isn't on PATH (e.g. "Cursor"). */
  macApp?: string;
}

export interface Config {
  /** Folder holding workspace folders. Default: ~/vws */
  root?: string;
  /** Default lifetime for temporary workspaces, e.g. "72h". */
  ttl?: string;
  /** How long expired workspaces stay restorable, e.g. "30d". */
  keepExpired?: string;
  /** Extra or overridden launch tools. */
  tools?: Record<string, ToolDef>;
}

export type MemberHealth = 'ok' | 'missing-target' | 'missing-link' | 'wrong-link' | 'blocked';

export interface MemberStatus extends Member {
  health: MemberHealth;
  /** Current git branch (or short commit when detached); null if not a git repo. */
  branch: string | null;
}
