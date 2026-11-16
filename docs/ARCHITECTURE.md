# VWS 2 architecture

## Goal

Make N project folders (separate repos, branches, services) look like one folder that IDEs and
coding agents can open, edit and reason about — with a lifetime the user controls.

## Model

```
~/.vws/state.json      single source of truth (atomic write + mkdir lock)
~/vws/<name>/          the workspace folder ("root"), regenerated from state at any time
   .vws.json           marker: owner workspace + sha256 of every generated file
   <alias> -> <real project path>   (symlink; junction on Windows)
   AGENTS.md, CLAUDE.md, .claude/settings.json, .vscode/settings.json, <name>.code-workspace
```

`Workspace = { name, root, members[{alias, path}], createdAt, expiresAt | null, active }`

- `expiresAt = null` → permanent. New workspaces get `now + ttl` (default 72h).
- `active = false` → folder removed from disk, definition kept (`vws on` rebuilds it).

## Invariants

1. **Never touch project contents.** Teardown only `unlink`s entries whose `lstat` says they are
   links, and deletes generated files whose hash still matches what VWS wrote. Anything else at the
   root is moved to `~/.vws/trash/<name>-<timestamp>`.
2. **Never take over a folder VWS didn't create** (non-empty and no marker → refuse).
3. **Idempotent materialize.** `materialize()` converges the folder to the definition: adds missing
   links, fixes wrong ones, removes stale links, refreshes generated files. Every mutation ends with
   it, and `vws sync` / `vws open` call it to self-heal.
4. **User edits win.** A generated file whose content no longer matches its recorded hash is never
   rewritten or deleted.

## Expiry without a daemon

`sweepExpired()` runs at the start of every CLI command and on every extension tick (1 min). It
reads state lock-free and only takes the lock when something actually expired, so the common path
costs one small JSON read. `vws schedule install` adds an hourly cron / Task Scheduler entry
running `vws gc --notify` for machines where vws isn't used for days, and sends a single desktop
notification per workspace when < 12h remain.

## Packages

| Package | Notes |
| --- | --- |
| `packages/core` | Engine. Synchronous `fs`, zero dependencies, consumed as TypeScript source and bundled into both front-ends. |
| `packages/cli` | `vws`. Hand-written arg parser, bundled + minified by esbuild into one file. |
| `packages/vscode` | Extension for VS Code and forks. Status bar countdown, sidebar, quick actions; watches `state.json` to reflect CLI changes instantly. |

## Why links (and not bind mounts / FUSE / copies)

Links need no privileges, cost nothing, work on every OS and filesystem, and keep each repo's git
metadata where it is. The trade-off — some tools don't traverse links by default — is handled by
the generated files (`rg --follow` guidance, `search.followSymlinks`, `git.scanRepositories`,
Claude `additionalDirectories`) and by launchers passing `--add-dir` for each real path.
