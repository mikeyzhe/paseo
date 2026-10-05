#!/usr/bin/env bash
# Build a reproducible mypaseo daemon release from a git tag.
#
# Reproduces the 2026-10-05 00:04 hand-built install at
# ~/.local/share/paseo-daemon/0.11.0-beta.4-mypaseo: builds the workspace
# packages, `npm pack`s the seven @getpaseo tarballs the daemon needs, writes
# tarballs/ + SHA256SUMS + provenance markers into a NEW versioned install
# dir, and installs its node_modules from the local tarballs. Refuses to
# overwrite an existing dir; never touches `current` or any other install.
#
# Usage (from the fork checkout of the tag):
#   scripts/release-mypaseo.sh <tag> [install-dir-name]
#   scripts/release-mypaseo.sh mypaseo-0.11.0-beta.4.1 0.11.0-beta.4-mypaseo.1
#
# install-dir-name defaults to the tag with the leading "mypaseo-" moved to
# a "-mypaseo" suffix before the final component (mypaseo-0.11.0-beta.4.1 →
# 0.11.0-beta.4-mypaseo.1).
set -euo pipefail

die() { echo "release-mypaseo: $*" >&2; exit 1; }

TAG="${1:-}"
[ -n "$TAG" ] || die "usage: $0 <tag> [install-dir-name]"
REPO_ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$REPO_ROOT"

DAEMON_ROOT="${PASEO_DAEMON_ROOT:-$HOME/.local/share/paseo-daemon}"
default_dir() {
  local base=${TAG#mypaseo-}
  local stem=${base%.*}
  local suffix=${base##*.}
  [ "$stem" = "$base" ] && echo "$base-mypaseo" || echo "$stem-mypaseo.$suffix"
}
DIR_NAME="${2:-$(default_dir)}"
TARGET="$DAEMON_ROOT/$DIR_NAME"

command -v npm >/dev/null 2>&1 || die "npm not on PATH"
GIT_SHA=$(git rev-parse HEAD)
GIT_TAG_SHA=$(git rev-parse -q --verify "refs/tags/$TAG^{commit}") || die "tag $TAG not found"
[ "$GIT_SHA" = "$GIT_TAG_SHA" ] || die "HEAD $GIT_SHA is not $TAG ($GIT_TAG_SHA); check out the tag first"
[ -z "$(git status --porcelain --untracked-files=no)" ] || die "working tree has uncommitted changes"
[ ! -e "$TARGET" ] || die "refusing to overwrite existing $TARGET"

VERSION=$(node -p "require('./packages/server/package.json').version")
PACKAGES=(protocol client plugin highlight relay server cli)
STAGE=$(mktemp -d "${TMPDIR:-/tmp}/mypaseo-release-XXXXXX")
trap 'rm -rf "$STAGE"' EXIT
TARBALLS="$STAGE/tarballs"
mkdir -p "$TARBALLS"

echo "==> Building workspace packages at $TAG ($GIT_SHA)"
[ -d node_modules ] || npm ci --no-audit --no-fund
npm run build:server

echo "==> Packing ${PACKAGES[*]}"
for name in "${PACKAGES[@]}"; do
  (cd "packages/$name" && npm pack --json --pack-destination "$TARBALLS" >/dev/null)
done

echo "==> Assembling $TARGET"
mkdir -p "$TARGET/tarballs"
cp "$TARBALLS"/* "$TARGET/tarballs/"
sha256() {
  if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$@"; else sha256sum "$@"; fi
}
(
  cd "$TARGET/tarballs"
  for f in getpaseo-*.tgz; do [ -f "$f" ] || die "no tarballs packed"; done
  sha256 getpaseo-*.tgz > ../SHA256SUMS
)
tgz() { echo "file:./tarballs/getpaseo-$1-$VERSION.tgz"; }
cat > "$TARGET/package.json" <<EOF
{
  "name": "mypaseo-daemon-release",
  "private": true,
  "dependencies": {
    "@getpaseo/cli": "$(tgz cli)",
    "@getpaseo/server": "$(tgz server)"
  },
  "overrides": {
    "@getpaseo/cli": "$(tgz cli)",
    "@getpaseo/server": "$(tgz server)",
    "@getpaseo/protocol": "$(tgz protocol)",
    "@getpaseo/client": "$(tgz client)",
    "@getpaseo/plugin": "$(tgz plugin)",
    "@getpaseo/highlight": "$(tgz highlight)",
    "@getpaseo/relay": "$(tgz relay)"
  }
}
EOF
date -u +%Y-%m-%dT%H:%M:%SZ > "$TARGET/MYPASEO_BUILT_UTC"
echo "$GIT_SHA" > "$TARGET/MYPASEO_SHA"

echo "==> Installing node_modules from local tarballs"
(cd "$TARGET" && npm install --no-audit --no-fund)

echo
echo "Release installed at $TARGET (tag $TAG, sha $GIT_SHA)"
cat "$TARGET/SHA256SUMS"
