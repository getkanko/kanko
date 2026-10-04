#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

for tool in node code; do
  command -v "$tool" >/dev/null || { echo "error: $tool is not on PATH" >&2; exit 1; }
done

node_major="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$node_major" -lt 22 ]; then
  echo "error: Node.js 22 or newer is required (found $(node --version))" >&2
  exit 1
fi

vsix="$root/editor-extension/$(node -p "const p = require(process.argv[1]); p.name + '-' + p.version + '.vsix'" "$root/editor-extension/package.json")"

# Build from this checkout every time, including local styles and scripts.
# An existing same-version VSIX may have been packaged before the latest edits.
echo "building the extension..."
bash "$root/scripts/build-vsix.sh"

echo "installing the VS Code extension..."
code --install-extension "$vsix" --force

cat <<EOF

Extension installed. Reload the VS Code window so it activates:
  Command Palette -> "Developer: Reload Window"

Then install the plugin for your agent:
  Claude Code:  /plugin marketplace add $root
                /plugin install kanko@kanko
  Codex CLI:    codex plugin marketplace add $root
                codex plugin add kanko@kanko
                # Start a new thread after installation.
EOF
