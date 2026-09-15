import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import {
  DEFAULT_SETTINGS,
  loadSettings,
  normalizeSettings,
  saveSettings,
  SETTINGS_STORAGE_KEY,
} from '../src/settings/extensionSettings.js';

/** A stand-in for `chrome.storage.sync` that lives in memory. */
function fakeStorageArea(/** @type {Record<string, unknown>} */ initial = {}) {
  /** @type {Record<string, unknown>} */
  const data = { ...initial };
  return /** @type {chrome.storage.StorageArea} */ (
    /** @type {unknown} */ ({
      get: async (/** @type {string} */ key) => ({ [key]: data[key] }),
      set: async (/** @type {Record<string, unknown>} */ values) => void Object.assign(data, values),
    })
  );
}

test('falls back to the defaults for anything not stored', () => {
  for (const stored of [undefined, null, 'text', 7, []]) {
    assert.deepEqual(normalizeSettings(stored), DEFAULT_SETTINGS);
  }
});

test('keeps a stored value that has the right type', () => {
  const settings = normalizeSettings({ locationBadgesEnabled: false, dimPhotosWithLocation: true });

  assert.equal(settings.locationBadgesEnabled, false);
  assert.equal(settings.dimPhotosWithLocation, true);
});

test('replaces a value of the wrong type with the default', () => {
  const settings = normalizeSettings({ locationBadgesEnabled: 'yes', lookupBatchSize: 'many' });

  assert.equal(settings.locationBadgesEnabled, DEFAULT_SETTINGS.locationBadgesEnabled);
  assert.equal(settings.lookupBatchSize, DEFAULT_SETTINGS.lookupBatchSize);
});

test('pulls a number back inside its range and rounds it', () => {
  assert.equal(normalizeSettings({ lookupBatchSize: 0 }).lookupBatchSize, 1);
  assert.equal(normalizeSettings({ lookupBatchSize: 9000 }).lookupBatchSize, 200);
  assert.equal(normalizeSettings({ lookupParallelRequests: 99 }).lookupParallelRequests, 6);
  assert.equal(normalizeSettings({ lookupDebounceMs: 12.6 }).lookupDebounceMs, 13);
});

test('drops a key we do not know', () => {
  const settings = normalizeSettings({ locationBadgesEnabled: true, leftBehindByAnOlderVersion: 'x' });

  assert.deepEqual(Object.keys(settings).sort(), Object.keys(DEFAULT_SETTINGS).sort());
});

test('reads the defaults from an empty storage area', async () => {
  assert.deepEqual(await loadSettings(fakeStorageArea()), DEFAULT_SETTINGS);
});

test('writes one changed setting and leaves the rest alone', async () => {
  const storage = fakeStorageArea();

  const next = await saveSettings(storage, { dimPhotosWithLocation: true });

  assert.equal(next.dimPhotosWithLocation, true);
  assert.equal(next.locationBadgesEnabled, DEFAULT_SETTINGS.locationBadgesEnabled);
  assert.deepEqual(await loadSettings(storage), next);
});

test('repairs a wrong value on the way in as well as on the way out', async () => {
  const storage = fakeStorageArea({ [SETTINGS_STORAGE_KEY]: { lookupParallelRequests: -4 } });

  assert.equal((await loadSettings(storage)).lookupParallelRequests, 1);
});
