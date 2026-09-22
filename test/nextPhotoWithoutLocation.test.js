import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { findNextPhotoWithoutLocation } from '../src/locationState/nextPhotoWithoutLocation.js';

/**
 * Builds the verdict reader the search takes, from the two lists a test cares
 * about. Anything in neither list has not been read yet.
 * @param {readonly string[]} withoutLocation
 * @param {readonly string[]} withLocation
 */
function verdicts(withoutLocation, withLocation) {
  return (/** @type {string} */ photoKey) => {
    if (withoutLocation.includes(photoKey)) return 'no-location';
    if (withLocation.includes(photoKey)) return 'has-location';
    return null;
  };
}

const ALBUM = ['p1', 'p2', 'p3', 'p4', 'p5'];

test('finds the next photo without a location after the one the user is looking at', () => {
  const result = findNextPhotoWithoutLocation({
    order: ALBUM,
    fromPhotoKey: 'p2',
    direction: 'next',
    readState: verdicts(['p1', 'p4'], ['p2', 'p3', 'p5']),
  });

  assert.deepEqual(result, { outcome: 'found', photoKey: 'p4' });
});

test('finds the previous one by walking the other way', () => {
  const result = findNextPhotoWithoutLocation({
    order: ALBUM,
    fromPhotoKey: 'p4',
    direction: 'previous',
    readState: verdicts(['p1', 'p2'], ['p3', 'p4', 'p5']),
  });

  assert.deepEqual(result, { outcome: 'found', photoKey: 'p2' });
});

test('never hands back the photo the user is already looking at', () => {
  const result = findNextPhotoWithoutLocation({
    order: ALBUM,
    fromPhotoKey: 'p3',
    direction: 'next',
    readState: verdicts(['p3'], ['p1', 'p2', 'p4', 'p5']),
  });

  assert.deepEqual(result, { outcome: 'none-that-way', photoKey: null });
});

test('says there is none that way when the album ends first', () => {
  const result = findNextPhotoWithoutLocation({
    order: ALBUM,
    fromPhotoKey: 'p5',
    direction: 'next',
    readState: verdicts(['p1'], ['p2', 'p3', 'p4', 'p5']),
  });

  assert.deepEqual(result, { outcome: 'none-that-way', photoKey: null });
});

test('walks past a photo nobody has read yet', () => {
  const result = findNextPhotoWithoutLocation({
    order: ALBUM,
    fromPhotoKey: 'p1',
    direction: 'next',
    // p2 and p3 have no verdict at all, p4 has none of its own.
    readState: verdicts(['p4'], ['p1', 'p5']),
  });

  assert.deepEqual(result, { outcome: 'found', photoKey: 'p4' });
});

test('tells "this album was never read" apart from "there is none left"', () => {
  const result = findNextPhotoWithoutLocation({
    order: [],
    fromPhotoKey: 'p1',
    direction: 'next',
    readState: verdicts([], []),
  });

  assert.deepEqual(result, { outcome: 'photo-not-in-order', photoKey: null });
});

test('reports a photo the sweep never saw as missing from the order', () => {
  const result = findNextPhotoWithoutLocation({
    order: ALBUM,
    // Added to the album after the sweep ran.
    fromPhotoKey: 'p6',
    direction: 'next',
    readState: verdicts(['p6'], []),
  });

  assert.deepEqual(result, { outcome: 'photo-not-in-order', photoKey: null });
});
