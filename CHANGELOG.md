# Changelog

All notable changes to Flint Browser. Versions follow [Semantic Versioning](https://semver.org/).

## [1.0.1] - 2026-10-16

### Added

- Linux arm64 and Windows arm64 builds of both editions: `.deb`, `.AppImage` and `.tar.gz` for Linux arm64, and an installer for Windows on Arm. Every package is built on a native arm64 runner, and CI checks that each binary inside is arm64 and runs the in-app smoke suite on it.
- Snap packaging for the standard edition (`flint-browser`, core24, strict confinement) for amd64 and arm64.
- Microsoft Store package (MSIX) for the standard edition, for x64 and arm64.
- A privacy policy ([PRIVACY.md](PRIVACY.md)).

### Changed

- The standard edition no longer ships the dependencies only the BitTorrent stack uses, and skips the native module rebuild it does not need, so its packages are smaller and build faster.
- Every installer in a release ships the same adblock filter snapshot: it is built once per run and shared by all jobs.

### Fixed

- The user agent now carries the platform's own token (Windows or macOS) instead of always claiming Linux, so sites no longer serve Linux content to Windows and macOS users.
- Settings, Default browser: in the Microsoft Store package this opens Windows' Default apps page instead of reporting a success that changed nothing.
- The secure DNS wording in the README and privacy policy now matches the labels in Settings.

## [1.0.0] - 2026-07-23

Initial release: ad and tracker blocking, secure DNS, turbo downloads, reader mode and private windows; the standard and Plus (BitTorrent client and media grabber) editions; Linux x64 (`.deb`, `.AppImage`, `.tar.gz`) and Windows x64 installers.
