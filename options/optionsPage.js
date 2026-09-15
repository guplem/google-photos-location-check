/**
 * Reads and writes the settings shown on the options page.
 *
 * Settings live in `chrome.storage.sync`, so they follow your Chrome profile.
 * The remembered album answers live in `chrome.storage.local`, because they are
 * large and belong to one computer.
 *
 * A new setting must appear in `showSettings` **and** in `collectSettings`. A
 * setting that misses one of them resets itself with no error.
 */

import { createLocationStateStore } from '../src/locationState/locationStateStore.js';
import { DEFAULT_SETTINGS, loadSettings, normalizeSettings, saveSettings } from '../src/settings/extensionSettings.js';

const store = createLocationStateStore(chrome.storage.local);

/**
 * @param {string} id
 * @returns {HTMLInputElement}
 */
const input = (id) => /** @type {HTMLInputElement} */ (document.getElementById(id));

/** @param {string} message */
function showStatus(message) {
  const status = /** @type {HTMLElement} */ (document.getElementById('status'));
  status.textContent = message;
  setTimeout(() => {
    if (status.textContent === message) status.textContent = '';
  }, 3000);
}

/** @param {import('../src/settings/extensionSettings.js').ExtensionSettings} settings */
function showSettings(settings) {
  input('locationBadgesEnabled').checked = settings.locationBadgesEnabled;
  input('dimPhotosWithLocation').checked = settings.dimPhotosWithLocation;
  input('markUnreadablePhotos').checked = settings.markUnreadablePhotos;
  input('lookupBatchSize').value = String(settings.lookupBatchSize);
  input('lookupParallelRequests').value = String(settings.lookupParallelRequests);
  input('lookupDebounceMs').value = String(settings.lookupDebounceMs);
}

/** @returns {import('../src/settings/extensionSettings.js').ExtensionSettings} */
function collectSettings() {
  return normalizeSettings({
    locationBadgesEnabled: input('locationBadgesEnabled').checked,
    dimPhotosWithLocation: input('dimPhotosWithLocation').checked,
    markUnreadablePhotos: input('markUnreadablePhotos').checked,
    lookupBatchSize: Number(input('lookupBatchSize').value),
    lookupParallelRequests: Number(input('lookupParallelRequests').value),
    lookupDebounceMs: Number(input('lookupDebounceMs').value),
  });
}

document.getElementById('save')?.addEventListener('click', () => {
  void (async () => {
    // The page is re-filled from what was actually stored, so a value the
    // normalizer repaired is shown repaired rather than as the user typed it.
    showSettings(await saveSettings(chrome.storage.sync, collectSettings()));
    showStatus('Saved.');
  })();
});

document.getElementById('reset')?.addEventListener('click', () => {
  void (async () => {
    showSettings(await saveSettings(chrome.storage.sync, DEFAULT_SETTINGS));
    showStatus('Back to the defaults.');
  })();
});

document.getElementById('clearAlbums')?.addEventListener('click', () => {
  void (async () => {
    const removed = await store.clearAllAlbums();
    showStatus(removed === 1 ? 'Forgot 1 album.' : 'Forgot ' + String(removed) + ' albums.');
  })();
});

void loadSettings(chrome.storage.sync).then(showSettings);
