/**
 * Collects the photos whose location is not known yet and looks them up in
 * batches.
 *
 * The grid is virtualised: Google Photos keeps about fifty thumbnails in the
 * page and reuses the same elements as you scroll. So the same photo is offered
 * to this queue many times, and a photo is offered long before anyone asks for
 * its badge. The queue exists to make that cheap.
 *
 * Three rules, and each one is a test below.
 *
 * - **Never ask twice.** A photo already in the store, already queued, or
 *   already in flight is dropped on the spot.
 * - **One lookup at a time.** A scroll fires many bursts per second. Running
 *   them together would send the same photo in two requests and would put
 *   dozens of requests in flight. `drain` runs alone and, if more photos
 *   arrived while it worked, runs once more afterwards.
 * - **A photo that could not be read goes back to the queue.** It is not a
 *   verdict, so the next drain tries it again.
 *
 * No DOM, no timers and no network here. The caller owns the debounce timer,
 * which keeps the whole queue unit testable.
 */

/**
 * @typedef {import('./albumLocationScan.js').AlbumLocationScanResult} AlbumLocationScanResult
 *
 * @typedef {object} LocationLookupQueueDependencies
 * @property {(mediaId: string) => boolean} isKnown
 *   True when the store already holds a verdict for this photo.
 * @property {(mediaIds: readonly string[]) => Promise<AlbumLocationScanResult>} lookUp
 * @property {(result: AlbumLocationScanResult) => void} onResults
 * @property {(error: unknown) => void} [onError]
 *
 * @typedef {object} LocationLookupQueue
 * @property {(mediaIds: Iterable<string>) => number} enqueue  Returns how many were actually added.
 * @property {() => Promise<void>} drain
 * @property {() => number} pendingCount
 */

/**
 * @param {LocationLookupQueueDependencies} deps
 * @returns {LocationLookupQueue}
 */
export function createLocationLookupQueue(deps) {
  /** @type {Set<string>} Waiting to be asked about. */
  const pending = new Set();

  /** @type {Set<string>} Being asked about right now. */
  const inFlight = new Set();

  /** @type {Promise<void> | null} */
  let running = null;

  /** Set when photos arrive while a drain is running, so one more drain follows. */
  let drainAgain = false;

  /**
   * @param {Iterable<string>} mediaIds
   * @returns {number}
   */
  function enqueue(mediaIds) {
    let added = 0;
    for (const mediaId of mediaIds) {
      if (mediaId === '' || pending.has(mediaId) || inFlight.has(mediaId) || deps.isKnown(mediaId)) continue;
      pending.add(mediaId);
      added += 1;
    }
    if (added > 0 && running !== null) drainAgain = true;
    return added;
  }

  async function runOnce() {
    const batch = [...pending];
    pending.clear();
    for (const mediaId of batch) inFlight.add(mediaId);

    try {
      const result = await deps.lookUp(batch);
      deps.onResults(result);
      // A photo the scan could not read is not a verdict. Put it back so a
      // later drain asks again, but only if nothing has since answered it.
      for (const [mediaId, state] of result.states) {
        if (state === 'unknown' && !deps.isKnown(mediaId)) pending.add(mediaId);
      }
    } catch (error) {
      deps.onError?.(error);
      // The whole batch is unanswered, so none of it is lost.
      for (const mediaId of batch) pending.add(mediaId);
    } finally {
      for (const mediaId of batch) inFlight.delete(mediaId);
    }
  }

  async function drain() {
    if (running !== null) {
      drainAgain = true;
      return running;
    }

    running = (async () => {
      try {
        do {
          drainAgain = false;
          if (pending.size === 0) return;
          await runOnce();
          // A batch that answered nothing puts every photo back. Draining again
          // at once would spin, so that case waits for the next caller.
        } while (drainAgain && pending.size > 0);
      } finally {
        running = null;
      }
    })();

    return running;
  }

  return { enqueue, drain, pendingCount: () => pending.size };
}
