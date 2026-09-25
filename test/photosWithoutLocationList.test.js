import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { buildPhotosWithoutLocationList } from '../src/photosWithoutLocationList.js';

/** @typedef {import('../src/locationState/locationStateStore.js').PhotoLocationEntry} PhotoLocationEntry */

/**
 * @param {Partial<PhotoLocationEntry>} overrides
 * @returns {PhotoLocationEntry}
 */
function entry(overrides = {}) {
  return {
    state: 'no-location',
    checkedAt: 1,
    fileName: 'IMG_1.jpg',
    takenAt: 1620854449439,
    timeZoneOffsetMs: 7200000,
    ...overrides,
  };
}

/**
 * A complete album by default, whose order holds exactly the photos given.
 * @param {Partial<import('../src/photosWithoutLocationList.js').PhotosWithoutLocationListInput>} overrides
 * @returns {import('../src/photosWithoutLocationList.js').PhotosWithoutLocationListInput}
 */
function buildInput(overrides = {}) {
  const photos = overrides.photos ?? { P1: entry() };
  return {
    albumKey: 'album-1',
    pageUrl: 'https://photos.google.com/album/album-1',
    photos,
    order: Object.keys(photos),
    orderComplete: true,
    photosPending: 0,
    photosUnreadable: 0,
    ...overrides,
  };
}

/**
 * The photo lines only, without the `# ` header lines.
 * @param {string} text
 * @returns {string[]}
 */
function photoLines(text) {
  return text.split('\n').filter((line) => line !== '' && !line.startsWith('# '));
}

test('writes one tab-separated line per photo: local time, file name, link', () => {
  const list = buildPhotosWithoutLocationList(
    buildInput({ photos: { P1: entry({ fileName: 'IMG_20210512_232045262_HDR.jpg' }) } }),
  );

  assert.deepEqual(photoLines(list.text), [
    '2021-05-12T23:20:49+02:00\tIMG_20210512_232045262_HDR.jpg\thttps://photos.google.com/album/album-1/photo/P1',
  ]);
});

test('writes the offset of a time zone west of UTC with a minus sign', () => {
  const list = buildPhotosWithoutLocationList(
    buildInput({ photos: { P1: entry({ timeZoneOffsetMs: -(5 * 3600000 + 30 * 60000) }) } }),
  );

  assert.match(photoLines(list.text)[0] ?? '', /^2021-05-12T15:50:49-05:30\t/);
});

test('writes UTC with a Z when the time zone is not known', () => {
  const list = buildPhotosWithoutLocationList(buildInput({ photos: { P1: entry({ timeZoneOffsetMs: null }) } }));

  assert.match(photoLines(list.text)[0] ?? '', /^2021-05-12T21:20:49Z\t/);
});

test('sorts the photos from oldest to newest, and by file name when the time is the same', () => {
  const list = buildPhotosWithoutLocationList(
    buildInput({
      photos: {
        late: entry({ fileName: 'late.jpg', takenAt: 3000000 }),
        early: entry({ fileName: 'early.jpg', takenAt: 1000000 }),
        sameB: entry({ fileName: 'b.jpg', takenAt: 2000000 }),
        sameA: entry({ fileName: 'a.jpg', takenAt: 2000000 }),
      },
    }),
  );

  assert.deepEqual(
    photoLines(list.text).map((line) => line.split('\t')[1]),
    ['early.jpg', 'a.jpg', 'b.jpg', 'late.jpg'],
  );
});

test('sorts by the real moment each photo was taken, not by the local clock time', () => {
  const hour = 3600000;
  const list = buildPhotosWithoutLocationList(
    buildInput({
      photos: {
        // 10:00 UTC, which reads 20:00 on the local clock at +10:00.
        first: entry({ fileName: 'first.jpg', takenAt: Date.UTC(2021, 4, 12, 10), timeZoneOffsetMs: 10 * hour }),
        // 11:00 UTC, which reads 06:00 on the local clock at -05:00.
        second: entry({ fileName: 'second.jpg', takenAt: Date.UTC(2021, 4, 12, 11), timeZoneOffsetMs: -5 * hour }),
      },
    }),
  );

  assert.deepEqual(
    photoLines(list.text).map((line) => line.split('\t').slice(0, 2)),
    [
      ['2021-05-12T20:00:00+10:00', 'first.jpg'],
      ['2021-05-12T06:00:00-05:00', 'second.jpg'],
    ],
  );
  assert.match(list.text, /^# Sorted by the moment each photo was taken, oldest first\./m);
});

test('links each photo to itself when the page is the photo viewer', () => {
  const list = buildPhotosWithoutLocationList(
    buildInput({
      pageUrl: 'https://photos.google.com/album/A/photo/P1',
      photos: { P1: entry({ takenAt: 1620854449439 }), P2: entry({ takenAt: 1620854449440 }) },
    }),
  );

  assert.deepEqual(
    photoLines(list.text).map((line) => line.split('\t')[2]),
    ['https://photos.google.com/album/A/photo/P1', 'https://photos.google.com/album/A/photo/P2'],
  );
});

test('keeps a photo whose time is not known, at the end, marked as "time unknown"', () => {
  const list = buildPhotosWithoutLocationList(
    buildInput({
      photos: {
        noTime: entry({ fileName: 'no-time.jpg', takenAt: null }),
        timed: entry({ fileName: 'timed.jpg' }),
      },
    }),
  );

  const lines = photoLines(list.text);
  assert.equal(lines.length, 2);
  assert.equal(lines[1], 'time unknown\tno-time.jpg\thttps://photos.google.com/album/album-1/photo/noTime');
});

test('marks a photo whose file name is not known', () => {
  const list = buildPhotosWithoutLocationList(buildInput({ photos: { P1: entry({ fileName: null }) } }));

  assert.equal(photoLines(list.text)[0]?.split('\t')[1], 'file name unknown');
});

test('replaces a tab or a line break in a file name with a space, so each photo stays one line of three columns', () => {
  const list = buildPhotosWithoutLocationList(buildInput({ photos: { P1: entry({ fileName: 'a\tb\r\nc\nd.jpg' }) } }));

  const lines = photoLines(list.text);
  assert.equal(lines.length, 1);
  assert.equal(lines[0]?.split('\t')[1], 'a b  c d.jpg');
});

test('lists only the photos without a location', () => {
  const list = buildPhotosWithoutLocationList(
    buildInput({
      photos: {
        missing: entry({ fileName: 'missing.jpg' }),
        located: entry({ fileName: 'located.jpg', state: 'has-location' }),
      },
    }),
  );

  assert.deepEqual(
    photoLines(list.text).map((line) => line.split('\t')[1]),
    ['missing.jpg'],
  );
  assert.equal(list.photoCount, 1);
});

test('says how many photos the list holds', () => {
  const photos = { P1: entry(), P2: entry(), P3: entry({ state: 'has-location' }) };

  assert.match(buildPhotosWithoutLocationList(buildInput({ photos })).text, /^# 2 photos without a location$/m);
  assert.match(buildPhotosWithoutLocationList(buildInput()).text, /^# 1 photo without a location$/m);
  assert.match(buildPhotosWithoutLocationList(buildInput({ photos: {} })).text, /^# 0 photos without a location$/m);
});

test('says whether the whole album was read', () => {
  assert.match(buildPhotosWithoutLocationList(buildInput({ orderComplete: true })).text, /^# The whole album was read\.$/m);

  const partial = buildPhotosWithoutLocationList(buildInput({ orderComplete: false })).text;
  assert.match(partial, /may be incomplete/);
  assert.match(partial, /Read whole album/);
});

test('says which photos could not be read and are left out', () => {
  assert.doesNotMatch(buildPhotosWithoutLocationList(buildInput()).text, /no answer yet/);
  assert.match(
    buildPhotosWithoutLocationList(buildInput({ orderComplete: false, photosUnreadable: 4 })).text,
    /^# 4 photos have no answer yet, so this list leaves them out\./m,
  );
});

test('is not complete when the order is complete but one photo in the order has no entry', () => {
  const list = buildPhotosWithoutLocationList(buildInput({ order: ['P1', 'unread'], photosUnreadable: 1 }));

  assert.equal(list.complete, false);
  assert.doesNotMatch(list.text, /The whole album was read/);
  // The photo in the order and the photo that could not be read are the same
  // one, so the header counts it once.
  assert.match(list.text, /^# 1 photo has no answer yet, so this list leaves it out\./m);
});

test('is not complete while lookups are still pending', () => {
  const list = buildPhotosWithoutLocationList(buildInput({ photosPending: 2 }));

  assert.equal(list.complete, false);
  assert.doesNotMatch(list.text, /The whole album was read/);
  assert.match(list.text, /^# 2 photos are still waiting to be read\. Copy the list again when they are done\.$/m);
});

test('is complete only when the order is complete, every photo has an answer, and nothing is pending', () => {
  assert.equal(buildPhotosWithoutLocationList(buildInput()).complete, true);
  assert.equal(buildPhotosWithoutLocationList(buildInput({ orderComplete: false })).complete, false);
});

test('sums up what it copied for the panel', () => {
  assert.equal(buildPhotosWithoutLocationList(buildInput()).summary, 'Copied 1 photo without a location.');
  assert.equal(
    buildPhotosWithoutLocationList(buildInput({ photos: { P1: entry(), P2: entry() } })).summary,
    'Copied 2 photos without a location.',
  );
  assert.equal(
    buildPhotosWithoutLocationList(buildInput({ photosPending: 1 })).summary,
    'Copied 1 photo without a location. The list may be incomplete: its first lines say why.',
  );
});

test('says how to fill in a time or file name that an older version did not keep', () => {
  assert.doesNotMatch(buildPhotosWithoutLocationList(buildInput()).text, /Read this album again/);

  const text = buildPhotosWithoutLocationList(buildInput({ photos: { P1: entry({ takenAt: null }) } })).text;
  assert.match(text, /^# 1 photo has no time or no file name/m);
  assert.match(text, /Read this album again, then Read whole album/);
});

test('names the album in the first line', () => {
  assert.equal(buildPhotosWithoutLocationList(buildInput()).text.split('\n')[0], '# Photos without a location in album album-1');
});
