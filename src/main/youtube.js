'use strict';

// YouTube extras layered on top of the filter lists.
//
// uBlock's scriptlets (from the bundled engine) strip ad placements out of
// YouTube's player data, which is what actually prevents video ads. YouTube
// changes its ad plumbing often, so this adds two safety nets that do not
// depend on the lists being current:
//   * STYLES hides ad slots in the feed, search, watch sidebar and player.
//   * SCRIPT ends any video ad that still starts: it seeks the ad to its end
//     and presses Skip. It only touches the player while YouTube itself marks
//     it as showing an ad, and never seeks anything longer than an ad.

const HOSTS = ['youtube.com', 'youtube-nocookie.com', 'youtubekids.com'];

function matches(hostname) {
  const h = String(hostname || '').toLowerCase();
  return HOSTS.some((d) => h === d || h.endsWith('.' + d));
}

const STYLES = `
#masthead-ad, #player-ads, #panels > ytd-ads-engagement-panel-content-renderer,
ytd-ad-slot-renderer, ytd-in-feed-ad-layout-renderer, ytd-display-ad-renderer,
ytd-promoted-sparkles-web-renderer, ytd-promoted-video-renderer,
ytd-compact-promoted-video-renderer, ytd-search-pyv-renderer,
ytd-banner-promo-renderer, ytd-statement-banner-renderer, ytd-primetime-promo-renderer,
ytd-companion-slot-renderer, ytd-action-companion-ad-renderer,
ytd-player-legacy-desktop-watch-ads-renderer, ytd-merch-shelf-renderer,
ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-ads"],
ytd-rich-item-renderer:has(> #content > ytd-ad-slot-renderer),
ytd-rich-section-renderer:has(ytd-statement-banner-renderer),
.ytp-ad-overlay-container, .ytp-ad-image-overlay, .ytp-featured-product,
ytm-promoted-sparkles-web-renderer, ytm-companion-ad-renderer, ad-slot-renderer
{ display: none !important; }
`;

const SCRIPT = `(() => {
  const SKIP = '.ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-ad-skip-button-container button';
  const MAX_AD_SECONDS = 90;
  const onMedia = (e) => {
    const v = e.target;
    if (!(v instanceof HTMLVideoElement)) return;
    const player = v.closest('.html5-video-player');
    if (!player || !player.classList.contains('ad-showing')) return;
    const d = v.duration;
    if (Number.isFinite(d) && d > 0 && d <= MAX_AD_SECONDS && v.currentTime < d - 0.25) {
      try { v.currentTime = d; } catch (_) {}
    }
    const skip = player.querySelector(SKIP);
    if (skip) skip.click();
  };
  for (const type of ['loadedmetadata', 'playing', 'timeupdate']) {
    document.addEventListener(type, onMedia, true);
  }
})();`;

module.exports = { matches, STYLES, SCRIPT, HOSTS };
