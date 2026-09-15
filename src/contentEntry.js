/**
 * Wiring only. Every decision lives in the modules this file joins together.
 *
 * ## The whole flow, in order
 *
 * 1. The badge renderer watches the album grid and, on every redraw, reports
 *    which photos are on screen.
 * 2. Those photo keys go into the lookup queue, which drops the ones already
 *    answered and the ones already being asked about.
 * 3. A short debounce lets a scroll settle, then the queue asks Google Photos
 *    about what is left, in batches, through `albumLocationScan`.
 * 4. The verdicts are remembered per album, and the renderer redraws.
 *
 * Nothing scans ahead. A photo is read when its thumbnail comes into the page,
 * which is why opening an album costs nothing and why badges appear as you
 * scroll.
 *
 * ## A photo key is a media id
 *
 * The grid link points at `.../photo/AF1Qip...`, and that same string is what
 * the `fDcn4b` call takes. No translation is needed anywhere. That is the fact
 * that lets this extension work off the grid alone.
 */

import { createControlPanel } from './controlPanel/controlPanelController.js';
import { buildDiagnosticsReport } from './diagnosticsReport.js';
import { isAlbumContext, readGooglePhotosLocation } from './googlePhotosPage.js';
import { scanAlbumLocations } from './locationState/albumLocationScan.js';
import { createLocationBadgeRenderer } from './locationState/locationBadgeRenderer.js';
import { createLocationLookupQueue } from './locationState/locationLookupQueue.js';
import { createEmptyAlbumRecord, createLocationStateStore, summarizeAlbumRecord } from './locationState/locationStateStore.js';
import { createPhotosRpcClient } from './photosRpc/photosRpcClient.js';
import { DEFAULT_SETTINGS, loadSettings } from './settings/extensionSettings.js';

/** Google Photos rewrites the address bar with no event, so polling is the only reliable watch. */
const LOCATION_POLL_MS = 300;

/** Failures kept for the diagnostics report. Older ones are dropped. */
const MAX_REMEMBERED_FAILURES = 20;

/** @returns {Promise<void>} */
function waitForBody() {
  if (document.body !== null) return Promise.resolve();
  return new Promise((resolve) => {
    new MutationObserver((records, observer) => {
      if (document.body === null) return;
      observer.disconnect();
      resolve();
    }).observe(document.documentElement, { childList: true, subtree: true });
  });
}

/**
 * Reads the extension version without letting a dead extension context throw.
 *
 * Every `chrome.*` call throws once the extension is reloaded while this page
 * stays open. The diagnostics report is exactly the thing a user reaches for
 * then, so it must not depend on this succeeding.
 * @returns {string}
 */
function readExtensionVersion() {
  try {
    return chrome.runtime.getManifest().version;
  } catch {
    return '(unknown: the extension was reloaded)';
  }
}

export async function start() {
  await waitForBody();

  const store = createLocationStateStore(chrome.storage.local);
  const rpcClient = createPhotosRpcClient({
    document,
    fetch: window.fetch.bind(window),
    readSourcePath: () => location.pathname,
  });

  /** @type {import('./settings/extensionSettings.js').ExtensionSettings} */
  let settings = DEFAULT_SETTINGS;
  /** @type {import('./locationState/locationStateStore.js').AlbumLocationRecord} */
  let albumRecord = createEmptyAlbumRecord('');
  /** @type {string | null} */
  let albumKey = null;
  let lastHref = '';

  /** Photos asked about and not readable. Not stored, so a later visit tries again. */
  const unreadablePhotos = new Set();
  /** @type {string[]} */
  const recentFailures = [];

  /** @type {number | null} */
  let debounceTimer = null;

  /**
   * @param {string} photoKey
   * @returns {'has-location' | 'no-location' | null}
   */
  function readStoredState(photoKey) {
    return albumRecord.photos[photoKey]?.state ?? null;
  }

  /** @param {readonly string[]} reasons */
  function rememberFailures(reasons) {
    if (reasons.length === 0) return;
    recentFailures.push(...reasons);
    if (recentFailures.length > MAX_REMEMBERED_FAILURES) {
      recentFailures.splice(0, recentFailures.length - MAX_REMEMBERED_FAILURES);
    }
  }

  function updatePanel() {
    const summary = summarizeAlbumRecord(albumRecord);
    panel.setCounts({
      known: summary.known,
      withoutLocation: summary.withoutLocation,
      pending: queue.pendingCount(),
      unreadable: unreadablePhotos.size,
    });
  }

  /**
   * @param {ReadonlyMap<string, string>} states
   * @returns {Promise<void>}
   */
  async function writeResults(states) {
    if (albumKey === null) return;
    try {
      albumRecord = await store.mergePhotoStates(albumKey, states);
    } catch (error) {
      // The extension was reloaded under a page that stayed open. Keep the
      // verdicts in memory, so the badges are still right for this visit.
      rememberFailures(['could not remember the results: ' + String(error)]);
      for (const [photoKey, state] of states) {
        if (state === 'has-location' || state === 'no-location') {
          albumRecord.photos[photoKey] = { state, checkedAt: Date.now() };
        }
      }
    }
    renderer.refresh();
    updatePanel();
  }

  /** Lets a burst of scrolling settle before asking about what it uncovered. */
  function scheduleDrain() {
    if (debounceTimer !== null) return;
    debounceTimer = window.setTimeout(() => {
      debounceTimer = null;
      void queue.drain();
    }, settings.lookupDebounceMs);
  }

  const queue = createLocationLookupQueue({
    isKnown: (photoKey) => readStoredState(photoKey) !== null,

    lookUp: (mediaIds) =>
      scanAlbumLocations({
        mediaIds,
        readChunk: (chunk) => rpcClient.readLocations(chunk),
        wait: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
        chunkSize: settings.lookupBatchSize,
        parallelRequests: settings.lookupParallelRequests,
      }),

    onResults: (result) => {
      for (const [photoKey, state] of result.states) {
        if (state === 'unknown') unreadablePhotos.add(photoKey);
        else unreadablePhotos.delete(photoKey);
      }
      rememberFailures(result.failureReasons);
      void writeResults(result.states);
    },

    onError: (error) => {
      rememberFailures([String(error)]);
      updatePanel();
    },
  });

  const renderer = createLocationBadgeRenderer({
    document,
    readState: readStoredState,
    onPhotosOnScreen: (photoKeys) => {
      if (albumKey === null) return;
      if (queue.enqueue(photoKeys) > 0) scheduleDrain();
      updatePanel();
    },
    isEnabled: () => settings.locationBadgesEnabled,
    shouldMarkUnreadable: () => settings.markUnreadablePhotos,
  });

  const panel = createControlPanel({
    document,

    buildReport: async () => {
      const summary = summarizeAlbumRecord(albumRecord);
      return buildDiagnosticsReport({
        extensionVersion: readExtensionVersion(),
        url: location.href,
        albumKey,
        photosKnown: summary.known,
        photosWithLocation: summary.withLocation,
        photosWithoutLocation: summary.withoutLocation,
        photosPending: queue.pendingCount(),
        photosUnreadable: unreadablePhotos.size,
        recentFailures,
        settings,
      });
    },

    onRecheckAlbum: async () => {
      if (albumKey === null) return;
      await store.clearAlbum(albumKey);
      albumRecord = createEmptyAlbumRecord(albumKey);
      unreadablePhotos.clear();
      renderer.refresh();
      updatePanel();
    },

    onOpenOptions: () => {
      chrome.runtime.sendMessage({ type: 'open-options' });
    },
  });

  /** @param {import('./settings/extensionSettings.js').ExtensionSettings} next */
  function publishSettings(next) {
    const root = document.documentElement;
    if (next.locationBadgesEnabled && next.dimPhotosWithLocation) root.setAttribute('data-gplc-dim-located', 'on');
    else root.removeAttribute('data-gplc-dim-located');
  }

  async function onLocationChanged() {
    const page = readGooglePhotosLocation(location.href);

    if (!isAlbumContext(page) || page.albumKey === null) {
      albumKey = null;
      renderer.stop();
      panel.unmount();
      return;
    }

    if (page.albumKey !== albumKey) {
      albumKey = page.albumKey;
      unreadablePhotos.clear();
      albumRecord = createEmptyAlbumRecord(albumKey);
      try {
        albumRecord = await store.readAlbum(albumKey);
      } catch (error) {
        rememberFailures(['could not read what was remembered: ' + String(error)]);
      }
    }

    panel.mount();
    updatePanel();
    renderer.start();
    renderer.refresh();
  }

  function watchLocation() {
    const check = () => {
      if (location.href === lastHref) return;
      lastHref = location.href;
      void onLocationChanged();
    };
    window.addEventListener('popstate', check);
    setInterval(check, LOCATION_POLL_MS);
    check();
  }

  settings = await loadSettings(chrome.storage.sync);
  publishSettings(settings);

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'sync') return;
    void loadSettings(chrome.storage.sync).then((next) => {
      settings = next;
      publishSettings(next);
      renderer.refresh();
    });
  });

  watchLocation();
}
