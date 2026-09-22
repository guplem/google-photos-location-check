/**
 * Walks the album grid from top to bottom so that every thumbnail is rendered
 * at least once.
 *
 * ## Why a sweep is needed at all
 *
 * The page ships only the first 300 media ids of an album. The rest do not
 * exist in the page until the virtualised grid has rendered them, and the grid
 * only renders what is near the scroll position. So "read the whole album"
 * really means "put every thumbnail on screen once", and that is a scroll.
 *
 * The sweep reads no location itself. It only moves the grid. The badge
 * renderer already reports every photo that appears and the lookup queue
 * already asks about the ones it has not seen, so the locations fill in on
 * their own while this runs. The photo keys returned here are for counting and
 * for knowing when the album is completely covered.
 *
 * ## Two endings that must never be confused
 *
 * `reachedBottom` is true only when the grid itself said it was at the end. A
 * sweep that ran out of steps, was stopped, or found a grid that refused to
 * move ends with `reachedBottom` false. The caller must not tell the user the
 * album is fully read unless the grid said so: "we stopped looking" and "there
 * is nothing left" look identical from the outside and mean opposite things.
 *
 * ## The grid is the user's, and it is given back
 *
 * The sweep starts at the top, because the user may have pressed the button
 * half way down an album and the photos above would otherwise never be read.
 * It then puts the grid back exactly where it found it, including when it is
 * stopped or fails. Neither sibling extension does this, because both open the
 * photo viewer afterwards and the grid position stops mattering. Here nothing
 * covers the grid, so leaving a user at the bottom of a 1611-photo album would
 * be the extension taking their place away.
 *
 * No DOM here. Every action arrives as a function, so the whole walk is unit
 * tested against a fake grid with a virtual clock and finishes at once.
 */

/**
 * How long the virtualised grid needs to redraw after a scroll, in milliseconds.
 *
 * Taken from the sibling extensions, where it is tuned against the live site.
 * Do not lower it without checking that no row is skipped.
 */
export const DEFAULT_SETTLE_MS = 500;

/**
 * How many scroll steps a sweep may take.
 *
 * Each step uncovers roughly one screen of thumbnails, so this reaches an album
 * of several thousand photos. It exists only so that a grid which keeps growing
 * cannot loop for ever; a normal sweep stops long before it, as soon as the
 * grid reports the bottom.
 */
export const DEFAULT_MAX_STEPS = 400;

/**
 * How much of a screen each step moves.
 *
 * Less than a whole screen on purpose. A full-screen step can skip a row when
 * the grid redraws late, and a skipped row is a photo that never gets a badge.
 * The overlap costs a few extra steps and removes that failure.
 *
 * Exported because `albumGridJump.js` steps the same grid and must move by the
 * same amount: a jump that stepped further than a sweep could skip a photo the
 * sweep would have found.
 */
export const STEP_FRACTION_OF_VIEWPORT = 0.8;

/** Scroll positions this close to the end count as the end. */
const BOTTOM_TOLERANCE_PX = 4;

/** Scrolls that move nothing, away from the end, before the sweep gives up. */
export const MAX_STALLED_STEPS = 3;

/**
 * @typedef {object} ScrollPosition
 * @property {number} top
 * @property {number} viewportHeight
 * @property {number} contentHeight
 *
 * @typedef {object} AlbumSweepProgress
 * @property {number} photosFound
 * @property {number} steps
 *
 * @typedef {object} AlbumSweepResult
 * @property {string[]} photoKeys    Every photo seen, in album order, with no repeats.
 * @property {boolean} reachedBottom True only when the grid reported the end.
 * @property {boolean} stoppedEarly  True when the caller asked the sweep to stop.
 * @property {number} steps
 *
 * @typedef {object} AlbumSweepDependencies
 * @property {() => string[]} readPhotoKeysOnScreen
 * @property {() => ScrollPosition | null} readScrollPosition  null when there is no grid to scroll.
 * @property {(top: number) => void} scrollTo
 * @property {(milliseconds: number) => Promise<void>} wait
 * @property {() => boolean} [shouldStop]
 * @property {(progress: AlbumSweepProgress) => void} [onProgress]
 * @property {number} [settleMs]
 * @property {number} [maxSteps]
 */

/**
 * @param {ScrollPosition} position
 * @returns {boolean}
 */
function isAtBottom(position) {
  return position.top + position.viewportHeight >= position.contentHeight - BOTTOM_TOLERANCE_PX;
}

/**
 * @param {AlbumSweepDependencies} deps
 * @returns {Promise<AlbumSweepResult>}
 */
export async function sweepAlbumGrid(deps) {
  const settleMs = deps.settleMs ?? DEFAULT_SETTLE_MS;
  const maxSteps = deps.maxSteps ?? DEFAULT_MAX_STEPS;
  const shouldStop = deps.shouldStop ?? (() => false);

  /** A set for "have we seen it" and a list for album order. */
  const seen = new Set();
  /** @type {string[]} */
  const photoKeys = [];

  let steps = 0;
  let stalledSteps = 0;
  let reachedBottom = false;
  let stoppedEarly = false;

  const collect = () => {
    for (const photoKey of deps.readPhotoKeysOnScreen()) {
      if (photoKey === '' || seen.has(photoKey)) continue;
      seen.add(photoKey);
      photoKeys.push(photoKey);
    }
    deps.onProgress?.({ photosFound: photoKeys.length, steps });
  };

  const start = deps.readScrollPosition();
  if (start === null) return { photoKeys, reachedBottom: false, stoppedEarly: false, steps: 0 };

  try {
    if (start.top !== 0) {
      deps.scrollTo(0);
      await deps.wait(settleMs);
    }
    collect();

    while (steps < maxSteps) {
      if (shouldStop()) {
        stoppedEarly = true;
        break;
      }

      const before = deps.readScrollPosition();
      // The grid went away under us, usually because the user navigated.
      if (before === null) break;
      if (isAtBottom(before)) {
        reachedBottom = true;
        break;
      }

      deps.scrollTo(before.top + before.viewportHeight * STEP_FRACTION_OF_VIEWPORT);
      steps += 1;
      await deps.wait(settleMs);
      collect();

      const after = deps.readScrollPosition();
      if (after === null) break;
      if (after.top !== before.top) {
        stalledSteps = 0;
        continue;
      }

      // The scroll moved nothing. At the end of the grid that is the end, and
      // it is the only signal some albums give: the content height they report
      // is never quite reached. Anywhere else it means this is not the element
      // that scrolls, or the page is busy, and more of the same will not help.
      if (isAtBottom(after)) {
        reachedBottom = true;
        break;
      }
      stalledSteps += 1;
      if (stalledSteps >= MAX_STALLED_STEPS) break;
    }
  } finally {
    // The grid belongs to the user. Give it back, whatever happened above.
    if (deps.readScrollPosition() !== null) deps.scrollTo(start.top);
  }

  return { photoKeys, reachedBottom, stoppedEarly, steps };
}
