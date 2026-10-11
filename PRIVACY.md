# Flint Browser Privacy Policy

Last updated: 11 October 2026

Flint Browser ("Flint") is a desktop web browser made by Dhiva Labs. This
policy covers the standard edition of Flint, including the Microsoft Store
version. Flint has no accounts, no sync and no servers run by Dhiva Labs.
**Dhiva Labs does not collect, receive or store any information about you or
your browsing.** The sections below list what Flint keeps on your device and
the network connections it makes.

## What Flint stores on your device

Everything below stays on your device, in Flint's user-data folder (on
Windows under `%APPDATA%`; the Microsoft Store version keeps it in the app's
private data folder). Dhiva Labs cannot see it.

- **Browsing history**: page addresses, titles, visit counts and last-visit
  time, up to 20,000 entries. Private windows do not record history.
- **Bookmarks**.
- **Open tabs**, so Flint can restore your session (a setting you can turn
  off). Private windows are not saved.
- **Settings**: search engine, theme, ad-blocking on/off and per-site
  exceptions, secure DNS choice, download folder, and the camera, microphone,
  location, notification and MIDI decisions you make for each site.
- **Download list**: file name, source address, local path, size and state.
  The downloaded files go to your Downloads folder, or the folder you pick.
- **Cookies, site storage and cache**, kept by the Chromium engine Flint is
  built on.

Private windows (Ctrl+Shift+N) use a temporary in-memory session; its cookies
and site data are discarded when the window closes.

You can clear the cache, cookies and history from Settings, remove single
history entries from the History page, and remove the download list from the
Downloads page. Uninstalling the Microsoft Store version removes its data;
for other installs you can delete the user-data folder yourself.

## Network connections Flint makes

- **Websites you visit**, and everything those pages load. If you type
  something that is not an address, the text is sent to the search engine you
  selected in Settings: DuckDuckGo by default, or Google, Bing or Brave
  Search. Address-bar suggestions come only from your local history and
  bookmarks; Flint sends no suggestion requests.
- **Secure DNS (DNS-over-HTTPS)**. By default (Secure DNS set to "When
  available", provider Cloudflare) Flint looks up website names through
  Cloudflare's resolver at `cloudflare-dns.com`, falling back to your system's
  DNS if it cannot be reached. Flint contacts this resolver when it starts,
  before you open any page. Cloudflare's privacy policy applies to those
  lookups. In Settings, under Network, you can switch to Quad9
  (`dns.quad9.net`), Google (`dns.google`), AdGuard (`dns.adguard-dns.com`) or
  a resolver of your own, or set Secure DNS to Off. With it off and no page
  open, Flint makes no network connections.
- **Website icons** are fetched from the sites you visit.
- **Downloads** come straight from the file's server. Flint's "Turbo
  download" opens several connections to that same server and sends your
  cookies for that site, as the browser would for an ordinary download.

## What Flint does not do

- No telemetry, analytics, usage statistics or advertising identifiers.
- No crash reports are uploaded.
- No update checks of its own: updates arrive through the Microsoft Store (or
  your package manager).
- No filter-list downloads. The EasyList and EasyPrivacy rules used for ad and
  tracker blocking are compiled into Flint when it is built, and are refreshed
  only by installing a newer version.
- No Google account, Safe Browsing, sync or other cloud services.

## Permissions

Sites that ask for your camera, microphone, location, notifications or MIDI
devices only get them if you click Allow in a prompt. Flint remembers your
answer for that site on your device. Windows' own privacy settings also apply.

## Third parties

Websites, search engines and DNS providers you use have their own privacy
policies; Flint cannot control what they collect. If you install Flint from the
Microsoft Store, Microsoft's own Store terms and privacy statement apply to the
purchase and install, separately from this policy.

## Children

Flint is a general-purpose browser and is not directed at children. Because
Flint collects no personal information, it holds none about children either.

## Changes

If this policy changes, the new version will be published at this address with
a new date. Flint is open source; its behaviour can be checked in the source
code at <https://github.com/Dhiva-Labs/FlintBrowser>.

## Contact

Dhiva Labs, reachout@dhivalabs.com
