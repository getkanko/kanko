#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"
fail() { echo "error: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null || fail "$1 is not on PATH"; }
validate_version() {
  local value="$1" core part id
  local ident='(0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)'
  [[ "$value" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-$ident(\.$ident)*)?$ ]] || fail 'Use a major.minor.patch version with an optional SemVer prerelease suffix'
  core="${value%%-*}"
  local parts
  IFS=. read -r -a parts <<< "$core"
  for part in "${parts[@]}"; do
    [ "${#part}" -le 16 ] && [ "$part" -le 9007199254740991 ] || fail 'Version component exceeds the safe integer range'
  done
}
is_candidate() { [[ "$1" == *-* ]]; }
# Succeeds when $1 has strictly higher SemVer precedence than $2.
version_greater() {
  local a="$1" b="$2" core_a core_b pre_a pre_b i x y
  core_a="${a%%-*}"; core_b="${b%%-*}"
  pre_a=""; pre_b=""
  is_candidate "$a" && pre_a="${a#*-}"
  is_candidate "$b" && pre_b="${b#*-}"
  local -a na nb ia ib
  IFS=. read -r -a na <<< "$core_a"
  IFS=. read -r -a nb <<< "$core_b"
  for i in 0 1 2; do
    (( na[i] > nb[i] )) && return 0
    (( na[i] < nb[i] )) && return 1
  done
  [ -z "$pre_a" ] && [ -z "$pre_b" ] && return 1
  [ -z "$pre_a" ] && return 0
  [ -z "$pre_b" ] && return 1
  IFS=. read -r -a ia <<< "$pre_a"
  IFS=. read -r -a ib <<< "$pre_b"
  for ((i = 0; i < ${#ia[@]} && i < ${#ib[@]}; i++)); do
    x="${ia[$i]}"; y="${ib[$i]}"
    [ "$x" = "$y" ] && continue
    if [[ "$x" =~ ^[0-9]+$ && "$y" =~ ^[0-9]+$ ]]; then (( x > y )) && return 0 || return 1; fi
    [[ "$x" =~ ^[0-9]+$ ]] && return 1
    [[ "$y" =~ ^[0-9]+$ ]] && return 0
    [[ "$x" > "$y" ]] && return 0 || return 1
  done
  (( ${#ia[@]} > ${#ib[@]} ))
}
next_version() {
  local current="$1" bump="$2" major minor patch
  validate_version "$current"
  IFS=. read -r major minor patch <<< "${current%%-*}"
  case "$bump" in
    major) bump="$((major + 1)).0.0" ;;
    minor) bump="$major.$((minor + 1)).0" ;;
    patch) bump="$major.$minor.$((patch + 1))" ;;
  esac
  validate_version "$bump"
  version_greater "$bump" "$current" || fail 'New version must be greater than the current version'
  printf '%s\n' "$bump"
}

main() {
  local command="${1:-}" version file index
  # Global because the EXIT trap runs after main returns on failure.
  staging=""
  case "$command" in
    show|sync) [ "$#" -eq 1 ] || fail "Usage: make version-$command" ;;
    check) [ "$#" -le 2 ] || fail 'Usage: make version-check [TAG=vX.Y.Z]' ;;
    bump) [ "$#" -eq 2 ] || fail 'Usage: make bump VERSION=patch|minor|major|X.Y.Z' ;;
    *) fail 'Usage: make version, version-check, version-sync, or bump VERSION=patch' ;;
  esac
  need jq
  # Reject embedded line endings before command substitution strips trailing LF.
  jq -e '.version | type == "string" and (contains("\n") | not) and (contains("\r") | not)' plugin.json >/dev/null || fail 'Invalid version in plugin.json'
  version="$(jq -r '.version' plugin.json)"
  validate_version "$version"
  if [ "$command" = show ]; then printf '%s\n' "$version"; return; fi
  local files=(
    plugin.json
    .codex-plugin/plugin.json
    .claude-plugin/plugin.json
    .claude-plugin/marketplace.json
    editor-extension/package.json
    editor-extension/package-lock.json
  )
  local filters=(
    '.version = $v'
    '.version = $v'
    '.version = $v'
    'if any(.plugins[]; .name == "kanko") then
       .metadata.version = $v | (.plugins[] | select(.name == "kanko")).version = $v
     else error("Marketplace is missing the kanko plugin") end'
    '.version = $v'
    '.version = $v | .packages[""].version = $v'
  )
  if [ "$command" = check ]; then
    for index in "${!files[@]}"; do
      file="${files[$index]}"
      jq -e --arg v "$version" ". == (${filters[$index]})" "$file" >/dev/null || fail "Release versions differ from plugin.json ($version): $file. Run make version-sync."
    done
    cmp -s LICENSE editor-extension/LICENSE || fail 'Packaged license differs from repository license'
    awk -v heading="## $version" '{sub(/\r$/, ""); if ($0 == heading) found=1} END {exit !found}' editor-extension/CHANGELOG.md || fail 'Add a changelog heading for the release version'
    if [ "$#" -eq 2 ]; then [ "$2" = "v$version" ] || fail 'Release tag must match the shared version'; fi
    printf 'Validated Kankō %s\n' "$version"
    return
  fi
  if [ "$command" = bump ]; then version="$(next_version "$version" "$2")"; fi
  need node
  [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 22 ] || fail 'Node.js 22 or newer is required'
  # Check build dependencies before modifying manifests.
  node -e 'for (const name of ["typescript", "prettier"]) require.resolve(name, {paths: ["./editor-extension"]})' || fail 'Run make setup first'
  staging="$(mktemp -d "${TMPDIR:-/tmp}/kanko-version.XXXXXX")"
  trap 'rm -rf "$staging"' EXIT
  if [ "$command" = bump ]; then
    # Stage the notes and all JSON before writing anything into the checkout.
    awk -v version="$version" '
      { line=$0; sub(/\r$/, "", line) }
      line == "## " version { duplicate=1 }
      line == "## Unreleased" { count++; in_notes=1; print "## " version; next }
      /^## / { in_notes=0 }
      in_notes && line ~ /[^[:space:]]/ { notes=1 }
      { print }
      END { if (count != 1 || !notes || duplicate) exit 1 }
    ' editor-extension/CHANGELOG.md > "$staging/changelog" || fail 'Add release notes under one ## Unreleased heading; the target version must not already exist'
  fi
  for index in "${!files[@]}"; do
    jq --arg v "$version" "${filters[$index]}" "${files[$index]}" > "$staging/$index"
  done
  for index in "${!files[@]}"; do
    file="${files[$index]}"
    # Preserve existing formatting when its JSON value has not changed.
    if ! jq -e --slurpfile updated "$staging/$index" '. == $updated[0]' "$file" >/dev/null; then
      cat "$staging/$index" > "$file"
    fi
  done
  if [ "$command" = bump ]; then cat "$staging/changelog" > editor-extension/CHANGELOG.md; fi
  node scripts/build-runtime.mjs --write
  printf 'Kankō %s: synchronized manifests and runtime. Review and commit the changes; release tag: v%s\n' "$version" "$version"
  rm -rf "$staging"
  trap - EXIT
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then main "$@"; fi
