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

/** @param {Partial<import('../src/photosWithoutLocationList.js').PhotosWithoutLocationListInput>} overrides */
function buildInput(overrides = {}) {
  return {
    albumKey: 'album-1',
    pageUrl: 'https://photos.google.com/album/album-1',
    photos: { P1: entry() },
    orderComplete: true,
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
  assert.doesNotMatch(buildPhotosWithoutLocationList(buildInput()).text, /could not be read/);
  assert.match(buildPhotosWithoutLocationList(buildInput({ photosUnreadable: 4 })).text, /^# 4 photos could not be read/m);
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
