# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-02-24

### Added
- **vws-engine**: Core symlink and session logic for cross-platform virtual workspaces.
  - Generates Native POSIX symlinks (`fs.symlink`).
  - Generates Windows Directory Junctions (`mklink /J`).
  - Validates folder existence prior to adding workspace members.
- **Session Daemon**: Background Node.js process to watch parent PIDs and guarantee cleanup.
- **CLI (`vws`)**:
  - Commands: `init`, `add`, `remove`, `list`, `open`, `close`, `status`, `import`, `export`.
  - Built-in IDE launch adapters for `cursor`, `code`, `windsurf`, `claude`, `zed`, and `antigravity`.
  - Supports exporting and importing `.vworkspace.json` config files.
- **VS Code Extension (`vws-vscode`)**:
  - Integrated Sidebar Tree View for managing the current virtual workspace.
  - Workspace Quick Picker for switching between `.vws` configs.
  - Auto-detection prompts for `.vworkspace.json` files in the current workspace.
  - Active Session Status Bar item.
  - Integrated Lifecycle Hooks to manage the `SessionManager` locally without requiring the CLI.
