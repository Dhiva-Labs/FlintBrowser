#!/usr/bin/env bash
# Assemble an (unsigned) PPA source package for one edition from its prebuilt
# Electron bundle. Signing is left to the maintainer (needs the GPG passphrase):
#   scripts/build-ppa.sh standard
#   scripts/build-ppa.sh plus
# Prereq: the matching edition has been built (npm run dist:<edition>), leaving
# its payload in dist/linux-unpacked.
set -euo pipefail

EDITION="${1:-standard}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VER="$(node -p "require('$ROOT/package.json').version")"

case "$EDITION" in
  standard) PKG="flint-browser";      NAME="Flint";      EXE="flint-browser";      SYN="Fast, private web browser with built-in ad blocking";;
  plus)     PKG="flint-browser-plus"; NAME="Flint Plus"; EXE="flint-browser-plus"; SYN="Fast, private web browser with adblock, BitTorrent and media tools";;
  *) echo "usage: build-ppa.sh <standard|plus>"; exit 1;;
esac

BUILD="$ROOT/packaging/ppa/build"
SRC="$BUILD/${PKG}-${VER}"
[ -d "$ROOT/dist/linux-unpacked" ] || { echo "error: run 'npm run dist:$EDITION' first"; exit 1; }

rm -rf "$SRC"
mkdir -p "$SRC/opt" "$SRC/usr/share/applications"
cp -a "$ROOT/dist/linux-unpacked" "$SRC/opt/$PKG"

cat > "$SRC/usr/share/applications/$PKG.desktop" <<EOF
[Desktop Entry]
Name=$NAME
GenericName=Web Browser
Comment=$SYN
Exec=/opt/$PKG/$EXE %U
Terminal=false
Type=Application
Icon=$PKG
StartupWMClass=$EXE
Categories=Network;WebBrowser;
MimeType=text/html;text/xml;application/xhtml+xml;x-scheme-handler/http;x-scheme-handler/https;
EOF

for s in 16 32 48 64 128 256 512; do
  d="$SRC/usr/share/icons/hicolor/${s}x${s}/apps"
  mkdir -p "$d"
  cp "$ROOT/build/icons/${s}x${s}.png" "$d/$PKG.png"
done

# Generate the debian/ metadata for this edition from the template.
mkdir -p "$SRC/debian/source"
sed "s/@PKG@/$PKG/g; s/@EXE@/$EXE/g; s/@NAME@/$NAME/g" "$ROOT/packaging/ppa/debian/control.in" > "$SRC/debian/control"
sed "s/@PKG@/$PKG/g; s/@EXE@/$EXE/g" "$ROOT/packaging/ppa/debian/rules.in" > "$SRC/debian/rules"
sed "s/@PKG@/$PKG/g; s/@NAME@/$NAME/g; s/@VER@/$VER/g" "$ROOT/packaging/ppa/debian/changelog.in" > "$SRC/debian/changelog"
cp "$ROOT/packaging/ppa/debian/copyright" "$SRC/debian/copyright"
echo "3.0 (native)" > "$SRC/debian/source/format"
printf 'tar-ignore = .git\ntar-ignore = .gitignore\n' > "$SRC/debian/source/options"
echo "opt/$PKG/$EXE usr/bin/$EXE" > "$SRC/debian/links"
cat > "$SRC/debian/postinst" <<EOF
#!/bin/sh
set -e
case "\$1" in
  configure)
    if [ -f "/opt/$PKG/chrome-sandbox" ]; then chmod 4755 "/opt/$PKG/chrome-sandbox" || true; fi
    ;;
esac
#DEBHELPER#
exit 0
EOF
chmod +x "$SRC/debian/rules" "$SRC/debian/postinst"

cd "$SRC"
debuild -S -sa -us -uc

echo
echo "Built unsigned source package for $NAME. To publish:"
echo "  debsign -k 32CC792311A6EF76 $BUILD/${PKG}_${VER}_source.changes"
echo "  dput ppa:dhiva-labs/apps $BUILD/${PKG}_${VER}_source.changes"
