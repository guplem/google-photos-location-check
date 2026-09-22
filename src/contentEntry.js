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
 * Nothing scans ahead on its own. A photo is read when its thumbnail comes into
 * the page, which is why opening an album costs nothing and why badges appear
 * as you scroll.
 *
 * The **Read whole album** button is the one exception, and it changes nothing
 * about the flow above. It only scrolls the grid from top to bottom, which
 * makes every thumbnail appear once, and steps 1 to 4 then happen by
 * themselves. The button is off the critical path: the extension works without
 * anyone pressing it.
 *
 * The **next / previous without location** buttons scroll the same way, but
 * they cannot be off the critical path: each screen they uncover has to be
 * looked up before they can tell whether the photo they are after is on it. So
 * `showPhotoWithoutLocation` below is the one place that waits for the queue.
 *
 * ## A photo key is a media id
 *
 * The grid link points at `.../photo/AF1Qip...`, and that same string is what
 * the `fDcn4b` call takes. No translation is needed anywhere. That is the fact
 * that lets this extension work off the grid alone.
 */

import { jumpToPhotoWithoutLocation } from './albumGrid/albumGridJump.js';
import { createAlbumGridScroller } from './albumGrid/albumGridScroller.js';
import { sweepAlbumGrid } from './albumGrid/albumGridSweep.js';
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
  const gridScroller = createAlbumGridScroller(window);
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

  let sweepRunning = false;
  let stopSweepRequested = false;

  let jumpRunning = false;
  /** The photo the last jump landed on, so pressing the button again moves on. */
  /** @type {string | null} */
  let lastJumpPhotoKey = null;

  /** How many photos the album holds. Known only after a sweep reached the bottom. */
  /** @type {number | null} */
  let albumPhotoCount = null;

  /** @param {number} milliseconds */
  const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

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
      albumTotal: albumPhotoCount,
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
        wait: sleep,
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

  /**
   * Scrolls the album from top to bottom so every thumbnail appears once.
   *
   * The sweep looks up nothing itself. Its readPhotoKeysOnScreen is wrapped
   * here so that each screen of thumbnails it uncovers goes straight into the
   * queue, which is what makes the badges fill in while the grid moves. The
   * drain is not debounced during a sweep: the sweep's own settle time already
   * paces it, and waiting again would leave the last screens unread.
   * @returns {Promise<void>}
   */
  async function readWholeAlbum() {
    if (sweepRunning || jumpRunning || albumKey === null) return;
    sweepRunning = true;
    stopSweepRequested = false;
    panel.setBusy(true);
    panel.setStatus('Reading the whole album...');

    const albumAtStart = albumKey;
    try {
      const sweep = await sweepAlbumGrid({
        readPhotoKeysOnScreen: () => {
          const photoKeys = gridScroller.readPhotoKeysOnScreen();
          if (queue.enqueue(photoKeys) > 0) void queue.drain();
          return photoKeys;
        },
        readScrollPosition: () => gridScroller.readScrollPosition(),
        scrollTo: (top) => gridScroller.scrollTo(top),
        wait: sleep,
        // Leaving the album mid-sweep must stop it, or it scrolls a grid that
        // is no longer the one the user is looking at.
        shouldStop: () => stopSweepRequested || albumKey !== albumAtStart,
        onProgress: () => updatePanel(),
      });

      panel.setStatus('Looking up the last photos...');
      await queue.drain();

      // Only a sweep that reached the bottom knows how many photos the album
      // holds. Any other ending means "we stopped looking", which is not the
      // same thing and must never be shown as a total.
      albumPhotoCount = sweep.reachedBottom ? sweep.photoKeys.length : null;
      const photosRead = String(sweep.photoKeys.length);
      if (sweep.reachedBottom) panel.setStatus('Read the whole album: ' + photosRead + ' photos.');
      else if (sweep.stoppedEarly) panel.setStatus('Stopped after ' + photosRead + ' photos.');
      else panel.setStatus('Stopped before the end, after ' + photosRead + ' photos. Press again to carry on.');
    } finally {
      sweepRunning = false;
      stopSweepRequested = false;
      panel.setBusy(false);
      updatePanel();
    }
  }

  /**
   * Walks the grid to the next, or previous, photo that carries no location and
   * leaves the user looking at it.
   *
   * The walk decides where to stop; everything here is the page side of it:
   * uncovered photos go into the lookup queue and are waited for, the photo
   * that was found is brought into view and marked, and the user is told what
   * happened either way.
   * @param {'next' | 'previous'} direction
   * @returns {Promise<void>}
   */
  async function showPhotoWithoutLocation(direction) {
    if (sweepRunning || jumpRunning || albumKey === null) return;

    // The panel also shows while a photo is open, and there is no grid to walk
    // behind it. Saying so is better than a walk that finds nothing.
    if (gridScroller.readScrollPosition() === null) {
      panel.setStatus('Go back to the album grid to use this.');
      return;
    }

    jumpRunning = true;
    panel.setJumping(true);
    panel.setStatus(direction === 'next' ? 'Looking further down...' : 'Looking further up...');

    const albumAtStart = albumKey;
    try {
      const jump = await jumpToPhotoWithoutLocation({
        direction,
        fromPhotoKey: lastJumpPhotoKey,
        readPhotoKeysOnScreen: () => gridScroller.readPhotoKeysOnScreen(),
        waitForVerdicts: async (photoKeys) => {
          // Drained even when `enqueue` added nothing. Nothing added can also
          // mean the scroll-driven drain is already asking about these photos,
          // and judging the screen before that answer arrives would walk past
          // the very photo the button is looking for.
          queue.enqueue(photoKeys);
          await queue.drain();
          updatePanel();
        },
        readState: readStoredState,
        readScrollPosition: () => gridScroller.readScrollPosition(),
        scrollTo: (top) => gridScroller.scrollTo(top),
        wait: sleep,
        // Leaving the album mid-walk must stop it, or it scrolls a grid that is
        // no longer the one the user is looking at.
        shouldStop: () => albumKey !== albumAtStart,
      });

      if (jump.photoKey === null) {
        // The anchor belonged to a walk that is over. Keeping it would make the
        // next press start from a photo the user may be nowhere near.
        lastJumpPhotoKey = null;
        if (jump.stoppedEarly) panel.setStatus('Stopped looking.');
        else if (jump.reachedEnd) {
          panel.setStatus(
            direction === 'next'
              ? 'No more photos without a location below this one.'
              : 'No more photos without a location above this one.',
          );
        } else panel.setStatus('Stopped before the end of the album. Press again to carry on.');
        return;
      }

      lastJumpPhotoKey = jump.photoKey;
      gridScroller.scrollPhotoIntoView(jump.photoKey);
      renderer.highlightPhoto(jump.photoKey);
      panel.setStatus(direction === 'next' ? 'Here is the next one.' : 'Here is the previous one.');
    } finally {
      jumpRunning = false;
      panel.setJumping(false);
      updatePanel();
    }
  }

  const panel = createControlPanel({
    document,

    onReadWholeAlbum: readWholeAlbum,
    onJumpToPhotoWithoutLocation: showPhotoWithoutLocation,
    onStopReading: () => {
      stopSweepRequested = true;
    },

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
        photosInAlbum: albumPhotoCount,
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
      albumPhotoCount = null;
      lastJumpPhotoKey = null;
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
