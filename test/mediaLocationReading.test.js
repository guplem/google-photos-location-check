import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { readMediaLocation } from '../src/locationState/mediaLocationReading.js';

const MEDIA_ID = 'AF1QipOWaXOkxyXOppoobg20_n0XR_4CkxulyVdIeyli';

/**
 * Builds a photo answer the same shape a real one has: a long array whose
 * useful indexes are 0, 2, 3, 4 and 13. The lengths and the filler match a real
 * `fDcn4b` answer captured from an album.
 * @param {object} options
 * @param {unknown} options.location
 * @param {string} [options.mediaId]
 * @param {string} [options.fileName]
 * @param {unknown} [options.takenAt]
 * @param {unknown} [options.timeZoneOffsetMs]
 * @returns {unknown[]}
 */
function buildAnswer({
  location,
  mediaId = MEDIA_ID,
  fileName = 'IMG20260816154357.jpg',
  takenAt = 1786881120000,
  timeZoneOffsetMs = 7200000,
}) {
  const photo = new Array(34).fill(null);
  photo[0] = mediaId;
  photo[1] = '';
  photo[2] = fileName;
  photo[3] = takenAt;
  photo[4] = timeZoneOffsetMs;
  photo[13] = location;
  return [photo];
}

/** A location exactly as Google sends it: coordinates, a flag, then place entries. */
const KHEMICAL_LOCATION = [
  [53443938, -6220715],
  false,
  [
    [null, [['Khemical', null, 4, false, false]], '0xfde356447459e41:0xa7bf38eb0919a919'],
    [null, [['Khemical', null, 4, false, false]], '0xfde356447459e41:0xa7bf38eb0919a919'],
  ],
];

test('reads a photo that carries a location, with its place name and degrees', () => {
  const reading = readMediaLocation(buildAnswer({ location: KHEMICAL_LOCATION }), MEDIA_ID);

  assert.deepEqual(reading, {
    mediaId: MEDIA_ID,
    state: 'has-location',
    fileName: 'IMG20260816154357.jpg',
    takenAt: 1786881120000,
    timeZoneOffsetMs: 7200000,
    placeName: 'Khemical',
    coordinates: { latitude: 5.3443938, longitude: -0.6220715 },
  });
});

test('reads a photo that carries no location', () => {
  const reading = readMediaLocation(buildAnswer({ location: null }), MEDIA_ID);

  assert.deepEqual(reading, {
    mediaId: MEDIA_ID,
    state: 'no-location',
    fileName: 'IMG20260816154357.jpg',
    takenAt: 1786881120000,
    timeZoneOffsetMs: 7200000,
    placeName: null,
    coordinates: null,
  });
});

test('still reports the location when only one place entry is present', () => {
  const singleEntry = [[53546729, -6253400], false, [[null, [['Winneba, Ghana', null, 1, false, false]], '0xfde:0x4a1']]];

  const reading = readMediaLocation(buildAnswer({ location: singleEntry }), MEDIA_ID);

  assert.equal(reading?.state, 'has-location');
  assert.equal(reading?.placeName, 'Winneba, Ghana');
});

test('still reports the location when the place name is missing', () => {
  const noNames = [[53443938, -6220715], false, []];

  const reading = readMediaLocation(buildAnswer({ location: noNames }), MEDIA_ID);

  assert.equal(reading?.state, 'has-location');
  assert.equal(reading?.placeName, null);
});

test('answers "cannot tell" when the answer belongs to another photo', () => {
  const answer = buildAnswer({ location: KHEMICAL_LOCATION, mediaId: 'AF1QipSomeOtherPhoto' });

  assert.equal(readMediaLocation(answer, MEDIA_ID), null);
});

test('answers "cannot tell" when index 13 holds something that is not a location', () => {
  // This is the drift case. Reading it as "no location" would badge a whole
  // album as missing after one Google release.
  for (const drifted of [42, 'a string', [], [['not', 'coordinates']], {}]) {
    assert.equal(
      readMediaLocation(buildAnswer({ location: drifted }), MEDIA_ID),
      null,
      `expected null for ${JSON.stringify(drifted)}`,
    );
  }
});

test('answers "cannot tell" when the photo array is too short to hold index 13', () => {
  const shortPhoto = [MEDIA_ID, '', 'name.jpg'];

  assert.equal(readMediaLocation([shortPhoto], MEDIA_ID), null);
});

test('answers "cannot tell" for a payload that is not a photo answer at all', () => {
  for (const notAnAnswer of [null, undefined, 'text', 7, {}, [], [null]]) {
    assert.equal(readMediaLocation(notAnAnswer, MEDIA_ID), null);
  }
});

test('reports a missing file name as null rather than an empty string', () => {
  const reading = readMediaLocation(buildAnswer({ location: null, fileName: '' }), MEDIA_ID);

  assert.equal(reading?.fileName, null);
});

test('reads when the photo was taken and the offset of its time zone', () => {
  // Captured from a real album: 21:20:49 UTC at +02:00, which is the 23:20:49
  // in the file name.
  const reading = readMediaLocation(
    buildAnswer({
      location: null,
      fileName: 'IMG_20210512_232045262_HDR.jpg',
      takenAt: 1620854449439,
      timeZoneOffsetMs: 7200000,
    }),
    MEDIA_ID,
  );

  assert.equal(reading?.takenAt, 1620854449439);
  assert.equal(reading?.timeZoneOffsetMs, 7200000);
});

test('reports a time it cannot read as null and keeps the verdict', () => {
  for (const notATime of [null, 'yesterday', Number.NaN, Number.POSITIVE_INFINITY, [1620854449439]]) {
    const reading = readMediaLocation(buildAnswer({ location: null, takenAt: notATime, timeZoneOffsetMs: notATime }), MEDIA_ID);

    assert.equal(reading?.state, 'no-location', `expected a verdict for ${String(notATime)}`);
    assert.equal(reading?.takenAt, null);
    assert.equal(reading?.timeZoneOffsetMs, null);
  }
});

test('keeps a zero time zone offset, because UTC is a real offset', () => {
  const reading = readMediaLocation(buildAnswer({ location: null, timeZoneOffsetMs: 0 }), MEDIA_ID);

  assert.equal(reading?.timeZoneOffsetMs, 0);
});
