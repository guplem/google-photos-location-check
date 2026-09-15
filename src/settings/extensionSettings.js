/**
 * All user settings, their defaults, and the reading and writing helpers.
 *
 * Settings live in `chrome.storage.sync`, so they follow the Chrome profile.
 * The remembered album data lives in `chrome.storage.local` instead, because a
 * large album passes the per-item quota that `sync` enforces.
 *
 * The storage area is passed in instead of read from `chrome` directly, so the
 * logic in this file is unit tested without a browser.
 *
 * **A new setting must be added in four places**, or it silently resets itself:
 * `DEFAULT_SETTINGS`, `normalizeSettings`, `options/optionsPage.html`, and both
 * functions in `options/optionsPage.js`. Use the `add-setting` skill.
 */

/**
 * @typedef {object} ExtensionSettings
 * @property {boolean} locationBadgesEnabled   Draw the warning badge on photos with no location.
 * @property {boolean} dimPhotosWithLocation   Fade the photos that do have a location, so the rest stand out.
 * @property {boolean} markUnreadablePhotos    Draw a quieter badge on photos the extension could not read.
 * @property {number} lookupBatchSize          Photos asked about in one request.
 * @property {number} lookupParallelRequests   Requests in flight at the same time.
 * @property {number} lookupDebounceMs         How long to let new thumbnails pile up before asking.
 */

/** @type {Readonly<ExtensionSettings>} */
export const DEFAULT_SETTINGS = Object.freeze({
  locationBadgesEnabled: true,
  dimPhotosWithLocation: false,
  markUnreadablePhotos: true,
  lookupBatchSize: 100,
  lookupParallelRequests: 3,
  lookupDebounceMs: 250,
});

export const SETTINGS_STORAGE_KEY = 'settings:v1';

/**
 * Drops unknown keys and replaces wrong or missing values with the default.
 * Storage can hold anything, including settings written by an older version.
 * @param {unknown} stored
 * @returns {ExtensionSettings}
 */
export function normalizeSettings(stored) {
  const raw = stored !== null && typeof stored === 'object' ? /** @type {Record<string, unknown>} */ (stored) : {};

  /**
   * @param {keyof ExtensionSettings} key
   * @returns {boolean}
   */
  const readBoolean = (key) =>
    typeof raw[key] === 'boolean' ? /** @type {boolean} */ (raw[key]) : /** @type {boolean} */ (DEFAULT_SETTINGS[key]);

  /**
   * @param {keyof ExtensionSettings} key
   * @param {number} minimum
   * @param {number} maximum
   * @returns {number}
   */
  const readNumber = (key, minimum, maximum) => {
    const value = raw[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) return /** @type {number} */ (DEFAULT_SETTINGS[key]);
    return Math.min(Math.max(Math.round(value), minimum), maximum);
  };

  return {
    locationBadgesEnabled: readBoolean('locationBadgesEnabled'),
    dimPhotosWithLocation: readBoolean('dimPhotosWithLocation'),
    markUnreadablePhotos: readBoolean('markUnreadablePhotos'),
    // The upper bound is not a guess. One hundred photos per request answered in
    // under a second on a real album, and Google answers `429` when pushed.
    lookupBatchSize: readNumber('lookupBatchSize', 1, 200),
    lookupParallelRequests: readNumber('lookupParallelRequests', 1, 6),
    lookupDebounceMs: readNumber('lookupDebounceMs', 0, 5000),
  };
}

/**
 * @param {chrome.storage.StorageArea} storageArea
 * @returns {Promise<ExtensionSettings>}
 */
export async function loadSettings(storageArea) {
  const stored = await storageArea.get(SETTINGS_STORAGE_KEY);
  return normalizeSettings(stored[SETTINGS_STORAGE_KEY]);
}

/**
 * @param {chrome.storage.StorageArea} storageArea
 * @param {Partial<ExtensionSettings>} changes
 * @returns {Promise<ExtensionSettings>}
 */
export async function saveSettings(storageArea, changes) {
  const current = await loadSettings(storageArea);
  const next = normalizeSettings({ ...current, ...changes });
  await storageArea.set({ [SETTINGS_STORAGE_KEY]: next });
  return next;
}
