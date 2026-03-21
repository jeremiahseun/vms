# VWS — Virtual Workspace Aggregator

**Unified ephemeral project views for AI coding tools and IDEs.**

VWS is a lightweight tool that creates a temporary, unified directory view of multiple unrelated projects on your local machine. Both you and your AI tools (like Claude, Cursor, Copilot, Antigravity) see those projects as if they live in one folder.

Nothing is moved or copied; VWS operates entirely via symbolic links (or directory junctions on Windows), making the virtual workspace zero-cost and always in sync with your real files.

## Why VWS?

AI tools perform best when they have a single coherent project root to analyze. Cross-repo awareness is difficult when projects are opened in separate windows. VS Code multi-root workspaces are close, but CLI agents, language servers, and test runners need a real path on disk. VWS provides exactly that without the overhead of moving files around.

## Ecosystem

VWS consists of:
- **CLI Tool (`vws`)**: Create and manage virtual workspaces from your terminal, and launch connected tools.
- **VS Code Extension**: Fully integrated sidebar, workspace picker, and auto-detection, running without needing the CLI.

---

## Installation

### CLI

Install globally via npm:
```bash
npm install -g vws
```

### VS Code Extension

Download the `.vsix` file from the [Releases](https://github.com/vws/vws/releases) page and install it in VS Code:
```bash
code --install-extension vws-vscode-1.0.0.vsix
```

---

## CLI Usage

### 1. Initialize a Workspace
```bash
vws init acme-fullstack
```

### 2. Add Projects
Add folders to your workspace. They will be linked using their folder name by default, but you can provide a custom `--alias`.
```bash
vws add ~/work/api-service
vws add ~/clients/acme/frontend --alias frontend
vws add ~/libs/shared-utils
```

### 3. Open the Workspace
VWS will generate a temporary virtual root (e.g. `/tmp/vws-a3f9b2`) linking all your projects.

You can also launch an IDE or AI agent directly against it:
```bash
vws open acme-fullstack --with cursor
vws open acme-fullstack --with code
vws open acme-fullstack --with windsurf
vws open acme-fullstack --with antigravity
```

You can also give the virtual root a custom name:
```bash
vws open acme-fullstack --name acme
# Creates /tmp/vws-acme/ instead of /tmp/vws-<uuid>/
```

If you use a CLI AI agent, use the `--print-path` flag to pass the directory automatically:
```bash
claude --context $(vws open acme-fullstack --print-path)
```

### 4. Close the Workspace
A background daemon watches your editor or shell. If they exit, the virtual root is cleaned up automatically. You can also explicitly close it:
```bash
vws close
```

### Other Commands
- `vws list`: View all configured workspaces and their members.
- `vws status`: View the currently active session path.
- `vws remove <alias>`: Remove a member from the workspace.

---

## Shareable Configurations (`.vworkspace.json`)

If you want to share a workspace setup with your team, commit a `.vworkspace.json` file to your project root.

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
      "path": "~/clients/acme/frontend"
    }
  ],
  "options": {
    "launchWith": "cursor"
  }
}
```

- **CLI**: Run `vws import .vworkspace.json`
- **VS Code**: The extension will auto-detect the file when you open the root project and prompt you to import and activate it.

---

## Technical Details

- **Ephemeral**: The virtual root lives in your system temp directory (`/tmp/vws-...`).
- **Zero-cost operations**: Uses native `fs.symlink` (macOS/Linux) or `mklink /J` (Windows NTFS Junctions). No file copying occurs.
- **Daemon Cleanup**: A tiny background process polls the parent PID. If your terminal dies, the daemon safely deletes the virtual root.
- **Security**: Symlinks are created safely and do not elevate permissions. The daemon only deletes the symlinks, never following them into your real source code.

---

## Author
Built by Jeremiah Israel (2026).

## License
MIT — see [LICENSE](./LICENSE) for details.
