/**
 * Remembers, per album, which photos carry a location and which do not.
 *
 * One storage key per album keeps each write small, so looking at one album
 * never rewrites the data of every other album. The data goes in
 * `chrome.storage.local`, never in `sync`: a large album passes the per-item
 * quota that `sync` enforces.
 *
 * Only a verdict is ever stored. `unknown` means "we could not read it", and
 * writing that down would stop the extension asking again on the next visit.
 *
 * Everything that comes back out of storage passes `normalizeAlbumRecord`,
 * because storage can still hold data written by an older version.
 */

export const LOCATION_STATE_KEY_PREFIX = 'locationState:v1:';

/**
 * @typedef {'has-location' | 'no-location'} StoredLocationState
 *
 * @typedef {object} PhotoLocationEntry
 * @property {StoredLocationState} state
 * @property {number} checkedAt  Milliseconds since the epoch.
 *
 * @typedef {object} AlbumLocationRecord
 * @property {string} albumKey
 * @property {number} updatedAt
 * @property {Record<string, PhotoLocationEntry>} photos
 *
 * @typedef {object} AlbumLocationSummary
 * @property {number} known
 * @property {number} withLocation
 * @property {number} withoutLocation
 */

/**
 * @param {string} albumKey
 * @returns {string}
 */
export function albumStorageKey(albumKey) {
  return LOCATION_STATE_KEY_PREFIX + albumKey;
}

/**
 * @param {string} albumKey
 * @returns {AlbumLocationRecord}
 */
export function createEmptyAlbumRecord(albumKey) {
  return { albumKey, updatedAt: 0, photos: {} };
}

/**
 * Rejects anything that does not look like a record we wrote.
 * @param {string} albumKey
 * @param {unknown} stored
 * @returns {AlbumLocationRecord}
 */
export function normalizeAlbumRecord(albumKey, stored) {
  if (stored === null || typeof stored !== 'object') return createEmptyAlbumRecord(albumKey);
  const raw = /** @type {Record<string, unknown>} */ (stored);
  const photos = raw.photos !== null && typeof raw.photos === 'object' ? /** @type {Record<string, unknown>} */ (raw.photos) : {};

  /** @type {Record<string, PhotoLocationEntry>} */
  const clean = {};
  for (const [photoKey, entry] of Object.entries(photos)) {
    if (entry === null || typeof entry !== 'object') continue;
    const candidate = /** @type {Record<string, unknown>} */ (entry);
    if (candidate.state !== 'has-location' && candidate.state !== 'no-location') continue;
    clean[photoKey] = {
      state: candidate.state,
      checkedAt: typeof candidate.checkedAt === 'number' ? candidate.checkedAt : 0,
    };
  }

  return {
    albumKey,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : 0,
    photos: clean,
  };
}

/**
 * @param {AlbumLocationRecord} record
 * @returns {AlbumLocationSummary}
 */
export function summarizeAlbumRecord(record) {
  const entries = Object.values(record.photos);
  const withoutLocation = entries.filter((entry) => entry.state === 'no-location').length;
  return { known: entries.length, withLocation: entries.length - withoutLocation, withoutLocation };
}

/**
 * @param {chrome.storage.StorageArea} storageArea
 */
export function createLocationStateStore(storageArea) {
  return {
    /**
     * @param {string} albumKey
     * @returns {Promise<AlbumLocationRecord>}
     */
    async readAlbum(albumKey) {
      const key = albumStorageKey(albumKey);
      const stored = await storageArea.get(key);
      return normalizeAlbumRecord(albumKey, stored[key]);
    },

    /**
     * Merges new verdicts into what is already stored.
     *
     * Anything that is not a verdict is dropped here rather than at every call
     * site, so a caller can hand over a whole scan result without filtering it.
     * @param {string} albumKey
     * @param {ReadonlyMap<string, string>} states
     * @param {number} checkedAt
     * @returns {Promise<AlbumLocationRecord>}
     */
    async mergePhotoStates(albumKey, states, checkedAt = Date.now()) {
      const record = await this.readAlbum(albumKey);
      let changed = false;
      for (const [photoKey, state] of states) {
        if (state !== 'has-location' && state !== 'no-location') continue;
        record.photos[photoKey] = { state, checkedAt };
        changed = true;
      }
      if (!changed) return record;

      record.updatedAt = checkedAt;
      await storageArea.set({ [albumStorageKey(albumKey)]: record });
      return record;
    },

    /**
     * @param {string} albumKey
     * @returns {Promise<void>}
     */
    async clearAlbum(albumKey) {
      await storageArea.remove(albumStorageKey(albumKey));
    },

    /**
     * Removes the remembered state of every album, but keeps the settings.
     * @returns {Promise<number>} How many albums were removed.
     */
    async clearAllAlbums() {
      const everything = await storageArea.get(null);
      const keys = Object.keys(everything).filter((key) => key.startsWith(LOCATION_STATE_KEY_PREFIX));
      if (keys.length > 0) await storageArea.remove(keys);
      return keys.length;
    },
  };
}

/** @typedef {ReturnType<typeof createLocationStateStore>} LocationStateStore */
