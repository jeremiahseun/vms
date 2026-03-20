# VWS — Virtual Workspace for VS Code

**Unified ephemeral project views for AI coding tools and IDEs.**

VWS lets you view multiple unrelated projects as a single workspace by creating a temporary directory with symlinks. Your AI tools (Claude, Cursor, Copilot, Antigravity) see all projects under one root — without copying or moving files.

## Features

### 📁 Sidebar Tree View
See all members of your active virtual workspace at a glance. Click any member to reveal it in Finder/Explorer.

### ⚡ Workspace Quick Picker
Open the Command Palette and run **VWS: Open Workspace** to select from your saved workspace configurations.

### 🔍 Auto-Detection
When you open a project containing a `.vworkspace.json` file, VWS will prompt you to import and activate it.

### 📊 Status Bar
The active session is shown in the status bar as `VWS: <name> | N members`. Click it to close the session.

### 🧹 Automatic Cleanup
When the editor closes, VWS automatically destroys the virtual root. No orphaned temp directories.

## Commands

| Command | Description |
|---------|-------------|
| `VWS: Open Workspace` | Select and open a saved workspace |
| `VWS: Close Active Session` | Destroy the virtual root and end the session |
| `VWS: Add Folder to Workspace` | Add project folders to a workspace |
| `VWS: Remove Folder from Workspace` | Remove a member from the active session |
| `VWS: Delete Workspace` | Permanently delete a workspace configuration |
| `VWS: Refresh Workspace Tree` | Refresh the sidebar tree view |

## How It Works

1. **Create a workspace** — use the command palette or the companion CLI (`npm install -g vws`)
2. **Add projects** — select folders to include in your virtual workspace
3. **Open** — VWS creates a temp directory at `/tmp/vws-<name>/` with symlinks to each project
4. **Work** — open the virtual root in any tool. All reads and writes pass through to real files.
5. **Close** — the temp directory is removed. Your real files are untouched.

## Companion CLI

The extension works standalone, but you can also install the CLI for terminal workflows:

```bash
npm install -g vws
vws init my-project
vws add ~/repos/api
vws add ~/repos/frontend
vws open my-project --with cursor
```

## Requirements

- VS Code 1.85+ (or compatible fork: Cursor, Windsurf, VSCodium)
- macOS, Linux, or Windows (NTFS)

## License

MIT
