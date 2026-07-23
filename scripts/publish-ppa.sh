#!/usr/bin/env bash
# One-shot PPA publisher for Flint. Signs and uploads the prebuilt source
# packages to ppa:dhiva-labs/apps. You will be prompted ONCE for your GPG
# passphrase by pinentry (the GPG agent caches it for the rest of the run);
# the passphrase never passes through this script.
#
# Prereq: scripts/build-ppa.sh standard  (and optionally  ... plus)
# Usage:  scripts/publish-ppa.sh            # both editions if present
#         scripts/publish-ppa.sh standard   # just one
set -euo pipefail

KEY="32CC792311A6EF76"
PPA="ppa:dhiva-labs/apps"
BUILD="$(cd "$(dirname "$0")/.." && pwd)/packaging/ppa/build"

editions=("${@:-standard plus}")
# shellcheck disable=SC2206
editions=(${editions[@]})

publish() {
  local pkg="$1"
  local changes="$BUILD/${pkg}_1.0.0_source.changes"
  if [ ! -f "$changes" ]; then
    echo "skip: $pkg  (no source package — run scripts/build-ppa.sh ${pkg#flint-browser-} first)"
    return
  fi
  echo "==> Signing $pkg (enter your GPG passphrase if prompted)…"
  debsign -k "$KEY" "$changes"
  echo "==> Uploading $pkg to $PPA…"
  dput "$PPA" "$changes"
  echo "==> $pkg submitted. Launchpad will email you the build result."
  echo
}

for e in "${editions[@]}"; do
  case "$e" in
    standard) publish flint-browser ;;
    plus)     publish flint-browser-plus ;;
    *) echo "unknown edition: $e" ;;
  esac
done

echo "Done. Once Launchpad finishes building, install with:"
echo "  sudo add-apt-repository $PPA && sudo apt update && sudo apt install flint-browser"
