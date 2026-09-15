/**
 * Asks Google Photos itself for the location of a batch of photos.
 *
 * ## What it calls, and why that is allowed
 *
 * The Google Photos web app answers its own info panel with an internal call
 * named `fDcn4b`, sent to `batchexecute`. This extension sends the same call.
 * The request goes to `photos.google.com` from a script running inside that
 * same page, so it is a same-origin request and it carries the signed-in
 * session on its own. There is no separate sign-in and no stored credential.
 *
 * ## Why it is a thin adapter
 *
 * Everything that can be decided is decided elsewhere: the message shape lives
 * in `batchExecuteMessage.js`, the tokens in `pageTokens.js`, and the verdict
 * in `../locationState/mediaLocationReading.js`. All three are unit tested. This
 * file only reads the page, sends the request, and joins the answers back to
 * the photos they belong to.
 *
 * ## The failures it must raise rather than hide
 *
 * A network error, a non-2xx answer, and a timeout are all thrown. The caller
 * (`albumLocationScan.js`) retries them with a backoff. A photo that answered
 * something unreadable is **not** an error: it comes back as `null`, which the
 * scan treats as "ask again", and finally as `unknown`.
 */

import { readMediaLocation } from '../locationState/mediaLocationReading.js';
import { buildBatchExecuteRequest, readBatchExecuteAnswers } from './batchExecuteMessage.js';
import { readPageTokens } from './pageTokens.js';

/** The call the info panel uses. It takes one media id and answers with that photo's details. */
export const PHOTO_DETAILS_RPC_ID = 'fDcn4b';

/**
 * How long one request may take before it is abandoned.
 *
 * A request that never settles is worse than one that fails: the scan waits on
 * it forever and no badge ever appears. Raising this ceiling is cheap, because
 * a healthy request returns in under a second.
 */
export const REQUEST_TIMEOUT_MS = 20000;

/**
 * @typedef {import('../locationState/mediaLocationReading.js').MediaLocationReading} MediaLocationReading
 *
 * @typedef {object} PhotosRpcClientDeps
 * @property {Document} document
 * @property {typeof fetch} fetch
 * @property {() => string} readSourcePath  The path of the page we are on.
 */

/**
 * Collects the text of every inline script in the page.
 *
 * The tokens sit in one of them. Reading `textContent` is allowed from the
 * isolated world; reading the page's own JavaScript variables is not, which is
 * why this goes through the DOM and not through `window`.
 * @param {Document} ownerDocument
 * @returns {string}
 */
function readInlineScriptText(ownerDocument) {
  const parts = [];
  for (const script of ownerDocument.querySelectorAll('script')) {
    if (script.src === '') parts.push(script.textContent ?? '');
  }
  return parts.join('\n');
}

/**
 * @param {PhotosRpcClientDeps} deps
 */
export function createPhotosRpcClient(deps) {
  return {
    /**
     * Asks about one batch of photos and answers for each of them.
     *
     * @param {readonly string[]} mediaIds
     * @returns {Promise<Map<string, MediaLocationReading | null>>}
     *   A value of null means "this photo did not answer", never "no location".
     * @throws when the request itself fails, so the caller can try again.
     */
    async readLocations(mediaIds) {
      /** @type {Map<string, MediaLocationReading | null>} */
      const readings = new Map();
      if (mediaIds.length === 0) return readings;
      for (const mediaId of mediaIds) readings.set(mediaId, null);

      const tokens = readPageTokens(readInlineScriptText(deps.document));
      if (tokens === null) {
        throw new Error('Google Photos page tokens not found. The page shape may have changed.');
      }

      // The slot id is the only thing that ties an answer back to its photo,
      // because the answers come back in any order.
      /** @type {Map<string, string>} */
      const mediaIdBySlot = new Map();
      const calls = mediaIds.map((mediaId, index) => {
        const slotId = String(index + 1);
        mediaIdBySlot.set(slotId, mediaId);
        return { slotId, args: [mediaId] };
      });

      const { url, body } = buildBatchExecuteRequest(PHOTO_DETAILS_RPC_ID, calls, tokens, deps.readSourcePath());

      const abort = new AbortController();
      const timeout = setTimeout(() => abort.abort(), REQUEST_TIMEOUT_MS);
      let responseText;
      try {
        const response = await deps.fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' },
          body,
          credentials: 'include',
          signal: abort.signal,
        });
        if (!response.ok) {
          throw new Error('Google Photos answered ' + String(response.status) + ' for ' + String(mediaIds.length) + ' photos');
        }
        responseText = await response.text();
      } finally {
        clearTimeout(timeout);
      }

      for (const answer of readBatchExecuteAnswers(responseText)) {
        const mediaId = mediaIdBySlot.get(answer.slotId);
        if (mediaId === undefined) continue;
        readings.set(mediaId, readMediaLocation(answer.payload, mediaId));
      }

      return readings;
    },
  };
}

/** @typedef {ReturnType<typeof createPhotosRpcClient>} PhotosRpcClient */
