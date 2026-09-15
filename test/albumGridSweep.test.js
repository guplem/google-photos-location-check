import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { MAX_STALLED_STEPS, sweepAlbumGrid } from '../src/albumGrid/albumGridSweep.js';

/**
 * A stand-in for the virtualised album grid.
 *
 * It behaves the way the real one does in the three ways that matter: only the
 * thumbnails near the scroll position exist at any moment, the content grows
 * while the sweep runs because Google Photos loads an album in pages, and a
 * scroll past the end simply does not move.
 * @param {object} options
 * @param {number} options.photoCount
 * @param {number} [options.viewportHeight]
 * @param {number} [options.rowHeight]
 * @param {number} [options.photosPerRow]
 * @param {number} [options.loadedPhotoCount]  Photos that exist before the sweep starts.
 * @param {number} [options.startTop]          Where the user had scrolled to.
 */
function fakeGrid({
  photoCount,
  viewportHeight = 800,
  rowHeight = 200,
  photosPerRow = 5,
  loadedPhotoCount = photoCount,
  startTop = 0,
}) {
  const grid = {
    top: startTop,
    loaded: Math.min(loadedPhotoCount, photoCount),
    /** @type {number[]} */
    movedTo: [],

    get contentHeight() {
      return Math.ceil(grid.loaded / photosPerRow) * rowHeight;
    },

    readScrollPosition: () => ({ top: grid.top, viewportHeight, contentHeight: grid.contentHeight }),

    scrollTo: (/** @type {number} */ top) => {
      grid.movedTo.push(top);
      grid.top = Math.max(0, Math.min(top, Math.max(0, grid.contentHeight - viewportHeight)));
      // Reaching the end of what is loaded pulls in the next page.
      if (grid.top + viewportHeight >= grid.contentHeight - 1) {
        grid.loaded = Math.min(grid.loaded + photosPerRow * 4, photoCount);
      }
    },

    readPhotoKeysOnScreen: () => {
      const firstRow = Math.floor(grid.top / rowHeight);
      const lastRow = Math.ceil((grid.top + viewportHeight) / rowHeight);
      /** @type {string[]} */
      const keys = [];
      for (let index = firstRow * photosPerRow; index < Math.min(lastRow * photosPerRow, grid.loaded); index++) {
        keys.push('photo-' + String(index));
      }
      return keys;
    },
  };
  return grid;
}

/** Records every wait instead of sleeping, so a long sweep finishes at once. */
function virtualClock() {
  /** @type {number[]} */
  const waits = [];
  return { waits, wait: async (/** @type {number} */ ms) => void waits.push(ms) };
}

test('collects every photo of the album and reports that it reached the bottom', async () => {
  const grid = fakeGrid({ photoCount: 120 });
  const clock = virtualClock();

  const result = await sweepAlbumGrid({ ...grid, wait: clock.wait });

  assert.equal(result.reachedBottom, true);
  assert.equal(result.stoppedEarly, false);
  assert.equal(result.photoKeys.length, 120);
  assert.equal(new Set(result.photoKeys).size, 120, 'expected no duplicates');
});

test('starts from the top, whatever the user had scrolled to', async () => {
  const grid = fakeGrid({ photoCount: 120, startTop: 3000 });
  const clock = virtualClock();

  const result = await sweepAlbumGrid({ ...grid, wait: clock.wait });

  assert.equal(grid.movedTo[0], 0, 'expected the sweep to go to the top first');
  assert.ok(result.photoKeys.includes('photo-0'), 'expected the first photo of the album');
  assert.equal(result.photoKeys.length, 120);
});

test('puts the grid back where the user had it', async () => {
  const grid = fakeGrid({ photoCount: 120, startTop: 1200 });
  const clock = virtualClock();

  await sweepAlbumGrid({ ...grid, wait: clock.wait });

  assert.equal(grid.movedTo.at(-1), 1200, 'expected the last move to be back to the starting position');
});

test('puts the grid back even when it was stopped part way', async () => {
  const grid = fakeGrid({ photoCount: 5000, startTop: 900 });
  const clock = virtualClock();
  let calls = 0;

  const result = await sweepAlbumGrid({
    ...grid,
    wait: clock.wait,
    shouldStop: () => {
      calls += 1;
      return calls > 2;
    },
  });

  assert.equal(result.stoppedEarly, true);
  assert.equal(grid.movedTo.at(-1), 900);
});

test('keeps going as the album loads more pages while it scrolls', async () => {
  const grid = fakeGrid({ photoCount: 400, loadedPhotoCount: 40 });
  const clock = virtualClock();

  const result = await sweepAlbumGrid({ ...grid, wait: clock.wait });

  assert.equal(result.reachedBottom, true);
  assert.equal(result.photoKeys.length, 400);
});

test('reports the photos in album order', async () => {
  const grid = fakeGrid({ photoCount: 30 });
  const clock = virtualClock();

  const result = await sweepAlbumGrid({ ...grid, wait: clock.wait });

  assert.deepEqual(result.photoKeys.slice(0, 3), ['photo-0', 'photo-1', 'photo-2']);
});

test('tells "ran out of steps" apart from "reached the bottom"', async () => {
  const grid = fakeGrid({ photoCount: 5000 });
  const clock = virtualClock();

  const result = await sweepAlbumGrid({ ...grid, wait: clock.wait, maxSteps: 3 });

  assert.equal(result.reachedBottom, false, 'a sweep that ran out of steps never reached the bottom');
  assert.equal(result.steps, 3);
  assert.ok(result.photoKeys.length > 0);
});

test('waits after each scroll so the virtualised grid can redraw', async () => {
  const grid = fakeGrid({ photoCount: 120 });
  const clock = virtualClock();

  const result = await sweepAlbumGrid({ ...grid, wait: clock.wait, settleMs: 250 });

  assert.ok(result.steps > 1, 'this album needs several steps');
  assert.equal(clock.waits.length, result.steps, 'expected exactly one wait per step');
  assert.ok(
    clock.waits.every((ms) => ms === 250),
    'expected every wait to use the settle time',
  );
});

test('waits once more when it had to move to the top first', async () => {
  const grid = fakeGrid({ photoCount: 120, startTop: 3000 });
  const clock = virtualClock();

  const result = await sweepAlbumGrid({ ...grid, wait: clock.wait, settleMs: 250 });

  assert.equal(clock.waits.length, result.steps + 1, 'expected one wait per step, plus one after the move to the top');
});

test('stops when asked to, and says so', async () => {
  const grid = fakeGrid({ photoCount: 5000 });
  const clock = virtualClock();
  let calls = 0;

  const result = await sweepAlbumGrid({
    ...grid,
    wait: clock.wait,
    shouldStop: () => {
      calls += 1;
      return calls > 2;
    },
  });

  assert.equal(result.stoppedEarly, true);
  assert.equal(result.reachedBottom, false);
});

test('treats a scroll that moves nothing at the end of the grid as the bottom', async () => {
  // The real grid can report a content height the last step never quite
  // reaches. A scroll that moves nothing there is the end, not a fault.
  const atTheEnd = {
    readScrollPosition: () => ({ top: 900, viewportHeight: 800, contentHeight: 1700 }),
    scrollTo: () => {},
    readPhotoKeysOnScreen: () => ['photo-99'],
  };
  const clock = virtualClock();

  const result = await sweepAlbumGrid({ ...atTheEnd, wait: clock.wait, maxSteps: 50 });

  assert.equal(result.reachedBottom, true);
  assert.ok(result.steps < MAX_STALLED_STEPS, 'expected it to stop at once, not to stall');
});

test('gives up when the grid refuses to move and is nowhere near the end', async () => {
  const stuck = {
    readScrollPosition: () => ({ top: 0, viewportHeight: 800, contentHeight: 100000 }),
    scrollTo: () => {},
    readPhotoKeysOnScreen: () => ['photo-0'],
  };
  const clock = virtualClock();

  const result = await sweepAlbumGrid({ ...stuck, wait: clock.wait, maxSteps: 500 });

  assert.equal(result.reachedBottom, false);
  assert.equal(result.steps, MAX_STALLED_STEPS);
  assert.deepEqual(result.photoKeys, ['photo-0']);
});

test('answers at once when the whole album already fits on one screen', async () => {
  const grid = fakeGrid({ photoCount: 10, viewportHeight: 800, rowHeight: 200, photosPerRow: 5 });
  const clock = virtualClock();

  const result = await sweepAlbumGrid({ ...grid, wait: clock.wait });

  assert.equal(result.reachedBottom, true);
  assert.equal(result.steps, 0, 'nothing to step through');
  assert.equal(result.photoKeys.length, 10);
});

test('does nothing and says so when there is no grid to scroll', async () => {
  const clock = virtualClock();

  const result = await sweepAlbumGrid({
    readScrollPosition: () => null,
    scrollTo: () => {},
    readPhotoKeysOnScreen: () => [],
    wait: clock.wait,
  });

  assert.equal(result.reachedBottom, false);
  assert.deepEqual(result.photoKeys, []);
});

test('reports progress as it goes, so the panel can count up', async () => {
  const grid = fakeGrid({ photoCount: 200 });
  const clock = virtualClock();
  /** @type {number[]} */
  const seen = [];

  await sweepAlbumGrid({ ...grid, wait: clock.wait, onProgress: (progress) => seen.push(progress.photosFound) });

  assert.ok(seen.length > 1, 'expected progress more than once');
  assert.equal(seen.at(-1), 200);
  assert.deepEqual(
    [...seen].sort((a, b) => a - b),
    seen,
    'expected the count to only grow',
  );
});
