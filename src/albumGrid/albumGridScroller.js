/**
 * The only file that moves the Google Photos album grid.
 *
 * `window.scrollTo` does nothing here. Google Photos scrolls an inner
 * container, so the element that actually scrolls has to be found by walking up
 * from a grid link. `findScrollingAncestor` is taken from the sibling
 * extensions, where it is proven against the live site.
 *
 * This is a thin DOM adapter and holds no decision, so it has no unit test. The
 * walk that uses it, `albumGridSweep.js`, is pure and fully tested.
 */

import { findGridPhotoLinks, GRID_PHOTO_LINK_SELECTOR, readPhotoKeyFromLink } from '../googlePhotosPage.js';

/** Rows whose tops differ by less than this count as the same row. */
const SAME_ROW_TOLERANCE_PX = 4;

/**
 * Finds the element that actually scrolls the album grid.
 *
 * Google Photos scrolls an inner container, so `window.scrollTo` alone does
 * nothing. The first ancestor that is taller than its own box and is allowed to
 * scroll is the one.
 * @param {Window} view
 * @param {Element} start
 * @returns {HTMLElement | null}
 */
function findScrollingAncestor(view, start) {
  for (let element = start.parentElement; element !== null; element = element.parentElement) {
    if (element.scrollHeight <= element.clientHeight + 1) continue;
    const overflowY = view.getComputedStyle(element).overflowY;
    if (overflowY === 'auto' || overflowY === 'scroll') return element;
  }
  return null;
}

/**
 * @param {Window} view
 */
export function createAlbumGridScroller(view) {
  /**
   * @returns {HTMLElement | null}
   */
  function findScroller() {
    const anyLink = view.document.querySelector(GRID_PHOTO_LINK_SELECTOR);
    return anyLink === null ? null : findScrollingAncestor(view, anyLink);
  }

  return {
    /**
     * Reads the photos on screen, **in album order**.
     *
     * Document order is not album order: Google Photos recycles the same `<a>`
     * elements as you scroll, so `querySelectorAll` returns whichever photo
     * each element happens to hold now. Sorting by where each thumbnail sits on
     * screen is what puts them back in order.
     * @returns {string[]}
     */
    readPhotoKeysOnScreen() {
      return findGridPhotoLinks(view.document)
        .map((link) => ({ link, box: link.getBoundingClientRect() }))
        .filter((entry) => entry.box.width > 0 && entry.box.height > 0)
        .sort((a, b) =>
          Math.abs(a.box.top - b.box.top) > SAME_ROW_TOLERANCE_PX ? a.box.top - b.box.top : a.box.left - b.box.left,
        )
        .map((entry) => readPhotoKeyFromLink(entry.link))
        .filter((photoKey) => photoKey !== null);
    },

    /**
     * @returns {import('./albumGridSweep.js').ScrollPosition | null}
     *   null when there is no grid on the page at all.
     */
    readScrollPosition() {
      const scroller = findScroller();
      if (scroller !== null) {
        return { top: scroller.scrollTop, viewportHeight: scroller.clientHeight, contentHeight: scroller.scrollHeight };
      }

      // No scrolling ancestor. Either the grid has not rendered yet, or the
      // whole album fits on one screen. The grid links tell the two apart, and
      // the difference matters: the first must not be reported as "the end".
      if (view.document.querySelector(GRID_PHOTO_LINK_SELECTOR) === null) return null;
      return { top: 0, viewportHeight: 1, contentHeight: 1 };
    },

    /**
     * @param {number} top
     */
    scrollTo(top) {
      // `behavior: 'instant'` on purpose. A smooth scroll is still animating
      // when the settle time is up, so the read would happen mid-flight.
      findScroller()?.scrollTo({ top, behavior: 'instant' });
    },
  };
}

/** @typedef {ReturnType<typeof createAlbumGridScroller>} AlbumGridScroller */
