#!/usr/bin/env bash
#
# Rebrand the project for a fork by replacing the upstream GitHub owner,
# GitHub repo name and Docker Hub image across every file that hard-codes
# them. CI, the Next.js About page and docker-compose can already be
# parameterized at runtime (GitHub repository variable DOCKERHUB_IMAGE,
# NEXT_PUBLIC_GITHUB_OWNER / NEXT_PUBLIC_GITHUB_REPO, env var
# UMLAUTADAPTARREX_IMAGE); this script bakes new defaults so the README,
# the Unraid template and the in-tree fallbacks all match the fork.
#
# The three values are independent. The Docker Hub image is a separate
# variable because the Docker Hub namespace often differs from the GitHub
# owner (e.g. github:xpsony vs dockerhub:lexfi).
#
# Usage:
#   ./scripts/rebrand.sh <new-github-owner> <new-github-repo> <new-dockerhub-image>
#
# Example:
#   ./scripts/rebrand.sh johndoe MyFork johndoe/myfork
#
# Review changes afterwards with `git diff`.

set -euo pipefail

usage() {
  sed -n '3,21p' "$0" | sed 's/^# \{0,1\}//'
}

if [ $# -ne 3 ]; then
  usage
  exit 1
fi

NEW_OWNER="$1"
NEW_REPO="$2"
NEW_IMAGE="$3"

OLD_OWNER="xpsony"
OLD_REPO="UmlautAdaptarrEX"
OLD_IMAGE="lexfi/umlautadaptarrex"

# Work from the repo root regardless of where the script is invoked from.
cd "$(dirname "$0")/.."

FILES=(
  "README.md"
  "docker-compose.release.yml"
  ".github/workflows/release.yml"
  "src/app/(admin)/about/page.tsx"
)

# Order matters: replace the most specific patterns first so the broad
# `${OLD_OWNER}` sweep at the end cannot partially match an image name or
# an owner/repo path.
for f in "${FILES[@]}"; do
  if [ ! -f "$f" ]; then
    echo "skip (missing): $f"
    continue
  fi
  sed -i.bak \
    -e "s|${OLD_IMAGE}|${NEW_IMAGE}|g" \
    -e "s|${OLD_OWNER}/${OLD_REPO}|${NEW_OWNER}/${NEW_REPO}|g" \
    -e "s|${OLD_OWNER}|${NEW_OWNER}|g" \
    "$f"
  rm "$f.bak"
  echo "updated: $f"
done

echo
echo "Done. Review changes with: git diff"
