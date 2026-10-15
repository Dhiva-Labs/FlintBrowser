# Snap Store packaging for Flint Browser

`snap/snapcraft.yaml` packages the **standard** Flint edition as the
`flint-browser` snap: core24, the `gnome` extension, strict confinement,
amd64 and arm64. It passes the store's automated review (`review-tools` 0.48: pass, no
errors, warnings or manual-review flags), so an upload can be released to a
channel straight away.

## What goes in

The `flint-browser` part builds from source inside the snapcraft build
instance; nothing compiled on a developer machine is shipped:

1. `source: .` with `source-type: git` clones the repository, so host
   `node_modules/` and `dist/` never reach the build.
2. `source-commit` pins **eafe29f**, the commit the "Build installers"
   workflow (run 30030653165) built the published v1.0.0 release assets from.
   The `v1.0.0` tag points at the first commit, before the standard/Plus
   split, so it is *not* what `flint-browser-1.0.0-*.deb/.AppImage/.tar.gz`
   contain. For the next release, tag the release commit and pin that.
3. `npm ci` (Node 22 from the `node` snap; electron-builder 26 and
   `@electron/rebuild` need Node >= 22.12), `npm run build:engine` to
   refresh EasyList/EasyPrivacy as the release workflow does (the committed
   engine is kept if the lists cannot be fetched), then
   `node scripts/dist.js standard`.
4. `scripts/dist.js` hard-codes the `.deb`/AppImage/`.tar.gz` targets; the
   build `sed`s that one line to electron-builder's `dir` target and
   `grep`s that the edit applied, so a change to the line fails the build
   instead of silently building the wrong thing.
5. `dist/linux-unpacked` (`dist/linux-arm64-unpacked` on arm64) becomes
   `$SNAP/opt/flint-browser`, minus
   `chrome-sandbox` (see below).

The standard edition carries no native Node modules (the only one in the
tree, `utp-native`, is Plus-only and excluded), so there is no glibc
mismatch to worry about: Electron's own binaries need glibc 2.25.
`build-packages` (g++, make, python3) exist only so `@electron/rebuild` can
handle `utp-native` if its prebuild ever stops matching.

GTK, NSS, ALSA and friends come from `gnome-46-2404`; Mesa, libgbm and
libdrm from `mesa-2404` through `gpu-2404`. The snapcraft library linter
reports nothing missing. Electron's own `libvulkan.so.1` is kept (lint
ignore in the yaml) because it pairs with the bundled SwiftShader ICD for
the software fallback.

`snap/local/flint-browser-launch` is the app command. It adds
`--no-sandbox` and `--profile-dir=$SNAP_USER_COMMON/profile` (an explicit
`--profile-dir=` on the command line wins).

## Building

```bash
snapcraft pack --use-lxd
```

Produces `flint-browser_1.0.0_amd64.snap` (about 110 MB) in the repository
root; `*.snap` is git-ignored. A clean build takes 10 to 15 minutes, most of
it installing the gnome SDK and mesa build snaps and electron-builder
packaging. If the build instance stalls downloading snaps, restart snapd
inside it:

```bash
C=$(lxc --project snapcraft list -c n --format csv | grep flint-browser)
lxc --project snapcraft exec "$C" -- systemctl restart snapd
```

Stale state after editing parts: `snapcraft clean --use-lxd`.

### arm64

`platforms` lists `amd64` and `arm64`; each is built on a machine of its own
architecture (`snapcraft pack --use-lxd` on an arm64 box, or `snapcraft
remote-build`), because electron-builder packages for the CPU it runs on. That
produces `flint-browser_1.0.0_arm64.snap`. The "Build installers" workflow
builds both on `ubuntu-latest` and `ubuntu-24.04-arm`, checks that every
binary in the snap is for its CPU, installs it and runs the smoke suite, and
keeps the snap as the `snap-x64` / `snap-arm64` workflow artifact. It never
uploads to the store.

Because `source-commit` pins a commit (see above), CI builds that commit's
code on both architectures, not the tip of the branch. The upload is per
architecture and goes to the same channel:

```bash
snapcraft upload --release=stable flint-browser_1.0.0_arm64.snap
```

### Checking review before uploading

Run the store's own checks locally (they run inside the build instance
because `review-tools` is strictly confined and only reads its own
`$SNAP_COMMON`):

```bash
C=$(lxc --project snapcraft list -c n --format csv | grep flint-browser)
lxc --project snapcraft start "$C"
lxc --project snapcraft exec "$C" -- snap install review-tools
lxc --project snapcraft file push flint-browser_1.0.0_amd64.snap \
  "$C/var/snap/review-tools/common/"
lxc --project snapcraft exec "$C" -- sh -c \
  'cd /var/snap/review-tools/common && review-tools.snap-review flint-browser_1.0.0_amd64.snap'
```

This caught one real problem during packaging: plugging both `cups` and
`cups-control` is a hard lint error (`plugs_conflicting`).

## Publishing

```bash
snapcraft register flint-browser     # once
snapcraft upload --release=stable flint-browser_1.0.0_amd64.snap
```

Do not upload a build that needs manual review (for example one with
`allow-sandbox: true`, below): a revision waiting in the review queue blocks
releasing every later revision of the snap until it is rejected or
approved.

## The Chromium sandbox

Chromium isolates renderers with a setuid helper (`chrome-sandbox`) or, if
unprivileged user namespaces are available, a namespace sandbox. Neither
works in a strict snap as-is:

* **setuid** is impossible: snaps cannot ship setuid files.
* **namespaces** need the `browser-support` plug with
  `allow-sandbox: true`, which grants user namespaces, `unshare`,
  `chroot`, `CAP_SYS_ADMIN` and more. snapd's base declaration *denies
  connection* for that attribute, so the store sends the upload to human
  review and needs a snap declaration granted on the forum
  (<https://forum.snapcraft.io/c/store-requests>), as the Chromium and
  Firefox snaps have. A test build with the attribute failed `review-tools`
  with "human review required due to 'deny-connection' constraint", and the
  tool itself suggests `--no-sandbox` instead.

So the snap runs Flint with **`--no-sandbox`** and plain `browser-support`,
which auto-connects. The trade-off: renderer processes are not isolated from
the browser process, so a renderer exploit is not contained by Chromium's
own sandbox. It is still contained by the snap's AppArmor and seccomp
profile: no access outside the snap and the plugged interfaces (no hidden
files in home, no other snaps' data, no system files). This is the usual
store compromise for Electron apps (Slack's snap does the same), but Flint
loads arbitrary web content, so it matters more here than for a chat
client.

If the renderer sandbox is wanted later: request `allow-sandbox` for
`flint-browser` on the forum first, wait for the snap declaration, then add
a `browser-sandbox` plug (`interface: browser-support`,
`allow-sandbox: true`), drop `--no-sandbox` from the launcher and stop
deleting `chrome-sandbox`. Only upload once the declaration exists.

## Interfaces

| Plug | Auto-connected | Why |
|---|---|---|
| browser-support | yes | Chromium shared memory, process and /proc access |
| network | yes | browsing |
| network-bind | yes | WebRTC ICE sockets; the in-app smoke suite's loopback server |
| home | yes | downloads to ~/Downloads, uploads from home |
| audio-playback | yes | media |
| screen-inhibit-control | yes | keep the screen on during video |
| opengl, desktop, desktop-legacy, wayland, x11, unity7, gsettings | yes | from the gnome extension |
| removable-media | **no** | files under /media, /mnt |
| audio-record | **no** | microphone for sites the user allows |
| camera | **no** | camera for sites the user allows |
| cups-control | **no** | printing to system CUPS printers |

The manual ones are listed with their `snap connect` commands in the store
description.

Deliberately not plugged:

* `cups`: conflicts with `cups-control` in review, and only reaches the
  CUPS snap, which desktops rarely run.
* `u2f-devices`: Electron has no WebAuthn security-key UI on Linux, so
  nothing would use it.
* `password-manager-service`: Flint does not use `safeStorage`, and
  Electron leaves cookie encryption off.
* an `mpris` slot: Chromium registers `org.mpris.MediaPlayer2.chromium.*`;
  a slot named anything but the snap name needs manual review. Media keys
  and the desktop media widget do not see Flint.

## Behaviour under confinement

Verified in an Ubuntu 24.04 VM (Xvfb, snapd 2.77):

* The UI renders and real pages load. Flint's own smoke suite passes inside
  the snap: `snap run flint-browser --smoke --profile-dir=/tmp/flint-smoke-profile`
  (12/12: navigation, adblock, history, bookmarks, settings, internal
  pages, segmented download, DoH, Plus features absent).
* Downloads land in the real `~/Downloads`. The desktop-launch wrapper
  copies the user's `user-dirs.dirs` (or symlinks the snap's Downloads to
  the real one when there is none).
* `flint-browser <url>` while Flint is running opens a new tab in the
  running window (the `second-instance` path works across `snap run`).
* Ctrl+P opens the GTK print dialog; without `cups-control`, Print to File
  (PDF) is available.
* No AppArmor denials apart from D-Bus `ListActivatableNames`. Logged but
  harmless seccomp denials: `sched_setaffinity`, `io_uring_setup` (libuv
  falls back) and `pkey_alloc` (V8 falls back). The IBus "Failed to mkdir
  .../.config/ibus/bus" warning appears in every gnome-extension snap.

Limitations:

* **Profile location.** The profile is in `~/snap/flint-browser/common/profile`,
  not `~/.config/Flint` like the .deb, and is not migrated from a .deb
  install.
* **Settings → Default browser → "Set as default" fails** ("Failed — set in
  system settings"): from inside the sandbox it can only write the snap's
  private `mimeapps.list`. The desktop entry declares the http/https and
  text/html MIME types, so Flint is offered in the desktop's Default
  Applications settings, which is the route that works.
* Hidden files and folders in home (`~/.something`) cannot be opened or
  uploaded, and nothing outside home without `removable-media`.
* No renderer sandbox (see above), no media keys/MPRIS, no hardware
  security keys.

## Flint Plus

Not packaged. The README positions Plus for direct distribution (GitHub,
PPA) and the standard edition as the store build. A `flint-browser-plus` snap
would also have to build the native `utp-native` module in the snap and
would put a BitTorrent client and media grabber in front of store review,
which is a judgement call rather than an automatic pass.
