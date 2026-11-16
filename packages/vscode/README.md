# VWS for VS Code, Cursor, Windsurf and other VS Code forks

Companion to the `vws` CLI (both share `~/.vws`, so either one works on its own).

- **Status bar**: when the open folder is a VWS workspace, shows `🕒 acme · 2d 5h left` (or 📌 for permanent).
  It turns yellow when less than 12 h remain. Click it to keep, extend, add/remove projects or delete.
- **Expiry warning**: a notification with _Keep permanently_ / _Extend 72h_ buttons before a temporary workspace is removed.
- **Sidebar** (_Virtual Workspaces_): every workspace, its time left, its projects and their git branches.
- **Explorer → right-click a folder → Add Folder to VWS Workspace…**
- **VWS: Create Workspace from Folders…**: pick folders, name it, choose a lifetime, open.
