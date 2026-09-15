/**
 * The scan loop. It takes the album's media ids and answers, for each one,
 * whether the photo carries a location.
 *
 * ## Why this file has no DOM and no `fetch`
 *
 * Every browser action arrives as a function in `deps`, so the whole loop runs
 * in a unit test with a fake reader and a virtual clock, and finishes at once.
 * Put a real request in here and that stops being true.
 *
 * ## What is retried, and what is never retried
 *
 * A retry is only ever for **the request not working**: the network failed, the
 * endpoint answered with an error, or an answer came back missing or unreadable.
 * Those are not facts about the photo, and asking again costs one small request.
 *
 * A verdict is **never** retried. `has-location` and `no-location` are answers
 * about the photo, and the next attempt returns the same answer.
 *
 * A photo still unanswered after the last attempt is recorded as `unknown`, not
 * as `no-location`. The two must never be mixed: `unknown` means "we could not
 * read it", and badging it as missing would tell the user to fix a photo that
 * may be fine.
 */

/**
 * @typedef {import('./mediaLocationReading.js').MediaLocationReading} MediaLocationReading
 */

/**
 * How long to wait before each attempt at one chunk, in milliseconds.
 *
 * The list length is also the attempt count. The first attempt waits for
 * nothing, so the common case stays fast. The gaps that follow back off,
 * because the usual reason for a failure is Google answering `429` (too many
 * requests), and going straight back makes that worse.
 */
export const CHUNK_ATTEMPT_DELAYS_MS = [0, 900, 2500, 6000];

/** Photos asked about in one request. One hundred answers in under a second. */
export const DEFAULT_CHUNK_SIZE = 100;

/** Requests in flight at the same time. Three keeps a large album fast and stays polite. */
export const DEFAULT_PARALLEL_REQUESTS = 3;

/**
 * @typedef {'has-location' | 'no-location' | 'unknown'} PhotoLocationState
 *
 * @typedef {object} AlbumLocationScanCounts
 * @property {number} total
 * @property {number} withLocation
 * @property {number} withoutLocation
 * @property {number} unknown
 *
 * @typedef {object} AlbumLocationScanResult
 * @property {Map<string, PhotoLocationState>} states
 * @property {Map<string, MediaLocationReading>} readings  Only the photos that answered.
 * @property {AlbumLocationScanCounts} counts
 * @property {boolean} stoppedEarly
 * @property {string[]} failureReasons  One line per failed attempt, for the diagnostics report.
 *
 * @typedef {object} AlbumLocationScanDependencies
 * @property {readonly string[]} mediaIds
 * @property {(mediaIds: readonly string[]) => Promise<ReadonlyMap<string, MediaLocationReading | null>>} readChunk
 *   Asks about one chunk. A media id missing from the answer, or mapped to null,
 *   means "not read"; the loop tries those again.
 * @property {(milliseconds: number) => Promise<void>} wait
 * @property {() => boolean} [shouldStop]
 * @property {(counts: AlbumLocationScanCounts) => void} [onProgress]
 * @property {number} [chunkSize]
 * @property {number} [parallelRequests]
 */

/**
 * @template T
 * @param {readonly T[]} items
 * @param {number} size
 * @returns {T[][]}
 */
function splitIntoChunks(items, size) {
  /** @type {T[][]} */
  const chunks = [];
  for (let start = 0; start < items.length; start += size) chunks.push(items.slice(start, start + size));
  return chunks;
}

/**
 * @param {AlbumLocationScanDependencies} deps
 * @returns {Promise<AlbumLocationScanResult>}
 */
export async function scanAlbumLocations(deps) {
  const chunkSize = deps.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const parallelRequests = deps.parallelRequests ?? DEFAULT_PARALLEL_REQUESTS;
  const shouldStop = deps.shouldStop ?? (() => false);

  /** @type {Map<string, PhotoLocationState>} */
  const states = new Map();
  /** @type {Map<string, MediaLocationReading>} */
  const readings = new Map();
  /** @type {string[]} */
  const failureReasons = [];

  const counts = { total: deps.mediaIds.length, withLocation: 0, withoutLocation: 0, unknown: 0 };
  const reportProgress = () => deps.onProgress?.({ ...counts });

  let stoppedEarly = false;

  /**
   * Runs one chunk to a verdict for every photo in it.
   * @param {readonly string[]} chunk
   * @returns {Promise<void>}
   */
  async function runChunk(chunk) {
    let pending = [...chunk];

    for (const [attempt, delayMs] of CHUNK_ATTEMPT_DELAYS_MS.entries()) {
      if (pending.length === 0) return;
      if (shouldStop()) {
        stoppedEarly = true;
        return;
      }
      if (delayMs > 0) await deps.wait(delayMs);

      /** @type {ReadonlyMap<string, MediaLocationReading | null>} */
      let answers;
      try {
        answers = await deps.readChunk(pending);
      } catch (error) {
        failureReasons.push(`attempt ${attempt + 1} of ${pending.length} photos failed: ${String(error)}`);
        continue;
      }

      /** @type {string[]} */
      const stillPending = [];
      for (const mediaId of pending) {
        const reading = answers.get(mediaId) ?? null;
        if (reading === null) {
          stillPending.push(mediaId);
          continue;
        }
        readings.set(mediaId, reading);
        states.set(mediaId, reading.state);
        if (reading.state === 'has-location') counts.withLocation += 1;
        else counts.withoutLocation += 1;
      }

      if (stillPending.length > 0 && stillPending.length === pending.length) {
        failureReasons.push(`attempt ${attempt + 1} answered none of ${pending.length} photos`);
      }
      pending = stillPending;
      reportProgress();
    }

    // Out of attempts. These stay unknown, which is not the same as missing.
    for (const mediaId of pending) {
      states.set(mediaId, 'unknown');
      counts.unknown += 1;
    }
    reportProgress();
  }

  const chunks = splitIntoChunks(deps.mediaIds, chunkSize);
  for (let start = 0; start < chunks.length; start += parallelRequests) {
    if (shouldStop()) {
      stoppedEarly = true;
      break;
    }
    await Promise.all(chunks.slice(start, start + parallelRequests).map(runChunk));
  }

  return { states, readings, counts, stoppedEarly, failureReasons };
}
