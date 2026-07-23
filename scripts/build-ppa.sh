#!/usr/bin/env bash
# Assemble and sign the PPA source package from the prebuilt Electron bundle.
# Prereq: npm run dist (payload comes from dist/linux-unpacked).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VER="$(node -p "require('$ROOT/package.json').version")"
BUILD="$ROOT/packaging/ppa/build"
SRC="$BUILD/flint-browser-$VER"

[ -d "$ROOT/dist/linux-unpacked" ] || { echo "error: run 'npm run dist' first"; exit 1; }

rm -rf "$SRC"
mkdir -p "$SRC/opt" "$SRC/usr/share/applications"

cp -a "$ROOT/dist/linux-unpacked" "$SRC/opt/flint-browser"

cat > "$SRC/usr/share/applications/flint-browser.desktop" <<'EOF'
[Desktop Entry]
Name=Flint Browser
GenericName=Web Browser
Comment=Fast, private, batteries-included web browser by Dhiva Labs
Exec=/opt/flint-browser/flint-browser %U
Terminal=false
Type=Application
Icon=flint-browser
StartupWMClass=flint-browser
Categories=Network;WebBrowser;
MimeType=text/html;text/xml;application/xhtml+xml;x-scheme-handler/http;x-scheme-handler/https;
EOF

for s in 16 32 48 64 128 256 512; do
  d="$SRC/usr/share/icons/hicolor/${s}x${s}/apps"
  mkdir -p "$d"
  cp "$ROOT/build/icons/${s}x${s}.png" "$d/flint-browser.png"
done

cp -a "$ROOT/packaging/ppa/debian" "$SRC/debian"
chmod +x "$SRC/debian/rules" "$SRC/debian/postinst"

cd "$SRC"
debuild -S -sa

echo
echo "Upload with:"
echo "  dput ppa:dhiva-labs/apps $BUILD/flint-browser_${VER}_source.changes"
