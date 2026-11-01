#!/usr/bin/env bash
# Installs a Flint Flatpak bundle the way a user would and runs it.
#
# usage: test-bundle.sh <bundle.flatpak> <app id> <executable>
#
# Runs on a plain Ubuntu runner with flatpak and Xvfb installed. The runtime
# and the Electron base app come from Flathub through the bundle's runtime
# repository, exactly as for `flatpak install --user ./<bundle>`. Then,
# inside the sandbox: every ELF file under /app/flint finds its libraries;
# the in-app smoke suite passes (it loads real pages, so the network
# permission is exercised); and a plain start stays up under Xvfb for 20
# seconds. Chromium's own sandbox stays on (zypak), unlike in the
# distribution containers, which run as root.
set -euo pipefail
[ $# -eq 3 ] || { echo "usage: $0 <bundle.flatpak> <app id> <executable>" >&2; exit 2; }
bundle="$(readlink -f "$1")"
app="$2"
exe="$3"

flatpak remote-add --user --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo
flatpak install --user -y --noninteractive "$bundle"
flatpak info --user "$app"

echo "::group::ldd of every ELF file under /app/flint, in the sandbox"
flatpak run --command=sh "$app" -c '
  set -eu
  n=0; missing=0
  for f in $(find /app/flint -type f); do
    [ "$(head -c 4 "$f" | od -An -tx1 | tr -d " \n")" = 7f454c46 ] || continue
    n=$((n + 1))
    if ldd "$f" 2>&1 | grep -q "not found"; then
      echo "missing libraries for $f:"; ldd "$f" | grep "not found"; missing=1
    fi
  done
  echo "$n ELF files checked with ldd"
  [ "$n" -gt 0 ] && [ "$missing" = 0 ]
'
echo "::endgroup::"

out="$HOME/flint-smoke"
mkdir -p "$out"
echo "::group::in-app smoke suite under Xvfb"
xvfb-run -a -s '-screen 0 1280x800x24' dbus-run-session -- \
  flatpak run --env=FLINT_SMOKE_OUT="$out" --filesystem="$out" "$app" --disable-gpu --smoke
ls -l "$out"
echo "::endgroup::"

echo "::group::plain start under Xvfb for 20 seconds"
cat > "$RUNNER_TEMP/smoke.sh" <<'EOS'
log="$RUNNER_TEMP/flatpak-smoke.log"
"$@" > "$log" 2>&1 &
pid=$!
for _ in $(seq 1 20); do
  kill -0 "$pid" 2> /dev/null || break
  sleep 1
done
if kill -0 "$pid" 2> /dev/null; then
  echo "still running after 20s"
  kill "$pid"
  ok=1
else
  wait "$pid" && rc=0 || rc=$?
  echo "exited early with status $rc"
  ok=0
fi
cat "$log"
if grep -E 'error while loading shared libraries|cannot open shared object|undefined symbol' "$log"; then ok=0; fi
[ "$ok" = 1 ]
EOS
xvfb-run -a -s '-screen 0 1280x800x24' dbus-run-session -- \
  bash "$RUNNER_TEMP/smoke.sh" flatpak run "$app" --disable-gpu
echo "::endgroup::"
echo "flatpak $app: OK"
