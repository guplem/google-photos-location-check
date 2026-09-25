import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import {
  albumStorageKey,
  applyPhotoStates,
  createLocationStateStore,
  LOCATION_STATE_KEY_PREFIX,
  normalizeAlbumRecord,
  summarizeAlbumRecord,
} from '../src/locationState/locationStateStore.js';

/** A stand-in for `chrome.storage.local` that lives in memory. */
function fakeStorageArea(/** @type {Record<string, unknown>} */ initial = {}) {
  /** @type {Record<string, unknown>} */
  const data = { ...initial };
  return /** @type {chrome.storage.StorageArea} */ (
    /** @type {unknown} */ ({
      data,
      get: async (/** @type {string | null} */ key) => (key === null ? { ...data } : { [key]: data[key] }),
      set: async (/** @type {Record<string, unknown>} */ values) => void Object.assign(data, values),
      remove: async (/** @type {string | string[]} */ keys) => {
        for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key];
      },
    })
  );
}

test('names one storage key per album', () => {
  assert.equal(albumStorageKey('album-1'), `${LOCATION_STATE_KEY_PREFIX}album-1`);
});

test('reads back what it wrote', async () => {
  const store = createLocationStateStore(fakeStorageArea());

  await store.mergePhotoStates('album-1', new Map([['photo-a', 'no-location']]), 1000);
  const record = await store.readAlbum('album-1');

  assert.deepEqual(record.photos['photo-a'], {
    state: 'no-location',
    checkedAt: 1000,
    fileName: null,
    takenAt: null,
    timeZoneOffsetMs: null,
  });
  assert.equal(record.updatedAt, 1000);
});

test('merges new verdicts into the ones already stored', async () => {
  const store = createLocationStateStore(fakeStorageArea());

  await store.mergePhotoStates('album-1', new Map([['photo-a', 'no-location']]), 1000);
  await store.mergePhotoStates('album-1', new Map([['photo-b', 'has-location']]), 2000);
  const record = await store.readAlbum('album-1');

  assert.equal(Object.keys(record.photos).length, 2);
  assert.equal(record.photos['photo-a']?.state, 'no-location');
  assert.equal(record.photos['photo-b']?.state, 'has-location');
});

test('never stores "unknown", so the next visit asks again', async () => {
  const storage = fakeStorageArea();
  const store = createLocationStateStore(storage);

  await store.mergePhotoStates(
    'album-1',
    new Map([
      ['photo-a', 'unknown'],
      ['photo-b', 'no-location'],
    ]),
    1000,
  );
  const record = await store.readAlbum('album-1');

  assert.equal(record.photos['photo-a'], undefined);
  assert.equal(record.photos['photo-b']?.state, 'no-location');
});

test('writes nothing at all when a batch holds no verdict', async () => {
  const storage = fakeStorageArea();
  const store = createLocationStateStore(storage);

  await store.mergePhotoStates('album-1', new Map([['photo-a', 'unknown']]), 1000);

  assert.deepEqual(await storage.get(null), {});
});

test('returns an empty record for an album never looked at', async () => {
  const store = createLocationStateStore(fakeStorageArea());

  assert.deepEqual(await store.readAlbum('never-seen'), {
    albumKey: 'never-seen',
    updatedAt: 0,
    photos: {},
    order: [],
    orderComplete: false,
  });
});

test('repairs anything stored that is not a record we wrote', () => {
  for (const broken of [null, 7, 'text', [], { photos: 'not an object' }]) {
    assert.deepEqual(normalizeAlbumRecord('album-1', broken), {
      albumKey: 'album-1',
      updatedAt: 0,
      photos: {},
      order: [],
      orderComplete: false,
    });
  }
});

test('drops a photo entry whose state is not one we know', () => {
  const record = normalizeAlbumRecord('album-1', {
    updatedAt: 5,
    photos: {
      good: { state: 'no-location', checkedAt: 9 },
      fromAnOlderVersion: { state: 'saved', checkedAt: 9 },
      notAnObject: 'nonsense',
      missingClock: { state: 'has-location' },
    },
  });

  assert.deepEqual(Object.keys(record.photos).sort(), ['good', 'missingClock']);
  assert.equal(record.photos['missingClock']?.checkedAt, 0);
});

test('an entry written by an older version has no file name and no time', () => {
  const record = normalizeAlbumRecord('album-1', { photos: { old: { state: 'no-location', checkedAt: 9 } } });

  assert.deepEqual(record.photos['old'], {
    state: 'no-location',
    checkedAt: 9,
    fileName: null,
    takenAt: null,
    timeZoneOffsetMs: null,
  });
});

test('repairs a stored file name or time that is not one', () => {
  const record = normalizeAlbumRecord('album-1', {
    photos: {
      good: { state: 'no-location', checkedAt: 9, fileName: 'IMG_1.jpg', takenAt: 1620854449439, timeZoneOffsetMs: 0 },
      broken: { state: 'no-location', checkedAt: 9, fileName: '', takenAt: 'noon', timeZoneOffsetMs: null },
    },
  });

  assert.deepEqual(record.photos['good'], {
    state: 'no-location',
    checkedAt: 9,
    fileName: 'IMG_1.jpg',
    takenAt: 1620854449439,
    timeZoneOffsetMs: 0,
  });
  assert.equal(record.photos['broken']?.fileName, null);
  assert.equal(record.photos['broken']?.takenAt, null);
  assert.equal(record.photos['broken']?.timeZoneOffsetMs, null);
});

test('remembers the file name and the time of each photo it reads', async () => {
  const store = createLocationStateStore(fakeStorageArea());

  await store.mergePhotoStates(
    'album-1',
    new Map([['photo-a', 'no-location']]),
    1000,
    new Map([['photo-a', { fileName: 'IMG_1.jpg', takenAt: 1620854449439, timeZoneOffsetMs: 7200000 }]]),
  );
  const record = await store.readAlbum('album-1');

  assert.deepEqual(record.photos['photo-a'], {
    state: 'no-location',
    checkedAt: 1000,
    fileName: 'IMG_1.jpg',
    takenAt: 1620854449439,
    timeZoneOffsetMs: 7200000,
  });
});

test('keeps a remembered file name and time when a new verdict brings none', async () => {
  const store = createLocationStateStore(fakeStorageArea());
  await store.mergePhotoStates(
    'album-1',
    new Map([['photo-a', 'no-location']]),
    1000,
    new Map([['photo-a', { fileName: 'IMG_1.jpg', takenAt: 5, timeZoneOffsetMs: 0 }]]),
  );

  await store.mergePhotoStates('album-1', new Map([['photo-a', 'has-location']]), 2000);

  const entry = (await store.readAlbum('album-1')).photos['photo-a'];
  assert.equal(entry?.state, 'has-location');
  assert.equal(entry?.fileName, 'IMG_1.jpg');
  assert.equal(entry?.takenAt, 5);
});

test('applies verdicts to a record in memory the same way the store does', () => {
  const record = normalizeAlbumRecord('album-1', {});

  const changed = applyPhotoStates(
    record,
    new Map([
      ['photo-a', 'no-location'],
      ['photo-b', 'unknown'],
    ]),
    1000,
    new Map([['photo-a', { fileName: 'IMG_1.jpg', takenAt: 5, timeZoneOffsetMs: 0 }]]),
  );

  assert.equal(changed, true);
  assert.equal(record.photos['photo-a']?.fileName, 'IMG_1.jpg');
  assert.equal(record.photos['photo-b'], undefined, 'expected "unknown" never to reach the record');
});

test('merges the time and its offset as a pair, and the file name on its own', () => {
  /** @typedef {import('../src/locationState/locationStateStore.js').PhotoDetails} PhotoDetails */
  /** @type {PhotoDetails} */
  const known = { fileName: 'old.jpg', takenAt: 1000, timeZoneOffsetMs: 7200000 };
  /** @type {{ name: string, known: PhotoDetails, read: PhotoDetails | undefined, expected: PhotoDetails }[]} */
  const cases = [
    {
      name: 'a new read replaces the old details',
      known,
      read: { fileName: 'new.jpg', takenAt: 2000, timeZoneOffsetMs: 3600000 },
      expected: { fileName: 'new.jpg', takenAt: 2000, timeZoneOffsetMs: 3600000 },
    },
    {
      name: 'a read with no details keeps the old ones',
      known,
      read: undefined,
      expected: known,
    },
    {
      name: 'a read with a file name but no time keeps the old time pair',
      known,
      read: { fileName: 'new.jpg', takenAt: null, timeZoneOffsetMs: 3600000 },
      expected: { fileName: 'new.jpg', takenAt: 1000, timeZoneOffsetMs: 7200000 },
    },
    {
      name: 'a new time with no offset never pairs with the old offset',
      known,
      read: { fileName: null, takenAt: 2000, timeZoneOffsetMs: null },
      expected: { fileName: 'old.jpg', takenAt: 2000, timeZoneOffsetMs: null },
    },
    {
      name: 'a remembered offset of 0 survives',
      known: { fileName: 'old.jpg', takenAt: 1000, timeZoneOffsetMs: 0 },
      read: { fileName: null, takenAt: null, timeZoneOffsetMs: null },
      expected: { fileName: 'old.jpg', takenAt: 1000, timeZoneOffsetMs: 0 },
    },
  ];

  for (const testCase of cases) {
    const record = normalizeAlbumRecord('album-1', {});
    const verdict = new Map([['photo-a', 'no-location']]);
    applyPhotoStates(record, verdict, 1, new Map([['photo-a', testCase.known]]));
    applyPhotoStates(record, verdict, 2, testCase.read === undefined ? new Map() : new Map([['photo-a', testCase.read]]));

    const entry = record.photos['photo-a'];
    assert.deepEqual(
      { fileName: entry?.fileName, takenAt: entry?.takenAt, timeZoneOffsetMs: entry?.timeZoneOffsetMs },
      testCase.expected,
      testCase.name,
    );
  }
});

test('counts the two verdicts', () => {
  const summary = summarizeAlbumRecord({
    albumKey: 'album-1',
    updatedAt: 1,
    photos: {
      a: { state: 'no-location', checkedAt: 1, fileName: null, takenAt: null, timeZoneOffsetMs: null },
      b: { state: 'has-location', checkedAt: 1, fileName: null, takenAt: null, timeZoneOffsetMs: null },
      c: { state: 'no-location', checkedAt: 1, fileName: null, takenAt: null, timeZoneOffsetMs: null },
    },
    order: ['a', 'b', 'c'],
    orderComplete: true,
  });

  assert.deepEqual(summary, { known: 3, withLocation: 1, withoutLocation: 2 });
});

test('clears one album and leaves the others alone', async () => {
  const store = createLocationStateStore(fakeStorageArea());

  await store.mergePhotoStates('album-1', new Map([['photo-a', 'no-location']]), 1);
  await store.mergePhotoStates('album-2', new Map([['photo-b', 'no-location']]), 1);
  await store.clearAlbum('album-1');

  assert.deepEqual((await store.readAlbum('album-1')).photos, {});
  assert.equal(Object.keys((await store.readAlbum('album-2')).photos).length, 1);
});

test('clears every album but keeps anything that is not album data', async () => {
  const storage = fakeStorageArea({ settings: { badgeStyle: 'pin' } });
  const store = createLocationStateStore(storage);

  await store.mergePhotoStates('album-1', new Map([['photo-a', 'no-location']]), 1);
  await store.mergePhotoStates('album-2', new Map([['photo-b', 'no-location']]), 1);

  assert.equal(await store.clearAllAlbums(), 2);
  assert.deepEqual(await storage.get(null), { settings: { badgeStyle: 'pin' } });
});

test('writes down the album order a sweep saw', async () => {
  const storage = fakeStorageArea();
  const store = createLocationStateStore(storage);

  const record = await store.writeAlbumOrder('album-1', ['p1', 'p2', 'p3'], true);

  assert.deepEqual(record.order, ['p1', 'p2', 'p3']);
  assert.equal(record.orderComplete, true);
  assert.deepEqual((await store.readAlbum('album-1')).order, ['p1', 'p2', 'p3']);
});

test('marks an order incomplete when the sweep did not reach the bottom', async () => {
  const store = createLocationStateStore(fakeStorageArea());

  const record = await store.writeAlbumOrder('album-1', ['p1', 'p2'], false);

  assert.equal(record.orderComplete, false);
});

test('never replaces a good order with an empty one', async () => {
  const store = createLocationStateStore(fakeStorageArea());
  await store.writeAlbumOrder('album-1', ['p1', 'p2'], true);

  await store.writeAlbumOrder('album-1', [], true);

  const record = await store.readAlbum('album-1');
  assert.deepEqual(record.order, ['p1', 'p2'], 'expected a sweep that saw nothing to take nothing away');
  assert.equal(record.orderComplete, true);
});

test('keeps the order when new verdicts are merged in', async () => {
  const store = createLocationStateStore(fakeStorageArea());
  await store.writeAlbumOrder('album-1', ['p1', 'p2'], true);

  await store.mergePhotoStates('album-1', new Map([['p1', 'no-location']]));

  assert.deepEqual((await store.readAlbum('album-1')).order, ['p1', 'p2']);
});

test('an album written by an older version simply has no order', () => {
  const record = normalizeAlbumRecord('album-1', { albumKey: 'album-1', updatedAt: 5, photos: {} });

  assert.deepEqual(record.order, []);
  assert.equal(record.orderComplete, false);
});

test('repairs an order that is not a list of photo ids', () => {
  const record = normalizeAlbumRecord('album-1', { order: ['p1', 7, null, 'p2'], orderComplete: true, photos: {} });

  assert.deepEqual(record.order, ['p1', 'p2']);
});

test('an empty order is never called complete', () => {
  const record = normalizeAlbumRecord('album-1', { order: [], orderComplete: true, photos: {} });

  assert.equal(record.orderComplete, false);
});
