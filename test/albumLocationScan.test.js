import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { CHUNK_ATTEMPT_DELAYS_MS, scanAlbumLocations } from '../src/locationState/albumLocationScan.js';

/**
 * @param {string} mediaId
 * @param {'has-location' | 'no-location'} state
 * @returns {import('../src/locationState/mediaLocationReading.js').MediaLocationReading}
 */
function reading(mediaId, state) {
  return {
    mediaId,
    state,
    fileName: `${mediaId}.jpg`,
    takenAt: null,
    timeZoneOffsetMs: null,
    placeName: null,
    coordinates: null,
  };
}

/** @param {number} count */
function mediaIds(count) {
  return Array.from({ length: count }, (unused, index) => `media-${index}`);
}

/** Records every wait instead of sleeping, so a test with a long backoff finishes at once. */
function virtualClock() {
  /** @type {number[]} */
  const waits = [];
  return { waits, wait: async (/** @type {number} */ ms) => void waits.push(ms) };
}

test('answers every photo and counts the two verdicts', async () => {
  const clock = virtualClock();

  const result = await scanAlbumLocations({
    mediaIds: mediaIds(5),
    wait: clock.wait,
    chunkSize: 2,
    parallelRequests: 1,
    readChunk: async (chunk) =>
      new Map(chunk.map((id) => [id, reading(id, id === 'media-1' || id === 'media-4' ? 'no-location' : 'has-location')])),
  });

  assert.deepEqual(result.counts, { total: 5, withLocation: 3, withoutLocation: 2, unknown: 0 });
  assert.equal(result.states.get('media-1'), 'no-location');
  assert.equal(result.states.get('media-0'), 'has-location');
  assert.equal(result.stoppedEarly, false);
  assert.deepEqual(result.failureReasons, []);
});

test('splits the album into chunks of the size asked for', async () => {
  const clock = virtualClock();
  /** @type {number[]} */
  const chunkSizes = [];

  await scanAlbumLocations({
    mediaIds: mediaIds(250),
    wait: clock.wait,
    chunkSize: 100,
    parallelRequests: 1,
    readChunk: async (chunk) => {
      chunkSizes.push(chunk.length);
      return new Map(chunk.map((id) => [id, reading(id, 'has-location')]));
    },
  });

  assert.deepEqual(chunkSizes, [100, 100, 50]);
});

test('tries again when the request itself fails, and keeps the answers of the retry', async () => {
  const clock = virtualClock();
  let attempts = 0;

  const result = await scanAlbumLocations({
    mediaIds: mediaIds(2),
    wait: clock.wait,
    chunkSize: 2,
    readChunk: async (chunk) => {
      attempts += 1;
      if (attempts === 1) throw new Error('network down');
      return new Map(chunk.map((id) => [id, reading(id, 'no-location')]));
    },
  });

  assert.equal(attempts, 2);
  assert.equal(result.counts.withoutLocation, 2);
  assert.equal(result.counts.unknown, 0);
  assert.equal(result.failureReasons.length, 1);
  assert.match(String(result.failureReasons[0]), /network down/);
});

test('waits longer before each further attempt', async () => {
  const clock = virtualClock();

  await scanAlbumLocations({
    mediaIds: mediaIds(1),
    wait: clock.wait,
    chunkSize: 1,
    readChunk: async () => {
      throw new Error('still down');
    },
  });

  assert.deepEqual(
    clock.waits,
    CHUNK_ATTEMPT_DELAYS_MS.filter((ms) => ms > 0),
  );
});

test('asks again only about the photos that did not answer', async () => {
  const clock = virtualClock();
  /** @type {string[][]} */
  const asked = [];

  const result = await scanAlbumLocations({
    mediaIds: mediaIds(3),
    wait: clock.wait,
    chunkSize: 3,
    readChunk: async (chunk) => {
      asked.push([...chunk]);
      // media-2 is unreadable the first time and fine the second time.
      return new Map(chunk.map((id) => [id, id === 'media-2' && asked.length === 1 ? null : reading(id, 'has-location')]));
    },
  });

  assert.deepEqual(asked, [['media-0', 'media-1', 'media-2'], ['media-2']]);
  assert.equal(result.counts.withLocation, 3);
});

test('never turns a photo it could not read into "no location"', async () => {
  const clock = virtualClock();

  const result = await scanAlbumLocations({
    mediaIds: mediaIds(2),
    wait: clock.wait,
    chunkSize: 2,
    readChunk: async (chunk) => new Map(chunk.map((id) => [id, null])),
  });

  assert.deepEqual(result.counts, { total: 2, withLocation: 0, withoutLocation: 0, unknown: 2 });
  assert.equal(result.states.get('media-0'), 'unknown');
});

test('stops when asked to, and says so', async () => {
  const clock = virtualClock();
  let chunksRead = 0;

  const result = await scanAlbumLocations({
    mediaIds: mediaIds(10),
    wait: clock.wait,
    chunkSize: 2,
    parallelRequests: 1,
    shouldStop: () => chunksRead >= 2,
    readChunk: async (chunk) => {
      chunksRead += 1;
      return new Map(chunk.map((id) => [id, reading(id, 'has-location')]));
    },
  });

  assert.equal(result.stoppedEarly, true);
  assert.equal(chunksRead, 2);
  assert.ok(result.counts.withLocation < 10);
});

test('reports progress as the counts grow', async () => {
  const clock = virtualClock();
  /** @type {number[]} */
  const seen = [];

  await scanAlbumLocations({
    mediaIds: mediaIds(4),
    wait: clock.wait,
    chunkSize: 2,
    parallelRequests: 1,
    onProgress: (counts) => seen.push(counts.withLocation + counts.withoutLocation),
    readChunk: async (chunk) => new Map(chunk.map((id) => [id, reading(id, 'has-location')])),
  });

  assert.deepEqual(seen.at(-1), 4);
  assert.ok(seen.length >= 2, 'expected progress more than once');
});

test('keeps the full reading, so the report can name the place and the file', async () => {
  const clock = virtualClock();

  const result = await scanAlbumLocations({
    mediaIds: ['media-0'],
    wait: clock.wait,
    readChunk: async () =>
      new Map([
        [
          'media-0',
          {
            mediaId: 'media-0',
            state: /** @type {const} */ ('has-location'),
            fileName: 'IMG_1.jpg',
            takenAt: null,
            timeZoneOffsetMs: null,
            placeName: 'Khemical',
            coordinates: { latitude: 5.34, longitude: -0.62 },
          },
        ],
      ]),
  });

  assert.equal(result.readings.get('media-0')?.placeName, 'Khemical');
});
