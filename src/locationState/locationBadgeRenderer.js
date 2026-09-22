/**
 * Draws a warning badge on every album thumbnail whose photo carries no
 * location, and reports which photos are on screen so they can be looked up.
 *
 * The grid is virtualised: Google Photos keeps about fifty thumbnails in the
 * page and reuses the same `<a>` elements for other photos as you scroll. Two
 * things follow. One pass of decoration is never enough, so this watches the
 * grid and redraws. And a redraw must be cheap, so each link is stamped with
 * the state it currently shows, and an unchanged link is left alone.
 *
 * The badge is drawn by CSS. This file only writes `data-gplc-state` on the
 * link and puts the icon element in place; `locationBadgeStyles.css` decides
 * how it looks. Keep it that way, so a look change needs no JavaScript.
 *
 * The same file also carries the short-lived mark the jump buttons leave on the
 * thumbnail they landed on, for the same reason: it is one more attribute on a
 * link this renderer already owns, and the redraw keeps it on the right photo
 * even while the grid recycles its elements underneath.
 *
 * This is a thin DOM adapter and holds no decision, so it has no unit test.
 * `npm run typecheck` covers it, plus one run in Chrome.
 */

import { findGridPhotoLinks, readPhotoKeyFromLink } from '../googlePhotosPage.js';

const BADGE_CLASS = 'gplc-badge';
const STATE_ATTRIBUTE = 'data-gplc-state';
const POSITIONED_ATTRIBUTE = 'data-gplc-positioned';
const HIGHLIGHT_ATTRIBUTE = 'data-gplc-highlight';

/**
 * How long the mark on a jumped-to thumbnail stays, in milliseconds.
 *
 * It must match the animation in `locationBadgeStyles.css`, or the mark either
 * vanishes mid-fade or lingers as a dead ring.
 */
const HIGHLIGHT_MS = 2000;

/** The badge this renderer put on one link, never a badge inside a nested element. */
const OWN_BADGE_SELECTOR = ':scope > .gplc-badge';

/** Every link this renderer has already touched. */
const DECORATED_LINK_SELECTOR = 'a[data-gplc-state], a[data-gplc-highlight]';

const MISSING_LOCATION_TITLE = 'No location';
const UNREADABLE_TITLE = 'Location could not be read';

/**
 * @typedef {'has-location' | 'no-location' | 'unknown' | 'pending'} BadgeState
 *
 * @typedef {object} LocationBadgeRendererDeps
 * @property {Document} document
 * @property {(photoKey: string) => 'has-location' | 'no-location' | null} readState
 *   The stored verdict, or null when nobody has read this photo yet.
 * @property {(photoKeys: string[]) => void} onPhotosOnScreen
 *   Given every photo key currently in the grid, on each redraw.
 * @property {() => boolean} isEnabled
 * @property {() => boolean} shouldMarkUnreadable
 */

/**
 * A map pin with a stroke through it: "this photo has no place".
 * @param {Document} ownerDocument
 * @returns {SVGSVGElement}
 */
function createMissingLocationIcon(ownerDocument) {
  const svgNamespace = 'http://www.w3.org/2000/svg';
  const svg = ownerDocument.createElementNS(svgNamespace, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2.2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');

  const pin = ownerDocument.createElementNS(svgNamespace, 'path');
  pin.setAttribute('d', 'M12 21s6.5-6.1 6.5-10.5a6.5 6.5 0 0 0-13 0C5.5 14.9 12 21 12 21Z');
  const crossOut = ownerDocument.createElementNS(svgNamespace, 'path');
  crossOut.setAttribute('d', 'M4 3.5 20 20.5');

  svg.append(pin, crossOut);
  return svg;
}

/**
 * @param {LocationBadgeRendererDeps} deps
 */
export function createLocationBadgeRenderer(deps) {
  const ownerDocument = deps.document;

  /** @type {MutationObserver | null} */
  let observer = null;
  /** @type {number | null} */
  let scheduledFrame = null;
  /**
   * The photo a jump just landed on, marked until its timer runs out.
   * @type {string | null}
   */
  let highlightedPhotoKey = null;
  /** @type {number | null} */
  let highlightTimer = null;

  /**
   * @param {BadgeState} state
   * @returns {boolean}
   */
  function stateWantsBadge(state) {
    if (state === 'no-location') return true;
    return state === 'unknown' && deps.shouldMarkUnreadable();
  }

  /**
   * @param {HTMLAnchorElement} link
   * @param {BadgeState} state
   */
  function applyState(link, state) {
    if (link.getAttribute(STATE_ATTRIBUTE) === state) return;
    link.setAttribute(STATE_ATTRIBUTE, state);

    const existingBadge = link.querySelector(OWN_BADGE_SELECTOR);
    if (!stateWantsBadge(state)) {
      existingBadge?.remove();
      return;
    }

    const title = state === 'unknown' ? UNREADABLE_TITLE : MISSING_LOCATION_TITLE;
    if (existingBadge !== null) {
      existingBadge.setAttribute('title', title);
      return;
    }

    // The badge sits inside the link, so the link must be a positioning parent.
    // Turning `static` into `relative` moves nothing on the page.
    if (ownerDocument.defaultView?.getComputedStyle(link).position === 'static') {
      link.style.position = 'relative';
      link.setAttribute(POSITIONED_ATTRIBUTE, 'true');
    }

    const badge = ownerDocument.createElement('span');
    badge.className = BADGE_CLASS;
    badge.title = title;
    badge.append(createMissingLocationIcon(ownerDocument));
    link.append(badge);
  }

  /**
   * @param {HTMLAnchorElement} link
   * @param {boolean} marked
   */
  function applyHighlight(link, marked) {
    if (link.hasAttribute(HIGHLIGHT_ATTRIBUTE) === marked) return;
    if (marked) link.setAttribute(HIGHLIGHT_ATTRIBUTE, 'on');
    else link.removeAttribute(HIGHLIGHT_ATTRIBUTE);
  }

  /** @param {HTMLAnchorElement} link */
  function clearLink(link) {
    link.querySelector(OWN_BADGE_SELECTOR)?.remove();
    link.removeAttribute(STATE_ATTRIBUTE);
    link.removeAttribute(HIGHLIGHT_ATTRIBUTE);
    if (link.hasAttribute(POSITIONED_ATTRIBUTE)) {
      link.style.removeProperty('position');
      link.removeAttribute(POSITIONED_ATTRIBUTE);
    }
  }

  /** Redraws every thumbnail currently in the page. */
  function refresh() {
    if (!deps.isEnabled()) {
      // Touch only the links already decorated. This runs on every grid change,
      // and the page holds hundreds of links.
      for (const link of ownerDocument.querySelectorAll(DECORATED_LINK_SELECTOR)) {
        clearLink(/** @type {HTMLAnchorElement} */ (link));
      }
      return;
    }

    /** @type {string[]} */
    const onScreen = [];
    for (const link of findGridPhotoLinks(ownerDocument)) {
      const photoKey = readPhotoKeyFromLink(link);
      // The grid recycles its links, so the mark is re-decided on every redraw
      // rather than left where it was put.
      applyHighlight(link, photoKey !== null && photoKey === highlightedPhotoKey);
      if (photoKey === null) {
        applyState(link, 'unknown');
        continue;
      }
      onScreen.push(photoKey);
      // "pending" is a photo nobody has read yet. It carries no badge: a badge
      // that appears and then vanishes reads as a wrong answer.
      applyState(link, deps.readState(photoKey) ?? 'pending');
    }
    deps.onPhotosOnScreen(onScreen);
  }

  /** Collapses a burst of grid changes into one redraw per animation frame. */
  function scheduleRefresh() {
    const view = ownerDocument.defaultView;
    if (view === null || scheduledFrame !== null) return;
    scheduledFrame = view.requestAnimationFrame(() => {
      scheduledFrame = null;
      refresh();
    });
  }

  return {
    refresh,
    scheduleRefresh,

    /**
     * Marks one thumbnail for a moment, so a jump has somewhere visible to land.
     *
     * Only one photo is ever marked: a second jump takes the mark off the first.
     * @param {string | null} photoKey  null takes the mark off.
     */
    highlightPhoto(photoKey) {
      const view = ownerDocument.defaultView;
      if (highlightTimer !== null) view?.clearTimeout(highlightTimer);
      highlightTimer = null;
      highlightedPhotoKey = photoKey;
      refresh();

      if (photoKey === null || view === null) return;
      highlightTimer = view.setTimeout(() => {
        highlightTimer = null;
        highlightedPhotoKey = null;
        refresh();
      }, HIGHLIGHT_MS);
    },

    start() {
      if (observer !== null) return;
      observer = new MutationObserver(scheduleRefresh);
      observer.observe(ownerDocument.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['href'],
      });
      ownerDocument.defaultView?.addEventListener('scroll', scheduleRefresh, { passive: true, capture: true });
      refresh();
    },

    stop() {
      observer?.disconnect();
      observer = null;
      if (highlightTimer !== null) ownerDocument.defaultView?.clearTimeout(highlightTimer);
      highlightTimer = null;
      highlightedPhotoKey = null;
      ownerDocument.defaultView?.removeEventListener('scroll', scheduleRefresh, { capture: true });
      for (const link of findGridPhotoLinks(ownerDocument)) clearLink(link);
    },
  };
}

/** @typedef {ReturnType<typeof createLocationBadgeRenderer>} LocationBadgeRenderer */
