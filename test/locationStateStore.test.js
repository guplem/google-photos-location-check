import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import {
  albumStorageKey,
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

  assert.deepEqual(record.photos['photo-a'], { state: 'no-location', checkedAt: 1000 });
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

  assert.deepEqual(await store.readAlbum('never-seen'), { albumKey: 'never-seen', updatedAt: 0, photos: {} });
});

test('repairs anything stored that is not a record we wrote', () => {
  for (const broken of [null, 7, 'text', [], { photos: 'not an object' }]) {
    assert.deepEqual(normalizeAlbumRecord('album-1', broken), { albumKey: 'album-1', updatedAt: 0, photos: {} });
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

test('counts the two verdicts', () => {
  const summary = summarizeAlbumRecord({
    albumKey: 'album-1',
    updatedAt: 1,
    photos: {
      a: { state: 'no-location', checkedAt: 1 },
      b: { state: 'has-location', checkedAt: 1 },
      c: { state: 'no-location', checkedAt: 1 },
    },
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
