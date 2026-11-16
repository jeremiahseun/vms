# VWS — Virtual Workspaces

**Open many repos as one.** VWS joins project folders that live anywhere on your disk — different
repos, different branches, different services — into a single folder. Open that folder in any IDE
or point any coding agent (Claude Code, Codex, Gemini CLI, Cursor, …) at it, and it behaves like
one monorepo. Nothing is copied or moved: every project is a link, so edits land in the real repo.

```
~/vws/acme/                      ← open this in your IDE / agent
├── AGENTS.md  CLAUDE.md         ← generated map + rules for coding agents
├── api   →  ~/work/api          (main)
├── web   →  ~/clients/acme/web  (feature/login)
└── infra →  ~/ops/infra         (main)
```

- **Temporary by default.** Every new workspace lives **72 hours**. Keep it with one command, or
  extend it. When time runs out only the folder goes away: the workspace stays **restorable for
  30 days** (`vws restore acme`).
- **Any branch, side by side.** `vws add acme ~/work/api@feature/login` checks out another branch
  of the same repo as its own folder (a git worktree), next to `main`.
- **Always visible.** Time left shows in `vws ls`, your shell prompt, the VS Code status bar, and
  in the `AGENTS.md` agents read. You get a warning (and a desktop notification, if scheduled)
  before anything is removed.
- **Safe.** Deleting, deactivating or expiring only removes the links. VWS never deletes anything
  inside your projects. Files someone created at the workspace root go to `~/.vws/trash`.
- **Fast and light.** One ~36 KB file, no dependencies, ~70 ms per command, no daemon running in the
  background.

## Install (macOS / Linux)

Needs `git` and Node.js 20+ (`brew install node`).

```bash
curl -fsSL https://raw.githubusercontent.com/jeremiahseun/vms/main/install.sh | bash
```

This clones VWS into `~/.vws/src`, builds it, puts `vws` on your PATH, and installs the editor
extension into **VS Code and Cursor** (whichever you have). Update any time with `vws update`.

From a clone instead: `./install.sh` (set `VWS_BRANCH=<branch>` to install a branch).

## 60-second tour

```bash
vws new acme ~/work/api ~/clients/acme/web ~/ops/infra   # temporary, 72h
vws open acme --with code        # or cursor, windsurf, zed, idea, claude, codex, gemini…
cd "$(vws path acme)"            # or just cd ~/vws/acme

vws ls                           # all workspaces + time left
vws keep acme                    # make permanent
vws extend acme 24h              # or add time
vws delete acme                  # remove it (projects untouched)
```

```bash
vws add acme ~/work/api@feature/login   # same repo, another branch, its own folder: api@feature-login
vws worktrees                           # branch checkouts vws made, clean or with uncommitted work
vws restore acme                        # bring back a workspace that expired (within 30 days)
```

Inside a workspace folder (or any project in it) you can drop the name: `vws keep`, `vws info`,
`vws add ../lib`.

## Commands

| Command | What it does |
| --- | --- |
| `vws new <name> <folder...> [--ttl 72h] [--keep] [--as a,b] [--with tool]` | Create a workspace. Temporary unless `--keep`. |
| `vws open [name] [--with tool] [-- args]` | Open in an IDE/agent. Without `--with`, prints the path. Reactivates if off. |
| `vws path [name]` | Print the folder path (for scripts and `cd`). |
| `vws add [name] <folder...> [--as alias]` | Add projects. `<repo>@<branch>` (or `--branch`) adds another branch as a worktree. |
| `vws rm [name] <alias\|folder>` | Remove a project from the workspace (never deletes it). |
| `vws ls` / `vws info [name]` | List / details: projects, git branches, broken links, expiry. |
| `vws keep [name]` | Make permanent. |
| `vws temp [name] [--ttl 72h]` | Make temporary again. |
| `vws extend [name] [72h]` | Add time. |
| `vws off [name]` / `vws on [name]` | Deactivate (remove the folder, keep the definition) / bring it back. |
| `vws delete [name] [-y]` | Delete the workspace (also works on expired ones). |
| `vws restore <name> [--keep]` | Bring back an expired workspace with a fresh lifetime (or permanent). |
| `vws worktrees [--prune]` | List branch checkouts made by vws; `--prune` removes unused clean ones. |
| `vws sync [name] [--all]` | Repair links; refresh branches and agent files. |
| `vws gc [--notify]` | Expire / clean up now. |
| `vws prompt` | Short status for your shell prompt. |
| `vws schedule install` | Hourly cleanup + "expiring soon" desktop notifications (cron / Task Scheduler). |
| `vws export [name] [file]` / `vws import <file>` | Share a setup as `.vworkspace.json` (`~` paths kept portable). |
| `vws config [set <key> <value>]` | `root` (default `~/vws`), `ttl` (default `72h`), `keepExpired` (default `30d`). |
| `vws update` | Pull the latest version from GitHub, rebuild, reinstall the extension. |

## Branches of the same repo (git worktrees)

`vws add acme ~/work/api@feature/login` gives you `~/vws/acme/api@feature-login/`, a full checkout
of `feature/login` living next to `api/` (your normal checkout). Under the hood it's a
[git worktree](https://git-scm.com/docs/git-worktree) stored in `~/.vws/worktrees/`:

- The branch can be local, remote-only (a tracking branch is created), or new (created from the
  repo's current branch).
- If that branch is already checked out somewhere (including your main checkout), vws links to that
  checkout instead of making a new one.
- Commits made in a worktree go straight into the repo, on that branch.
- **Your work is never deleted:** a worktree vws created is removed only when no workspace uses it
  any more **and** it has no uncommitted or untracked changes. Otherwise it stays and `vws
  worktrees` shows it. Branches are never deleted. Worktrees also survive expiry, so `vws restore`
  brings everything back as it was.

## Lifetime: temporary → expired → gone

| Stage | What exists | How to change it |
| --- | --- | --- |
| Temporary (72h default) | Folder + definition | `vws keep`, `vws extend 24h` |
| Expired | Definition only (folder removed; worktrees kept) for 30 days | `vws restore`, or `vws open` / `vws keep` restore it |
| Purged | Nothing (clean worktrees removed; dirty ones kept) | — |

Permanent workspaces skip all of this until you `vws delete` them.

## How agents and IDEs get the "monorepo" experience

Every workspace contains generated files (VWS stops updating any file you edit):

| File | For | Why |
| --- | --- | --- |
| `AGENTS.md` | Codex, Gemini, Cursor, Copilot, Aider… | Map of projects, real paths, branches, lifetime, and rules: run git *inside* each project, search with `rg --follow`, respect each project's own `AGENTS.md`. |
| `CLAUDE.md` | Claude Code | Imports `AGENTS.md`. |
| `.claude/settings.json` | Claude Code | `additionalDirectories` = the real project paths, so edits through links don't trigger permission prompts. |
| `.vscode/settings.json` | VS Code & forks | Search follows links; git scans every project. |
| `<name>.code-workspace` | VS Code & forks | Optional multi-root view (`vws open acme --with code-multi`): one root per repo for the best git/language-server behaviour. |

Launchers pass extra access where the tool supports it: `claude --add-dir <each project>`,
`codex --add-dir <each project>`, `gemini --include-directories <projects>`. Add your own tools in
`~/.vws/config.json`:

```json
{ "tools": { "aider": { "command": "aider", "args": ["--no-auto-commits"] },
             "mytool": { "command": "mytool", "args": ["{root}"], "perMember": ["--dir", "{path}"], "gui": true } } }
```

## Knowing how much time is left

- `vws ls` / `vws info` show it; every other command warns when a workspace has < 12 h left.
- **Shell prompt** — add one line:
  - bash: `PS1='$(vws prompt 2>/dev/null) '"$PS1"`
  - zsh: `setopt PROMPT_SUBST; PROMPT='$(vws prompt 2>/dev/null) '$PROMPT`
  - starship: a `[custom.vws]` block with `command = "vws prompt"` and `when = "vws prompt"`.
- **VS Code / Cursor** — the installer adds the extension: status bar countdown that turns yellow
  below 12 h, one-click *Keep* / *Extend*, a *Virtual Workspaces* sidebar (with expired workspaces
  you can restore), *Add Another Branch of a Repo…*, and right-click → *Add Folder to VWS Workspace…*
  in the Explorer.
- **Desktop notifications** — `vws schedule install` (hourly; also removes expired workspaces
  while you're not using vws).

On macOS, `vws open --with cursor` / `--with code` works even if you never installed the editor's
shell command (it falls back to `open -a Cursor`).

Without a schedule, expiry happens the next time `vws` or the extension runs — there is no
background process.

## Where things live

| Path | Contents |
| --- | --- |
| `~/vws/<name>/` | Workspace folders (change with `vws config set root <dir>` or `VWS_ROOT`). |
| `~/.vws/state.json` | Workspace definitions (change with `VWS_HOME`). |
| `~/.vws/worktrees/` | Branch checkouts (git worktrees) made by vws. |
| `~/.vws/src/` | The installed copy of this repo (used by `vws update`). |
| `~/.vws/trash/` | Root-level files that were in a workspace when it was removed. |
| `~/.vws/vws.log` | Activity log. |

## Develop

```bash
npm install
npm test           # vitest: engine + CLI end-to-end against real folders and links
npm run typecheck
npm run build      # packages/cli/dist/vws.js and packages/vscode/dist/extension.js
```

`packages/core` — engine (no dependencies) · `packages/cli` — `vws` · `packages/vscode` — extension.

Built and tested for macOS and Linux. Windows uses directory junctions and should work, but it is
not covered by CI and the installer is bash-only.

## License

MIT — built by Jeremiah Israel.
