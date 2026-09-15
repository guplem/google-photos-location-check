import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { createLocationLookupQueue } from '../src/locationState/locationLookupQueue.js';

/**
 * @param {Record<string, import('../src/locationState/albumLocationScan.js').PhotoLocationState>} states
 * @returns {import('../src/locationState/albumLocationScan.js').AlbumLocationScanResult}
 */
function scanResult(states) {
  const entries = Object.entries(states);
  return {
    states: new Map(entries),
    readings: new Map(),
    counts: {
      total: entries.length,
      withLocation: entries.filter(([, state]) => state === 'has-location').length,
      withoutLocation: entries.filter(([, state]) => state === 'no-location').length,
      unknown: entries.filter(([, state]) => state === 'unknown').length,
    },
    stoppedEarly: false,
    failureReasons: [],
  };
}

/** A queue plus the knobs a test needs to steer it. */
function buildQueue(
  /** @type {{ lookUp: (ids: readonly string[]) => Promise<import('../src/locationState/albumLocationScan.js').AlbumLocationScanResult> }} */ options,
) {
  /** @type {Set<string>} */
  const known = new Set();
  /** @type {string[][]} */
  const asked = [];
  /** @type {unknown[]} */
  const errors = [];

  const queue = createLocationLookupQueue({
    isKnown: (mediaId) => known.has(mediaId),
    lookUp: async (mediaIds) => {
      asked.push([...mediaIds]);
      return options.lookUp(mediaIds);
    },
    onResults: (result) => {
      for (const [mediaId, state] of result.states) if (state !== 'unknown') known.add(mediaId);
    },
    onError: (error) => errors.push(error),
  });

  return { queue, known, asked, errors };
}

/** @param {readonly string[]} ids */
const allFound = (ids) => scanResult(Object.fromEntries(ids.map((id) => [id, /** @type {const} */ ('no-location')])));

test('asks about each photo once, however many times the grid offers it', async () => {
  const { queue, asked } = buildQueue({ lookUp: async (ids) => allFound(ids) });

  queue.enqueue(['a', 'b']);
  queue.enqueue(['a', 'b', 'c']);
  await queue.drain();

  assert.deepEqual(asked, [['a', 'b', 'c']]);
});

test('never asks again about a photo the store already answered', async () => {
  const { queue, known, asked } = buildQueue({ lookUp: async (ids) => allFound(ids) });

  known.add('a');
  assert.equal(queue.enqueue(['a', 'b']), 1);
  await queue.drain();

  assert.deepEqual(asked, [['b']]);
});

test('runs one lookup at a time, even when drained from several places at once', async () => {
  /** @type {(value: unknown) => void} */
  let release = () => {};
  const blocked = new Promise((resolve) => {
    release = resolve;
  });
  let inFlight = 0;
  let highWaterMark = 0;

  const { queue } = buildQueue({
    lookUp: async (ids) => {
      inFlight += 1;
      highWaterMark = Math.max(highWaterMark, inFlight);
      await blocked;
      inFlight -= 1;
      return allFound(ids);
    },
  });

  queue.enqueue(['a']);
  const first = queue.drain();
  queue.enqueue(['b']);
  const second = queue.drain();
  release(undefined);
  await Promise.all([first, second]);

  assert.equal(highWaterMark, 1);
});

test('picks up photos that arrived while a lookup was running', async () => {
  /** @type {(value: unknown) => void} */
  let release = () => {};
  const blocked = new Promise((resolve) => {
    release = resolve;
  });
  let firstCall = true;

  const { queue, asked } = buildQueue({
    lookUp: async (ids) => {
      if (firstCall) {
        firstCall = false;
        await blocked;
      }
      return allFound(ids);
    },
  });

  queue.enqueue(['a']);
  const running = queue.drain();
  queue.enqueue(['b']);
  release(undefined);
  await running;

  assert.deepEqual(asked, [['a'], ['b']]);
});

test('puts a photo it could not read back in the queue', async () => {
  const { queue } = buildQueue({ lookUp: async () => scanResult({ a: 'unknown' }) });

  queue.enqueue(['a']);
  await queue.drain();

  assert.equal(queue.pendingCount(), 1);
});

test('keeps the whole batch when the lookup throws, and reports the error', async () => {
  const { queue, errors } = buildQueue({
    lookUp: async () => {
      throw new Error('extension context invalidated');
    },
  });

  queue.enqueue(['a', 'b']);
  await queue.drain();

  assert.equal(queue.pendingCount(), 2);
  assert.equal(errors.length, 1);
});

test('does nothing when there is nothing to ask about', async () => {
  const { queue, asked } = buildQueue({ lookUp: async (ids) => allFound(ids) });

  await queue.drain();

  assert.deepEqual(asked, []);
});

test('ignores an empty media id', async () => {
  const { queue } = buildQueue({ lookUp: async (ids) => allFound(ids) });

  assert.equal(queue.enqueue(['', '']), 0);
  assert.equal(queue.pendingCount(), 0);
});
