# VWS - Virtual Workspace Aggregator

## Technical Specification (v1.0 | Draft | 2025)

**Unified ephemeral project views for AI coding tools and IDEs**

Authored for: Senior Engineers & Plugin Developers
CLI Tool | VSCode Extension | Cross-platform

---

## 1. Overview

VWS (Virtual Workspace) is a lightweight tool that creates a temporary, unified directory view of multiple unrelated projects on a developer's local machine. Both the developer and any AI tool — whether a CLI agent or IDE extension — see those projects as if they live in one folder. Nothing is moved or copied; VWS operates entirely via symbolic links (or directory junctions on Windows), making the virtual workspace zero-cost and always in sync with the real files.

The primary motivation is AI context quality. Tools like Claude Code, Cursor, and GitHub Copilot perform best when they can inspect a single coherent project root. Cross-repo awareness is difficult or impossible when projects are opened in separate windows. VWS solves this at the filesystem layer, with no opinion about project structure or toolchain.

**WHY**
VSCode multi-root workspaces come close, but they do not create a real unified path. CLI AI agents, language servers, and test runners all need a single root they can recurse into. VWS provides exactly that.

---

## 2. Core Concepts

### 2.1 The Virtual Root

When VWS is invoked, it creates a temporary directory — the virtual root — at a system temp path such as `/tmp/vws-<uuid>/` or `%TEMP%\vws-<uuid>\`. Inside this directory, each registered project appears as a top-level entry whose name matches the project folder name (or an alias the developer assigns). Every entry is a symbolic link pointing at the real project path on disk.

The virtual root is ephemeral by default: it is destroyed when the session ends or when the developer explicitly runs `vws close`. Nothing is written to disk inside the virtual root; all writes pass through the symlinks to the real locations.

### 2.2 Workspace Registry

VWS maintains a persistent registry file at `~/.vws/workspaces.json`. This file stores named workspace configurations, each of which is a list of absolute project paths and optional metadata. Workspaces can be created interactively at the command line, imported from a `.vworkspace.json` file committed to a repository, or managed via the VSCode extension sidebar.

### 2.3 Session Lifecycle

A VWS session begins with `vws open` and ends with `vws close` (or automatically on shell/editor exit). During a session, a lightweight daemon process holds a PID file and watches for process termination so it can clean up the temporary directory reliably, even if the terminal is killed.

---

## 3. Architecture

### 3.1 System Diagram

The following layers compose the VWS system. Each layer communicates only with its immediate neighbours.

| Layer                 | Responsibility                                                             |
| --------------------- | -------------------------------------------------------------------------- |
| **User Interface**    | CLI (`vws`) and VSCode Extension — accept commands, display status         |
| **Workspace Manager** | Resolves workspace configs, validates paths, generates temp dir names      |
| **Symlink Engine**    | Creates/destroys symlinks (POSIX) or junctions (Windows). Handles aliasing |
| **Session Daemon**    | Lightweight process watching parent PID; triggers cleanup on exit          |
| **Config Store**      | `~/.vws/` directory: `workspaces.json`, session state, logs                |

### 3.2 Directory Layout (Virtual Root)

Given three projects registered under the workspace `acme-fullstack`:

```text
/tmp/vws-a3f9b2/              ← virtual root (ephemeral)
  ├── api-service/             → symlink → ~/work/api-service
  ├── frontend/                → symlink → ~/clients/acme/frontend
  └── shared-utils/            → symlink → ~/libs/shared-utils
```

The AI tool or IDE is opened against `/tmp/vws-a3f9b2/` and recurses freely. All file reads and writes pass transparently through the symlinks to their real locations. No synchronisation step is needed.

### 3.3 Config Store Layout

```text
~/.vws/
  ├── workspaces.json          ← named workspace registry
  ├── sessions/
  │   └── <uuid>.json          ← per-session state (temp path, PID)
  └── logs/
      └── vws.log
```

---

## 4. CLI Design

The CLI binary is named `vws`. It is a single self-contained executable (distributed via npm, Homebrew, or a direct binary download). All subcommands follow the pattern `vws <command> [flags]`.

### 4.1 Command Reference

| Command                             | Description                                             |
| ----------------------------------- | ------------------------------------------------------- |
| `vws init <name>`                   | Create a new named workspace                            |
| `vws add <path> [--alias <n>]`      | Add a project path to the current or named workspace    |
| `vws remove <path\|alias>`          | Remove a project from a workspace                       |
| `vws list`                          | List all workspaces and their member paths              |
| `vws open [<name>] [--with <tool>]` | Create the virtual root and optionally launch a tool    |
| `vws close`                         | Destroy the active virtual root and end the session     |
| `vws status`                        | Show the active session's virtual root path and members |
| `vws import <.vworkspace.json>`     | Import a workspace config from a file                   |
| `vws export <name>`                 | Export a workspace config to `.vworkspace.json`         |

### 4.2 Usage Examples

```bash
# Set up a workspace once
vws init acme-fullstack
vws add ~/work/api-service
vws add ~/clients/acme/frontend --alias frontend
vws add ~/libs/shared-utils

# Open it — VWS prints the temp path and opens Cursor
vws open acme-fullstack --with cursor

# Or pipe the path to a CLI AI agent
claude --context $(vws open acme-fullstack --print-path)

# Check what's live
vws status
# → Session: a3f9b2 | Root: /tmp/vws-a3f9b2 | Members: 3

# Tear it down
vws close
```

### 4.3 `--with` Flag

The `--with` flag accepts a tool name and launches it against the virtual root path. VWS ships with launch adapters for the following tools out of the box. Additional adapters can be registered in `~/.vws/adapters.json`.

| Tool Name  | Launch Command                                   |
| ---------- | ------------------------------------------------ |
| `cursor`   | `cursor <path>`                                  |
| `code`     | `code <path>`                                    |
| `windsurf` | `windsurf <path>`                                |
| `claude`   | `claude --context <path>`                        |
| `zed`      | `zed <path>`                                     |
| `custom`   | User-defined command template in `adapters.json` |

---

## 5. VSCode Extension

The extension is a companion to the CLI. It is compatible with any VSCode fork (Cursor, Windsurf, VSCodium, etc.) since it relies only on the stable vscode API surface. It does not call out to any external service; all state is managed locally via the same `~/.vws/` config store the CLI uses.

### 5.1 Extension Features

- **Sidebar panel:** Virtual Workspace tree view showing active session members and quick-add / remove actions.
- **Workspace picker:** Command palette entry `VWS: Open Workspace` to select and launch a saved workspace.
- **Auto-open:** On workspace open, the extension detects a `.vworkspace.json` at the project root and offers to activate it.
- **Lifecycle hooks:** The `deactivate()` callback closes the active session and removes the temp directory automatically.
- **Status bar item:** Shows `[VWS: acme-fullstack | 3 members]` in the status bar with a click-to-close affordance.

### 5.2 Extension Architecture

```text
src/
  extension.ts          ← activate() / deactivate()
  session/
    SessionManager.ts   ← create/destroy virtual roots; wraps CLI or native symlink API
    SessionState.ts     ← persisted state (active session UUID, temp path)
  workspace/
    WorkspaceRegistry.ts ← read/write ~/.vws/workspaces.json
    WorkspaceImporter.ts ← parse .vworkspace.json
  views/
    WorkspaceTreeView.ts ← sidebar tree data provider
    StatusBarItem.ts
  adapters/
    CliAdapter.ts       ← delegates to vws binary if installed
    NativeAdapter.ts    ← direct Node.js fs.symlink calls (no CLI required)
```

### 5.3 Activation Strategy

The extension registers two activation events: `onCommand:vws.openWorkspace` and `workspaceContains:.vworkspace.json`. This ensures it only loads when actually needed and does not contribute to editor startup time for unrelated projects.

---

## 6. .vworkspace.json Specification

A `.vworkspace.json` file can be committed to any project repository to make the workspace configuration reproducible and shareable. When present in the project root, both the CLI and extension will detect and offer to import it.

```json
{
  "$schema": "https://vws.dev/schema/vworkspace.json",
  "name": "acme-fullstack",
  "version": "1",
  "members": [
    {
      "path": "~/work/api-service",
      "alias": "api"
    },
    {
      "path": "~/clients/acme/frontend",
      "alias": "frontend"
    },
    {
      "path": "~/libs/shared-utils"
    }
  ],
  "options": {
    "autoOpen": false,
    "launchWith": "cursor",
    "excludePatterns": ["node_modules", ".git", "dist", "__pycache__"]
  }
}
```

| Field                     | Type       | Required     | Description                                         |
| ------------------------- | ---------- | ------------ | --------------------------------------------------- |
| `name`                    | `string`   | **Required** | Human-readable workspace identifier                 |
| `version`                 | `string`   | **Required** | Schema version (currently "1")                      |
| `members[].path`          | `string`   | **Required** | Absolute or `~` relative path to the project        |
| `members[].alias`         | `string`   | Optional     | Override the directory name in the virtual root     |
| `options.autoOpen`        | `boolean`  | Optional     | Auto-activate when the parent project is opened     |
| `options.launchWith`      | `string`   | Optional     | Tool adapter name to launch automatically           |
| `options.excludePatterns` | `string[]` | Optional     | Glob patterns excluded from symlink traversal hints |

---

## 7. Symlink Engine

The symlink engine is the lowest-level component. It is platform-aware and handles all filesystem interactions. It is exposed as a standalone module (`vws-engine`) that can be imported by both the CLI and the VSCode extension without a dependency on the other.

### 7.1 Platform Strategy

| Platform               | Method                                           | Notes                                        |
| ---------------------- | ------------------------------------------------ | -------------------------------------------- |
| **macOS / Linux**      | `fs.symlink(target, path, 'dir')`                | Requires no elevation. Works with all tools. |
| **Windows (modern)**   | `mklink /J junction target` (directory junction) | No elevation needed. Supported on NTFS.      |
| **Windows (fallback)** | `fs.symlink` with symlink privilege              | Requires Developer Mode or elevation.        |

### 7.2 Engine API

```typescript
// vws-engine — public API (TypeScript / Node.js)

interface SymlinkEngine {
  /** Create a virtual root and populate it with symlinks */
  create(members: Member[], options?: CreateOptions): Promise<VirtualRoot>;

  /** Destroy a virtual root (removes temp dir and all symlinks) */
  destroy(root: VirtualRoot): Promise<void>;

  /** Add a single member to an existing root */
  addMember(root: VirtualRoot, member: Member): Promise<void>;

  /** Remove a single member from an existing root */
  removeMember(root: VirtualRoot, alias: string): Promise<void>;
}

interface Member {
  path: string; // real absolute path
  alias?: string; // name to use in virtual root (defaults to basename)
}

interface VirtualRoot {
  id: string; // UUID
  path: string; // e.g. /tmp/vws-a3f9b2
  members: Member[];
  pid: number; // daemon PID
}
```

---

## 8. Session Daemon

VWS spawns a small daemon process at session start. The daemon's sole job is to watch the parent process (the shell or editor) and clean up the virtual root if it exits unexpectedly. This prevents orphaned temp directories accumulating on disk.

### 8.1 Daemon Behaviour

- The daemon is forked as a detached child process and writes its PID to `~/.vws/sessions/<uuid>.json`.
- It polls the parent PID every 5 seconds using `process.kill(parentPid, 0)` (signal 0 — no-op check).
- When the parent is gone, the daemon calls `engine.destroy()` on the recorded virtual root, then exits.
- `vws close` sends `SIGTERM` to the daemon and waits for confirmation before returning control.
- On startup, VWS scans `~/.vws/sessions/` for orphaned session files whose daemon PIDs are no longer alive and cleans them immediately.

**NOTE:** The daemon adds negligible resource overhead: one Node.js process sleeping 5 s between polls, consuming ~15 MB of RAM. An alternative implementation in Go produces a ~3 MB binary with sub-millisecond poll overhead.

---

## 9. Technology Stack

| Component            | Technology                       | Notes                                                                                                   |
| -------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------- |
| **CLI Core (`vws`)** | TypeScript / Node.js 20 LTS      | Ships as a compiled bundle via pkg or esbuild. Single binary with no runtime requirement for end users. |
| **CLI (Go alt)**     | Go 1.22                          | Alternative for users who prefer a Go-native binary. ~5 MB, zero dependencies.                          |
| **VSCode Extension** | TypeScript + vscode API          | Built with esbuild. Targets VS Code engine `^1.85`. Imports `vws-engine` as a bundled local module.     |
| **vws-engine**       | TypeScript (Node.js)             | Shared symlink/session module. Published as a private npm package consumed by both CLI and extension.   |
| **Config format**    | JSON with JSON Schema            | `workspaces.json` and `.vworkspace.json`. Schema published for editor autocomplete.                     |
| **Daemon**           | Node.js subprocess / Go binary   | Detached process. Communicates via JSON files in `~/.vws/sessions/`, no IPC socket needed.              |
| **Tests**            | Vitest (unit) + Playwright (e2e) | E2E tests spin up a real temp directory, verify symlinks, and run `vws` CLI commands against it.        |

---

## 10. Security Considerations

Because VWS creates symlinks in a world-readable temp directory, there are a small number of security considerations a developer should understand before shipping.

- **Temp directory permissions:** VWS creates the virtual root with mode `0700` (owner-only read/write/execute on POSIX). Other users on the machine cannot traverse the directory.
- **Symlink traversal:** Tools that follow symlinks will access the real project files. Their permissions remain unchanged. VWS does not escalate access to anything the user could not already reach.
- **Path validation:** All member paths are normalised and resolved to absolute paths before any symlink is created. Relative paths, symlink chains in the source path, and paths outside the user's home directory emit a confirmation prompt.
- **AI context boundary:** Only the paths the developer explicitly registers are included in the virtual root. The AI tool cannot escape the virtual root to access the broader filesystem through VWS.
- **Windows junctions:** Directory junctions on NTFS are not subject to the same reparse-point following restrictions as symlinks, but they respect NTFS ACLs on the target directory.

---

## 11. Implementation Roadmap

| Phase       | Name                   | Deliverables                                                                                                     | Est.      |
| ----------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------- | --------- |
| **Phase 1** | MVP CLI                | `vws init`, `add`, `open`, `close`. POSIX symlinks only. No daemon — cleanup on SIGINT/SIGTERM via `process.on`. | 2 weeks   |
| **Phase 2** | Daemon + Windows       | Session daemon for robust cleanup. Windows junction support. `vws status` and `vws list`.                        | 1.5 weeks |
| **Phase 3** | Config file            | `.vworkspace.json` spec and parser. `vws import` / `export`. JSON Schema publication.                            | 1 week    |
| **Phase 4** | VSCode Extension Alpha | Sidebar tree view, workspace picker, deactivate cleanup. Relies on CLI binary being installed.                   | 2 weeks   |
| **Phase 5** | Extension Native Mode  | Bundle `vws-engine` into the extension so the CLI is not required. Publish to VS Code marketplace.               | 1.5 weeks |
| **Phase 6** | Adapters & Polish      | `--with` flag adapter registry, custom adapter support, telemetry opt-in, docs site.                             | 1 week    |

---

## 12. Testing Strategy

VWS is fundamentally a filesystem tool. Tests must verify real filesystem behaviour, not just logic in memory.

### 12.1 Unit Tests — vws-engine

Unit tests use tmp-dir fixtures and real symlink calls. They do not mock `fs`. Each test creates a fresh temp directory, calls `engine.create()`, asserts symlink targets using `fs.readlink()`, then calls `engine.destroy()` and asserts the directory is gone.

### 12.2 Integration Tests — CLI

Integration tests shell out to the `vws` binary and inspect stdout, exit codes, and the filesystem. They cover the full command surface: `init`, `add`, `remove`, `open`, `close`, `status`, `import`, `export`. A matrix of Node.js versions (18, 20, 22) and operating systems (`ubuntu-latest`, `macos-latest`, `windows-latest`) is run in CI.

### 12.3 Extension Tests

The VSCode extension is tested with `@vscode/test-electron`. Tests exercise the command palette entry, the tree view data provider, and the deactivate cleanup path by loading a real extension host.

---

## 13. Distribution

| Channel                | Install Command       | Notes                                                           |
| ---------------------- | --------------------- | --------------------------------------------------------------- |
| **npm**                | `npm install -g vws`  | macOS, Linux, Windows. Requires Node.js 18+.                    |
| **Homebrew**           | `brew install vws`    | macOS and Linux. Pre-built binary, no Node.js required.         |
| **Direct binary**      | GitHub Releases page  | Compiled Go or pkg-bundled Node.js binary. No runtime required. |
| **VSCode Marketplace** | `ext install vws.vws` | Extension only. CLI installation prompted on first use.         |
| **Winget**             | `winget install vws`  | Windows Package Manager. MSI wrapping the Go binary.            |

---

## Appendix A: workspaces.json Schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema",
  "type": "object",
  "properties": {
    "workspaces": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["name", "members"],
        "properties": {
          "name": { "type": "string" },
          "members": {
            "type": "array",
            "items": {
              "type": "object",
              "required": ["path"],
              "properties": {
                "path": { "type": "string" },
                "alias": { "type": "string" }
              }
            }
          },
          "options": {
            "type": "object",
            "properties": {
              "launchWith": { "type": "string" },
              "autoOpen": { "type": "boolean" },
              "excludePatterns": {
                "type": "array",
                "items": { "type": "string" }
              }
            }
          }
        }
      }
    }
  }
}
```

## Appendix B: Glossary

| Term             | Definition                                                                             |
| ---------------- | -------------------------------------------------------------------------------------- |
| **Virtual Root** | The ephemeral temporary directory created by VWS that contains all member symlinks     |
| **Member**       | A real project path registered in a workspace configuration                            |
| **Alias**        | An optional override name used as the symlink entry name in the virtual root           |
| **Session**      | A single invocation of `vws open` through to `vws close`                               |
| **Daemon**       | The lightweight background process that monitors session health and cleans up on exit  |
| **Junction**     | A Windows NTFS directory junction, the Windows equivalent of a POSIX directory symlink |
| **vws-engine**   | The shared TypeScript module containing all symlink and session logic                  |
