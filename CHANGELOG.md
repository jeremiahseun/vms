# Changelog

## [2.0.0] - 2026-11-16

Complete rewrite.

### Fixed
- Workspaces disappeared seconds after `vws open`: the old daemon watched the PID of the `vws`
  process itself, which exits immediately.
- Random `/tmp/vws-<uuid>` paths that IDEs and agents could not reopen.
- Shell-string launching (`exec`) that broke on paths with spaces.

### Added
- Stable workspace folders at `~/vws/<name>`.
- 72 h lifetime for new workspaces; `keep`, `temp`, `extend`, `off`/`on`, `delete`.
- Expiry without a daemon (checked on every command), plus optional hourly schedule with desktop
  notifications; countdown in `vws ls`, shell prompt, VS Code status bar and `AGENTS.md`.
- Generated `AGENTS.md`, `CLAUDE.md`, `.claude/settings.json`, `.vscode/settings.json` and a
  `.code-workspace` so agents and IDEs understand the multi-repo layout.
- Agent launchers pass every project as an allowed directory (`--add-dir`, `--include-directories`).
- Safe teardown: only links and unmodified generated files are removed; anything else goes to
  `~/.vws/trash`.
- Git branch per project, link health checks and `vws sync` repair.
- Atomic, locked state shared by CLI and editor extension.
- Branches of the same repo side by side: `repo@branch` members backed by git worktrees, reused
  when the branch is already checked out, removed only when unused and clean (`vws worktrees`).
- Expired workspaces are archived and restorable for 30 days (`vws restore`, `keepExpired`).
- `install.sh` / `vws update`: install from GitHub with the VS Code + Cursor extension.
- macOS: GUI launchers fall back to `open -a <App>`; `cursor-multi` launcher.

### Removed
- The session daemon, `commander`, `chalk` and `uuid` dependencies.

## [1.0.0] - 2026-02-24

Initial release.
