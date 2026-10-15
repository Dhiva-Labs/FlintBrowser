# Microsoft Store packaging for Flint Browser

`node scripts/dist.js standard --appx` builds the **standard** edition as an
unsigned MSIX/AppX package (`dist/flint-browser-<version>-<arch>.appx`, with
`<arch>` the CPU of the machine that runs it: `x64` or `arm64`) for upload to
Partner Center. It only runs on Windows (electron-builder drives
`makeappx`/`makepri` from its own Windows Kits bundle) and refuses the Plus
edition. Microsoft signs the package when it publishes it, so no certificate is
needed.

## Store identity

Set in `package.json` under `build.appx`; these come from the reserved Partner
Center product (Store ID 9NPK7TQQ4S5M):

| Field | Value |
|---|---|
| Identity Name | `Dhiva-Labs.FlintBrowser` |
| Publisher | `CN=0F69015A-AA5B-431D-970A-165099309E53` |
| PublisherDisplayName | `Dhiva-Labs` |
| Application Id | `FlintBrowser` (electron-builder rejects the hyphen in the identity name here) |
| Version | `1.0.0.0`, from `package.json` version `1.0.0` (the Store requires the 4th field to be 0) |
| Capabilities | `internetClient`, plus `runFullTrust` which electron-builder always adds |
| Target | Windows.Desktop 10.0.17763.0 and later, x64 and arm64 (one package each) |

For the appx build `dist.js` also sets the product name to `Flint Browser` (so
the executable is `Flint Browser.exe`, matching the Store name) and replaces
the description: electron-builder pastes it into the manifest without XML
escaping, and the `&` in the normal description makes the manifest invalid.

`runFullTrust` is a restricted capability. Partner Center asks for a
justification on the Submission options page ("Flint is a Chromium-based web
browser built on Electron; it is a desktop application and needs full trust to
run its multi-process Chromium engine, save downloads to the user's Downloads
folder and use the system's network stack").

## Tile assets

`build/appx/` holds the logo set electron-builder puts in the package
(StoreLogo, Square44x44Logo with `targetsize` and `altform-unplated` variants,
Square150x150Logo, Wide310x150Logo, SmallTile, LargeTile, each with
`scale-100/125/150/200/400`). Because scaled files are present, electron-builder
runs `makepri` and the package carries `resources.pri` plus
`resources.scale-*.pri`. Regenerate the PNGs from `build/icon.svg` with
`npm run build:appx-assets`.

## Building

```powershell
git clone https://github.com/Dhiva-Labs/FlintBrowser.git
cd FlintBrowser
npm ci
node scripts/dist.js standard --appx     # or: npm run dist:appx
```

Needs Node 22.12 or later and network access the first time (electron-builder
downloads Electron and its Windows Kits bundle). No Python, C++ toolchain or
Developer Mode is needed: the standard edition ships no native modules, so
`dist.js` turns off the `@electron/rebuild` pass for it. A build takes about a
minute. `npm run build:engine` (refreshing EasyList/EasyPrivacy) is optional;
the committed `build/adblock-engine.bin` is used as is.

### x64 and arm64

electron-builder packages for the CPU it runs on, so the x64 package is built
on an x64 machine and the arm64 package on a Windows on Arm machine (Node and
Electron both have to be arm64 builds; `process.arch` must say `arm64`).
`ProcessorArchitecture` in the manifest follows, and so does the file name.
The "Build installers" workflow builds both on native runners (`windows-latest`
and `windows-11-arm`) and keeps them as the `msix-x64` and `msix-arm64`
workflow artifacts. It checks the manifest identity and architecture, that
every binary inside is for that CPU, and runs the app's smoke suite from the
same unpacked files. Nothing is uploaded to Partner Center: download both
artifacts and add both `.appx` files to the same submission, and the Store
serves each device the package for its CPU.

Check the result with the SDK's `makeappx`:

```powershell
makeappx unpack /o /p dist\flint-browser-1.0.0-x64.appx /d dist\appx-unpacked
```

Look at `AppxManifest.xml` for the identity, capabilities and `Executable`
(`app\Flint Browser.exe`). `dist\win-unpacked\Flint Browser.exe --smoke
--profile-dir=<tmp>` runs the in-app smoke suite on the same files; it needs an
interactive desktop session, not session 0 or a headless SSH session.

## What the standard package contains

`dist.js` excludes every production dependency that the standard edition
cannot reach (it walks the installed dependency graph from everything except
`webtorrent`), not just packages matching BitTorrent names. The asar holds 13
dependency packages (the Ghostery adblocker and its helpers, Readability) and
no torrent or grabber code. Before this, about 130 transitive packages of
webtorrent (streams, buffers, DHT and so on) shipped unused in the Linux and
Windows builds.

## Store policy 10.2.1: keep Chromium current

Microsoft Store policy 10.2.1 (policies version 7.20) allows browsers only on
the Chromium or Gecko engine, and requires them to be no older than two major
versions behind the upstream release, with security fixes patched promptly.
Flint's Chromium is whatever the pinned Electron ships: Electron 43.2.0 is
Chromium 150. When the Electron major is updated is therefore a Store
compliance matter, not only a security one: submit a new package within about
two Chromium releases (roughly eight weeks) of each Chromium stable release,
or the listing can be pulled.

## Not done yet

* **Default browser registration.** The manifest declares no `http`/`https`
  protocol or `.html` file type handlers, so Flint does not appear in
  Windows' Default apps list. Inside an MSIX, `app.setAsDefaultProtocolClient`
  writes to a private registry hive and does nothing, so Settings, Default
  browser, Set as default opens the Windows Default apps page instead of
  reporting success. To support it, add `uap:Protocol` (or `uap3:Protocol`
  with `Parameters="&quot;%1&quot;"`) and `uap:FileTypeAssociation` entries
  through `appx.customExtensionsPath`; the app already opens URLs passed on its
  command line and in a second instance. This needs an installed package to
  test, which means Developer Mode or a signed test build, so it was left out
  of 1.0.0.0.
* **Install test.** The package was verified by unpacking it and running the
  same files from `win-unpacked`; it was not installed through the Store or
  with `Add-AppxPackage`, because that needs sideloading enabled.
* **Store install test of the arm64 package.** CI builds and checks it as
  described above, but, like the x64 one, it was not installed through the
  Store or with `Add-AppxPackage`.
