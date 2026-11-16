#!/usr/bin/env bash
# VWS installer / updater. Installs the `vws` CLI and the VS Code + Cursor extension from GitHub.
#
#   curl -fsSL https://raw.githubusercontent.com/jeremiahseun/vms/main/install.sh | bash
#
# Options (env vars): VWS_BRANCH (default main), VWS_SRC (default ~/.vws/src),
#                     VWS_BIN (where the `vws` command goes), VWS_NO_EXTENSION=1
set -euo pipefail

REPO_URL="${VWS_REPO:-https://github.com/jeremiahseun/vms.git}"
BRANCH="${VWS_BRANCH:-main}"
SRC="${VWS_SRC:-$HOME/.vws/src}"

say() { printf '\033[1;36m›\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m✖\033[0m %s\n' "$*" >&2; exit 1; }

command -v git >/dev/null || die "git is required."
command -v node >/dev/null || die "Node.js 20+ is required (https://nodejs.org or: brew install node)."
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 20 ] || die "Node.js 20+ is required (found $(node -v))."

# 1. Get or update the source.
if [ -d "$SRC/.git" ]; then
  say "Updating $SRC"
  git -C "$SRC" pull --ff-only --quiet
else
  say "Downloading VWS into $SRC"
  mkdir -p "$(dirname "$SRC")"
  git clone --quiet --depth 1 --branch "$BRANCH" "$REPO_URL" "$SRC"
fi

# 2. Build (no runtime dependencies; dev tools only).
say "Building"
LOG="$(mktemp)"
if ! (cd "$SRC" && npm ci --no-audit --no-fund && npm run build) >"$LOG" 2>&1; then
  cat "$LOG"; die "Build failed (log above)."
fi
rm -f "$LOG"

# 3. Put a `vws` command on PATH.
pick_bin() {
  [ -n "${VWS_BIN:-}" ] && { mkdir -p "$VWS_BIN"; echo "$VWS_BIN"; return; }
  for d in "$(npm prefix -g 2>/dev/null)/bin" /opt/homebrew/bin /usr/local/bin "$HOME/.local/bin"; do
    if [ -d "$d" ] && [ -w "$d" ]; then echo "$d"; return; fi
  done
  mkdir -p "$HOME/.local/bin" && echo "$HOME/.local/bin"
}
BIN="$(pick_bin)"
cat > "$BIN/vws" <<SHIM
#!/bin/sh
exec node "$SRC/packages/cli/dist/vws.js" "\$@"
SHIM
chmod +x "$BIN/vws"
say "Installed vws → $BIN/vws"
case ":$PATH:" in *":$BIN:"*) ;; *) printf '  Add to your shell profile: export PATH="%s:$PATH"\n' "$BIN" ;; esac

# 4. Editor extension for VS Code and Cursor (whichever are installed).
if [ "${VWS_NO_EXTENSION:-}" != "1" ]; then
  VSIX="$HOME/.vws/vws-vscode.vsix"
  editors=()
  for e in code cursor windsurf; do command -v "$e" >/dev/null && editors+=("$(command -v "$e")"); done
  for e in "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" \
           "/Applications/Cursor.app/Contents/Resources/app/bin/cursor"; do
    [ -x "$e" ] && editors+=("$e")
  done
  if [ "${#editors[@]}" -gt 0 ]; then
    say "Packaging editor extension"
    if (cd "$SRC/packages/vscode" && npx --yes @vscode/vsce@3 package --no-dependencies -o "$VSIX" >/dev/null 2>&1); then
      seen=""
      for e in "${editors[@]}"; do
        real="$(cd "$(dirname "$e")" && pwd -P)/$(basename "$e")"
        case "$seen" in *"|$real|"*) continue ;; esac
        seen="$seen|$real|"
        if "$e" --install-extension "$VSIX" --force >/dev/null 2>&1; then
          say "Extension installed in $(basename "$e")"
        else
          printf '  Could not install into %s; do it manually: Extensions → … → Install from VSIX → %s\n' "$e" "$VSIX"
        fi
      done
    else
      printf '  Extension packaging failed; the CLI works without it.\n'
    fi
  else
    printf '  No VS Code / Cursor found; skipped the editor extension.\n'
  fi
fi

say "Done. Try: vws new demo ~/path/to/repo-a ~/path/to/repo-b"
