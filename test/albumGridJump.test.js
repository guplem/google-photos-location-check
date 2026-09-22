import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { jumpToPhotoWithoutLocation } from '../src/albumGrid/albumGridJump.js';

/**
 * A stand-in for the virtualised album grid, plus the lazy lookups that answer
 * for it.
 *
 * It behaves the way the real pair does in the two ways that matter here: only
 * the thumbnails near the scroll position exist at any moment, and a photo has
 * no verdict at all until somebody has asked about it.
 * @param {object} options
 * @param {number} options.photoCount
 * @param {readonly string[]} [options.withoutLocation]  Photos that carry no location.
 * @param {number} [options.viewportHeight]
 * @param {number} [options.rowHeight]
 * @param {number} [options.photosPerRow]
 * @param {number} [options.startTop]  Where the user had scrolled to.
 * @param {boolean} [options.frozen]   A grid that refuses to move, whatever it is asked.
 */
function fakeGrid({
  photoCount,
  withoutLocation = [],
  viewportHeight = 800,
  rowHeight = 200,
  photosPerRow = 5,
  startTop = 0,
  frozen = false,
}) {
  const contentHeight = Math.ceil(photoCount / photosPerRow) * rowHeight;

  const grid = {
    top: startTop,
    /** @type {number[]} */
    movedTo: [],
    /** @type {Set<string>} Photos somebody has asked about. */
    askedAbout: new Set(),

    readScrollPosition: () => ({ top: grid.top, viewportHeight, contentHeight }),

    scrollTo: (/** @type {number} */ top) => {
      grid.movedTo.push(top);
      if (frozen) return;
      grid.top = Math.max(0, Math.min(top, Math.max(0, contentHeight - viewportHeight)));
    },

    readPhotoKeysOnScreen: () => {
      const firstRow = Math.floor(grid.top / rowHeight);
      const lastRow = Math.ceil((grid.top + viewportHeight) / rowHeight);
      /** @type {string[]} */
      const keys = [];
      for (let index = firstRow * photosPerRow; index < Math.min(lastRow * photosPerRow, photoCount); index++) {
        keys.push('photo-' + String(index));
      }
      return keys;
    },

    waitForVerdicts: async (/** @type {readonly string[]} */ photoKeys) => {
      for (const photoKey of photoKeys) grid.askedAbout.add(photoKey);
    },

    /** @returns {'has-location' | 'no-location' | null} */
    readState: (/** @type {string} */ photoKey) => {
      if (!grid.askedAbout.has(photoKey)) return null;
      return withoutLocation.includes(photoKey) ? 'no-location' : 'has-location';
    },
  };
  return grid;
}

/** Records every wait instead of sleeping, so a long walk finishes at once. */
function virtualClock() {
  /** @type {number[]} */
  const waits = [];
  return { waits, wait: async (/** @type {number} */ ms) => void waits.push(ms) };
}

test('stops on the first photo without a location on the screen the user is already looking at', async () => {
  const grid = fakeGrid({ photoCount: 120, withoutLocation: ['photo-7', 'photo-30'] });
  const clock = virtualClock();

  const result = await jumpToPhotoWithoutLocation({
    ...grid,
    direction: 'next',
    fromPhotoKey: null,
    wait: clock.wait,
  });

  assert.equal(result.photoKey, 'photo-7');
  assert.equal(result.steps, 0, 'expected no scrolling for a photo that is already on screen');
  assert.equal(grid.top, 0);
});

test('walks down screen by screen to a photo far below, asking about every screen on the way', async () => {
  const grid = fakeGrid({ photoCount: 400, withoutLocation: ['photo-250'] });
  const clock = virtualClock();

  const result = await jumpToPhotoWithoutLocation({
    ...grid,
    direction: 'next',
    fromPhotoKey: null,
    wait: clock.wait,
  });

  assert.equal(result.photoKey, 'photo-250');
  assert.ok(result.steps > 0, 'expected the walk to have scrolled');
  assert.ok(grid.top > 0, 'expected the user to be left at the photo, not back at the start');
  assert.ok(grid.askedAbout.has('photo-250'), 'expected the walk to ask about the photos it uncovered');
});

test('a second press moves past the photo the first one landed on', async () => {
  const grid = fakeGrid({ photoCount: 120, withoutLocation: ['photo-7', 'photo-9'] });
  const clock = virtualClock();

  const result = await jumpToPhotoWithoutLocation({
    ...grid,
    direction: 'next',
    fromPhotoKey: 'photo-7',
    wait: clock.wait,
  });

  assert.equal(result.photoKey, 'photo-9');
});

test('searches the whole screen again when the photo it last landed on is nowhere near', async () => {
  const grid = fakeGrid({ photoCount: 400, withoutLocation: ['photo-102'], startTop: 4000 });
  const clock = virtualClock();

  const result = await jumpToPhotoWithoutLocation({
    ...grid,
    direction: 'next',
    // A photo from a screen the user has long since scrolled away from.
    fromPhotoKey: 'photo-3',
    wait: clock.wait,
  });

  assert.equal(result.photoKey, 'photo-102');
});

test('puts the grid back where it found it when there is nothing left to find', async () => {
  const grid = fakeGrid({ photoCount: 200, withoutLocation: [], startTop: 1600 });
  const clock = virtualClock();

  const result = await jumpToPhotoWithoutLocation({
    ...grid,
    direction: 'next',
    fromPhotoKey: null,
    wait: clock.wait,
  });

  assert.equal(result.photoKey, null);
  assert.equal(result.reachedEnd, true, 'expected the grid itself to have said there was no more');
  assert.equal(grid.top, 1600, 'expected the user to be put back where they were');
});

test('walks up to the photo without a location that comes before the screen', async () => {
  const grid = fakeGrid({ photoCount: 400, withoutLocation: ['photo-20'], startTop: 8000 });
  const clock = virtualClock();

  const result = await jumpToPhotoWithoutLocation({
    ...grid,
    direction: 'previous',
    fromPhotoKey: null,
    wait: clock.wait,
  });

  assert.equal(result.photoKey, 'photo-20');
  assert.ok(grid.top < 8000, 'expected the walk to have moved up');
});

test('walking up takes the last photo without a location on a screen, not the first', async () => {
  const grid = fakeGrid({ photoCount: 400, withoutLocation: ['photo-100', 'photo-103'], startTop: 8000 });
  const clock = virtualClock();

  const result = await jumpToPhotoWithoutLocation({
    ...grid,
    direction: 'previous',
    fromPhotoKey: null,
    wait: clock.wait,
  });

  assert.equal(result.photoKey, 'photo-103', 'expected the nearest one going up');
});

test('walking up from the top of the album leaves the grid where it was', async () => {
  const grid = fakeGrid({ photoCount: 200, withoutLocation: [] });
  const clock = virtualClock();

  const result = await jumpToPhotoWithoutLocation({
    ...grid,
    direction: 'previous',
    fromPhotoKey: null,
    wait: clock.wait,
  });

  assert.equal(result.photoKey, null);
  assert.equal(result.reachedEnd, true);
  assert.equal(grid.top, 0);
});

test('stops when the caller asks it to, and does not call that the end', async () => {
  const grid = fakeGrid({ photoCount: 400, withoutLocation: ['photo-390'], startTop: 400 });
  const clock = virtualClock();
  let calls = 0;

  const result = await jumpToPhotoWithoutLocation({
    ...grid,
    direction: 'next',
    fromPhotoKey: null,
    wait: clock.wait,
    shouldStop: () => {
      calls += 1;
      return calls > 3;
    },
  });

  assert.equal(result.photoKey, null);
  assert.equal(result.stoppedEarly, true);
  assert.equal(result.reachedEnd, false, 'a walk that was stopped has not seen the end');
  assert.equal(grid.top, 400, 'expected the user to be put back where they were');
});

test('gives up on a grid that refuses to move, without calling it the end', async () => {
  const grid = fakeGrid({ photoCount: 400, withoutLocation: ['photo-390'], startTop: 400, frozen: true });
  const clock = virtualClock();

  const result = await jumpToPhotoWithoutLocation({ ...grid, direction: 'next', fromPhotoKey: null, wait: clock.wait });

  assert.equal(result.photoKey, null);
  assert.equal(result.reachedEnd, false);
  assert.ok(result.steps < 10, 'expected the walk to give up quickly, not to keep pushing a dead grid');
});

test('does nothing at all when there is no grid on the page', async () => {
  const clock = virtualClock();
  let scrolled = 0;

  const result = await jumpToPhotoWithoutLocation({
    direction: 'next',
    fromPhotoKey: null,
    readPhotoKeysOnScreen: () => [],
    waitForVerdicts: async () => {},
    readState: () => null,
    readScrollPosition: () => null,
    scrollTo: () => void (scrolled += 1),
    wait: clock.wait,
  });

  assert.deepEqual(result, { photoKey: null, reachedEnd: false, stoppedEarly: false, steps: 0 });
  assert.equal(scrolled, 0);
});

test('judges a screen only once every photo on it has a verdict', async () => {
  const grid = fakeGrid({ photoCount: 400, withoutLocation: ['photo-200'] });
  const clock = virtualClock();
  /** @type {string[]} */
  const order = [];

  const result = await jumpToPhotoWithoutLocation({
    ...grid,
    direction: 'next',
    fromPhotoKey: null,
    wait: clock.wait,
    waitForVerdicts: async (photoKeys) => {
      order.push('asked');
      await grid.waitForVerdicts(photoKeys);
    },
    readState: (photoKey) => {
      order.push('read');
      return grid.readState(photoKey);
    },
  });

  assert.equal(result.photoKey, 'photo-200');
  assert.equal(order[0], 'asked', 'expected the walk to ask before it read anything');
});
