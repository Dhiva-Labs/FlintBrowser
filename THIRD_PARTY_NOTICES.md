# Third-party notices

Flint Browser bundles or builds upon the following open-source software:

| Component | License | Use |
|---|---|---|
| [Electron](https://www.electronjs.org/) (incl. Chromium & Node.js) | MIT / BSD-style / Chromium licenses | Application runtime and web engine |
| [@ghostery/adblocker](https://github.com/ghostery/adblocker) | MPL-2.0 | Ad & tracker blocking engine |
| [EasyList](https://easylist.to/) | CC BY-SA 3.0 / GPLv3 (dual) | Ad blocking filter list (bundled as compiled engine) |
| [EasyPrivacy](https://easylist.to/) | CC BY-SA 3.0 / GPLv3 (dual) | Tracker blocking filter list (bundled as compiled engine) |
| [uBlock Origin filters (uAssets)](https://github.com/uBlockOrigin/uAssets) | GPLv3 | Ad, privacy and anti-breakage filter lists, incl. YouTube rules (bundled as compiled engine) |
| [uBlock Origin resources](https://github.com/gorhill/uBlock) | GPLv3 | Scriptlets and redirect resources run by those filters (bundled as compiled engine) |
| [@mozilla/readability](https://github.com/mozilla/readability) | Apache-2.0 | Reader mode article extraction |
| [WebTorrent](https://github.com/webtorrent/webtorrent) | MIT | BitTorrent client (Flint Plus only) |

Full license texts ship with the respective packages in `node_modules` of the
source tree and inside the application bundle.

EasyList and EasyPrivacy are maintained by The EasyList Authors, and the uBlock
Origin lists and resources by Raymond Hill and the uBlock Origin contributors.
Flint bundles a compiled snapshot (`build/adblock-engine.bin`) built by
`scripts/build-adblock.js` from Ghostery's mirror of these lists, refreshed on
each release.
