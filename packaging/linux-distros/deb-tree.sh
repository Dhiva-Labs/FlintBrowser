#!/usr/bin/env bash
# Unpacks the .deb that electron-builder made into the installed tree that
# pack.sh and the Flatpak are built from, and adds what the .deb's
# maintainer script creates at install time, so the packages carry it as
# files instead:
#   - /usr/bin/<exe>, a symlink to /opt/<product>/<exe>
#   - chrome-sandbox setuid root (mode 4755), Chromium's sandbox helper for
#     kernels without unprivileged user namespaces, as the PPA package has it
#
# usage: EDITION=<standard|plus> deb-tree.sh <deb> <root>
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[ $# -eq 2 ] || { echo "usage: $0 <deb> <root>" >&2; exit 2; }
# shellcheck source=/dev/null
. "$here/distro.conf"
deb="$1"
root="$2"

echo "::group::$(basename "$deb"): control and maintainer scripts"
dpkg-deb -I "$deb"
ctl="$(mktemp -d)"
dpkg-deb -e "$deb" "$ctl"
for f in "$ctl"/postinst "$ctl"/postrm; do
  if [ -f "$f" ]; then echo "--- $(basename "$f")"; cat "$f"; fi
done
rm -rf "$ctl"
echo "::endgroup::"

dpkg-deb -x "$deb" "$root"
app="$root/opt/$PRODUCT"
[ -x "$app/$NAME" ] || { echo "no executable /opt/$PRODUCT/$NAME in $deb" >&2; exit 1; }
[ ! -e "$root/usr/bin/$NAME" ] || { echo "the .deb already ships /usr/bin/$NAME" >&2; exit 1; }
install -d "$root/usr/bin"
ln -s "/opt/$PRODUCT/$NAME" "$root/usr/bin/$NAME"
chmod 4755 "$app/chrome-sandbox"
find "$root" -maxdepth 4 -not -path "$app/*" | sort
