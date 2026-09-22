/**
 * Walks the album grid in one direction until it reaches a photo that carries
 * no location, so the user can go from one to the next without hunting.
 *
 * ## Why this is a walk and not a lookup
 *
 * The grid is virtualised: only the thumbnails near the scroll position exist
 * in the page, and nothing remembers where a photo sits. So "go to the next
 * photo without a location" cannot be answered from what is stored; the grid
 * has to be moved, one screen at a time, until that photo is rendered. The
 * steps are the same ones `albumGridSweep.js` takes, and for the same reason.
 *
 * ## A screen is only judged once every photo on it has an answer
 *
 * Locations are read lazily, so a screen this walk has just uncovered holds
 * photos nobody has asked about yet. Judging it then would skip them, and a
 * skipped photo is exactly the one the user pressed the button to find. So
 * every screen is handed to `waitForVerdicts` first, and only then read.
 *
 * ## The anchor is what makes a second press move on
 *
 * Without it, pressing the button twice would land on the same photo for ever.
 * `fromPhotoKey` is the photo the last jump landed on: when it is still on
 * screen, the search starts after it. When it is not, the user has scrolled
 * somewhere else since, and the whole screen is searched again from its edge.
 *
 * ## The grid is given back, but only when nothing was found
 *
 * `albumGridSweep.js` always puts the grid back, because it is only counting.
 * Here moving the user is the whole point, so the grid is restored only when
 * the walk found nothing: a button press that changes nothing must also leave
 * nothing changed.
 *
 * No DOM here. Every action arrives as a function, so the whole walk is unit
 * tested against a fake grid with a virtual clock and finishes at once.
 */

import { DEFAULT_MAX_STEPS, DEFAULT_SETTLE_MS, MAX_STALLED_STEPS, STEP_FRACTION_OF_VIEWPORT } from './albumGridSweep.js';

/** Scroll positions this close to an edge of the grid count as that edge. */
const EDGE_TOLERANCE_PX = 4;

/**
 * @typedef {import('./albumGridSweep.js').ScrollPosition} ScrollPosition
 *
 * @typedef {'next' | 'previous'} AlbumGridJumpDirection
 *
 * @typedef {object} AlbumGridJumpResult
 * @property {string | null} photoKey  The photo the walk stopped on, or null when there was none.
 * @property {boolean} reachedEnd      True only when the grid itself said there was no more to see that way.
 * @property {boolean} stoppedEarly    True when the caller asked the walk to stop.
 * @property {number} steps
 *
 * @typedef {object} AlbumGridJumpDependencies
 * @property {AlbumGridJumpDirection} direction
 * @property {string | null} fromPhotoKey  The photo the last jump landed on, or null to search from the current screen.
 * @property {() => string[]} readPhotoKeysOnScreen  In album order.
 * @property {(photoKeys: readonly string[]) => Promise<void>} waitForVerdicts
 *   Resolves once every photo it is given has been asked about.
 * @property {(photoKey: string) => 'has-location' | 'no-location' | null} readState
 * @property {() => ScrollPosition | null} readScrollPosition  null when there is no grid on the page.
 * @property {(top: number) => void} scrollTo
 * @property {(milliseconds: number) => Promise<void>} wait
 * @property {() => boolean} [shouldStop]
 * @property {number} [settleMs]
 * @property {number} [maxSteps]
 */

/**
 * @param {ScrollPosition} position
 * @param {boolean} forwards
 * @returns {boolean}
 */
function isAtEdge(position, forwards) {
  return forwards
    ? position.top + position.viewportHeight >= position.contentHeight - EDGE_TOLERANCE_PX
    : position.top <= EDGE_TOLERANCE_PX;
}

/**
 * @param {ScrollPosition} position
 * @param {boolean} forwards
 * @returns {number}
 */
function stepFrom(position, forwards) {
  const distance = position.viewportHeight * STEP_FRACTION_OF_VIEWPORT;
  return forwards ? position.top + distance : Math.max(0, position.top - distance);
}

/**
 * @param {AlbumGridJumpDependencies} deps
 * @returns {Promise<AlbumGridJumpResult>}
 */
export async function jumpToPhotoWithoutLocation(deps) {
  const settleMs = deps.settleMs ?? DEFAULT_SETTLE_MS;
  const maxSteps = deps.maxSteps ?? DEFAULT_MAX_STEPS;
  const shouldStop = deps.shouldStop ?? (() => false);
  const forwards = deps.direction === 'next';

  /** The photo the search must start after, while it is still on screen. */
  let anchorPhotoKey = deps.fromPhotoKey;

  /**
   * Reads the screen the grid is showing now and returns the first photo on it,
   * walking in the chosen direction, that carries no location.
   * @returns {Promise<string | null>}
   */
  async function searchScreen() {
    const onScreen = deps.readPhotoKeysOnScreen();
    if (onScreen.length === 0) return null;
    await deps.waitForVerdicts(onScreen);

    const inWalkOrder = forwards ? onScreen : [...onScreen].reverse();
    // -1 when the anchor is not on this screen, which starts the search at the
    // first photo of it. That is the whole of the "the user moved" case.
    const anchorIndex = anchorPhotoKey === null ? -1 : inWalkOrder.indexOf(anchorPhotoKey);
    for (const photoKey of inWalkOrder.slice(anchorIndex + 1)) {
      if (deps.readState(photoKey) === 'no-location') return photoKey;
    }
    return null;
  }

  let steps = 0;
  let stalledSteps = 0;
  let reachedEnd = false;
  let stoppedEarly = false;
  /** @type {string | null} */
  let found = null;

  const start = deps.readScrollPosition();
  if (start === null) return { photoKey: null, reachedEnd: false, stoppedEarly: false, steps: 0 };

  try {
    for (;;) {
      if (shouldStop()) {
        stoppedEarly = true;
        break;
      }

      found = await searchScreen();
      if (found !== null) break;

      const before = deps.readScrollPosition();
      // The grid went away under us, usually because the user navigated.
      if (before === null) break;
      if (isAtEdge(before, forwards)) {
        reachedEnd = true;
        break;
      }
      if (steps >= maxSteps) break;

      deps.scrollTo(stepFrom(before, forwards));
      steps += 1;
      await deps.wait(settleMs);

      const after = deps.readScrollPosition();
      if (after === null) break;

      if (after.top !== before.top) {
        // A new screen is a screen the anchor is no longer part of. Dropping it
        // only once the grid really moved matters: on a screen that did not
        // move, searching again from its edge could hand back a photo the user
        // has already passed, which reads as the button going the wrong way.
        anchorPhotoKey = null;
        stalledSteps = 0;
        continue;
      }

      // The scroll moved nothing. At the far end of the grid that is the end,
      // and it is the only signal some albums give: the content height they
      // report is never quite reached. Anywhere else it means the page is busy
      // or this is not the element that scrolls, and repeating will not help.
      if (isAtEdge(after, forwards)) {
        reachedEnd = true;
        break;
      }
      stalledSteps += 1;
      if (stalledSteps >= MAX_STALLED_STEPS) break;
    }
  } finally {
    // A walk that found nothing must leave the user where it started.
    if (found === null && deps.readScrollPosition() !== null) deps.scrollTo(start.top);
  }

  return { photoKey: found, reachedEnd, stoppedEarly, steps };
}
