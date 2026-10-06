#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"
fail() { echo "error: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null || fail "$1 is not on PATH"; }
[ "$#" -eq 0 ] || { [ "$#" -eq 1 ] && [ "$1" = --dry-run ]; } || fail 'Usage: make release or make release-check'
need node
need npm
need git
[ -z "$(git status --porcelain)" ] || fail 'Commit or remove working-tree changes before releasing'
version="$(bash "$root/scripts/version.sh" show)"
tag="v$version"
if [[ "$version" == *-* ]]; then branch=dev; kind=candidate; else branch=main; kind=stable; fi
[ "$(git branch --show-current)" = "$branch" ] || fail "Release $tag is a $kind release; cut it from $branch (switch to $branch after the version PR is merged)"
git fetch --no-tags origin "refs/heads/$branch:refs/remotes/origin/$branch"
[ "$(git rev-parse HEAD)" = "$(git rev-parse "refs/remotes/origin/$branch")" ] || fail "Update $branch with git pull --ff-only before releasing"
bash "$root/scripts/version.sh" check "$tag"
npm --prefix "$root/editor-extension" run runtime:check
if git show-ref --verify --quiet "refs/tags/$tag"; then
  fail "Local tag $tag already exists; do not reuse a release version"
fi
if git ls-remote --exit-code --tags origin "refs/tags/$tag" > /dev/null; then
  fail "Remote tag $tag already exists; do not reuse a release version"
else
  status=$?
  [ "$status" -eq 2 ] || fail 'Could not check remote release tags'
fi
if [ "${1:-}" = --dry-run ]; then
  printf 'Would create and push %s at %s; no tag created or pushed.\n' "$tag" "$(git rev-parse --short HEAD)"
else
  git tag -a "$tag" -m "Release Kankō $version"
  git push origin "refs/tags/$tag"
fi
