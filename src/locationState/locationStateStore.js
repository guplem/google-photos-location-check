/**
 * Remembers, per album, which photos carry a location and which do not.
 *
 * One storage key per album keeps each write small, so looking at one album
 * never rewrites the data of every other album. The data goes in
 * `chrome.storage.local`, never in `sync`: a large album passes the per-item
 * quota that `sync` enforces.
 *
 * Each entry also keeps the file name and the time the photo was taken, as the
 * lookup read them. The list of photos without a location sorts and names the
 * photos with them. An entry written by an older version has neither, so both
 * read back as `null`, and reading the album again fills them in.
 *
 * Only a verdict is ever stored. `unknown` means "we could not read it", and
 * writing that down would stop the extension asking again on the next visit.
 *
 * The record also holds the album order, which is the list of photo ids as a
 * sweep saw them. The photo viewer has no grid to walk, so it is the only way
 * the extension can say "the next photo without a location is that one" while
 * a photo is open. Only a sweep writes it: the lazy reads that happen while
 * you scroll see photos in the order you happen to uncover them, which is not
 * the album order. `orderComplete` is true only for a sweep that reached the
 * bottom, so a half-read album never claims to know where the album ends.
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
 * @property {string | null} fileName
 * @property {number | null} takenAt           Milliseconds since the epoch, UTC.
 * @property {number | null} timeZoneOffsetMs  Add it to `takenAt` to get the photo's local time.
 *
 * @typedef {object} PhotoDetails  What a lookup read about a photo, besides its verdict.
 * @property {string | null} fileName
 * @property {number | null} takenAt
 * @property {number | null} timeZoneOffsetMs
 *
 * @typedef {object} AlbumLocationRecord
 * @property {string} albumKey
 * @property {number} updatedAt
 * @property {Record<string, PhotoLocationEntry>} photos
 * @property {string[]} order          The photos of the album, in album order, as the last sweep saw them.
 * @property {boolean} orderComplete   True only when that sweep reached the bottom.
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
  return { albumKey, updatedAt: 0, photos: {}, order: [], orderComplete: false };
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function readStoredNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
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
      fileName: typeof candidate.fileName === 'string' && candidate.fileName !== '' ? candidate.fileName : null,
      takenAt: readStoredNumber(candidate.takenAt),
      timeZoneOffsetMs: readStoredNumber(candidate.timeZoneOffsetMs),
    };
  }

  // An order written by an older version does not exist, and a stored order
  // could hold anything. Either way the album simply has no order yet, which
  // every caller already handles.
  const order = Array.isArray(raw.order) ? raw.order.filter((entry) => typeof entry === 'string') : [];

  return {
    albumKey,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : 0,
    photos: clean,
    order,
    orderComplete: order.length > 0 && raw.orderComplete === true,
  };
}

/**
 * Writes new verdicts into a record, in place.
 *
 * Anything that is not a verdict is dropped here rather than at every call
 * site, so a caller can hand over a whole scan result without filtering it.
 * A verdict that arrives with no details keeps the details already known: a
 * later answer that says less must not erase what an earlier one said.
 *
 * The time and its offset merge as a pair. A new time with an old offset
 * gives a local time that no read ever said.
 *
 * The store uses this, and so does the page when storage is gone and the
 * verdicts can only live in memory.
 * @param {AlbumLocationRecord} record
 * @param {ReadonlyMap<string, string>} states
 * @param {number} checkedAt
 * @param {ReadonlyMap<string, PhotoDetails>} [details]
 * @returns {boolean} True when the record changed.
 */
export function applyPhotoStates(record, states, checkedAt, details = new Map()) {
  let changed = false;
  for (const [photoKey, state] of states) {
    if (state !== 'has-location' && state !== 'no-location') continue;
    const known = record.photos[photoKey];
    const read = details.get(photoKey);
    /** @type {{ takenAt: number | null, timeZoneOffsetMs: number | null }} */
    const time =
      read !== undefined && read.takenAt !== null
        ? { takenAt: read.takenAt, timeZoneOffsetMs: read.timeZoneOffsetMs }
        : { takenAt: known?.takenAt ?? null, timeZoneOffsetMs: known?.timeZoneOffsetMs ?? null };
    record.photos[photoKey] = {
      state,
      checkedAt,
      fileName: read?.fileName ?? known?.fileName ?? null,
      takenAt: time.takenAt,
      timeZoneOffsetMs: time.timeZoneOffsetMs,
    };
    changed = true;
  }
  if (changed) record.updatedAt = checkedAt;
  return changed;
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
     * Merges new verdicts, and what was read with them, into what is already
     * stored. `applyPhotoStates` holds the rules.
     * @param {string} albumKey
     * @param {ReadonlyMap<string, string>} states
     * @param {number} checkedAt
     * @param {ReadonlyMap<string, PhotoDetails>} [details]
     * @returns {Promise<AlbumLocationRecord>}
     */
    async mergePhotoStates(albumKey, states, checkedAt = Date.now(), details = new Map()) {
      const record = await this.readAlbum(albumKey);
      if (!applyPhotoStates(record, states, checkedAt, details)) return record;

      await storageArea.set({ [albumStorageKey(albumKey)]: record });
      return record;
    },

    /**
     * Writes down the album order a sweep just saw.
     *
     * An empty order is never written. A sweep that saw nothing has not learned
     * that the album is empty; it has learned nothing, and overwriting a good
     * order with it would take away the only thing the photo viewer can use.
     * @param {string} albumKey
     * @param {readonly string[]} order
     * @param {boolean} complete  True only when the sweep reached the bottom.
     * @returns {Promise<AlbumLocationRecord>}
     */
    async writeAlbumOrder(albumKey, order, complete) {
      const record = await this.readAlbum(albumKey);
      if (order.length === 0) return record;

      record.order = [...order];
      record.orderComplete = complete;
      record.updatedAt = Date.now();
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
