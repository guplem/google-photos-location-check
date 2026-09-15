/**
 * Builds and reads the messages of `batchexecute`, the endpoint the Google
 * Photos web app uses for its own data calls.
 *
 * ## The shape, in plain terms
 *
 * One HTTP request carries many calls. Each call is
 * `[rpcId, argumentsAsJsonString, null, slotId]`, and all of them go in one
 * `f.req` form field. The answer comes back as several lines of text. The lines
 * that matter start with `[` and hold rows; a row whose first field is
 * `"wrb.fr"` is one answer, its third field is the payload as a JSON string,
 * and its seventh field is the slot id of the call it answers.
 *
 * **The answers arrive in any order.** A request for 100 photos comes back with
 * the slots shuffled, so a reader that pairs answer number 1 with photo number 1
 * pairs the wrong photo with the wrong location. The slot id is the only link
 * back, which is why `readBatchExecuteAnswers` returns it and never an index.
 *
 * No DOM and no network here, so every parse is unit tested with strings.
 */

/** Where the Google Photos web app sends its data calls. */
export const BATCH_EXECUTE_PATH = '/_/PhotosUi/data/batchexecute';

/**
 * @typedef {import('./pageTokens.js').PageTokens} PageTokens
 *
 * @typedef {object} BatchExecuteCall
 * @property {string} slotId     Our own label, echoed back on the answer.
 * @property {unknown[]} args    The call arguments, serialised into the request.
 *
 * @typedef {object} BatchExecuteAnswer
 * @property {string} slotId
 * @property {unknown} payload   The parsed answer for that slot.
 */

/**
 * @param {string} rpcId
 * @param {readonly BatchExecuteCall[]} calls
 * @param {PageTokens} tokens
 * @param {string} sourcePath   The path of the page we are on, as the web app sends it.
 * @returns {{ url: string, body: string }}
 */
export function buildBatchExecuteRequest(rpcId, calls, tokens, sourcePath) {
  const query = new URLSearchParams({
    rpcids: rpcId,
    'source-path': sourcePath,
    'f.sid': tokens.sessionId,
    bl: tokens.buildLabel,
    // Google's own client sends a changing request id. A repeated one can be
    // answered from a cache, which would hide a change made elsewhere.
    _reqid: String(Math.floor(Math.random() * 1000000)),
    rt: 'c',
  });

  const envelope = calls.map((call) => [rpcId, JSON.stringify(call.args), null, call.slotId]);
  const body = new URLSearchParams({ 'f.req': JSON.stringify([envelope]), at: tokens.requestToken });

  return { url: `${BATCH_EXECUTE_PATH}?${query.toString()}`, body: body.toString() };
}

/**
 * Pulls one answer per slot out of the response text.
 *
 * Anything it cannot parse is skipped rather than thrown, because one damaged
 * answer must not lose the other ninety-nine in the same request. The caller
 * compares the slots it asked for against the slots it got back.
 * @param {string} responseText
 * @returns {BatchExecuteAnswer[]}
 */
export function readBatchExecuteAnswers(responseText) {
  /** @type {BatchExecuteAnswer[]} */
  const answers = [];

  for (const line of responseText.split('\n')) {
    const trimmed = line.trim();
    // Every other line is a byte count or Google's anti-hijack prefix.
    if (!trimmed.startsWith('[')) continue;

    /** @type {unknown} */
    let rows;
    try {
      rows = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!Array.isArray(rows)) continue;

    for (const row of rows) {
      if (!Array.isArray(row) || row[0] !== 'wrb.fr') continue;
      const payloadText = row[2];
      const slotId = row[6];
      if (typeof payloadText !== 'string' || typeof slotId !== 'string') continue;
      try {
        answers.push({ slotId, payload: JSON.parse(payloadText) });
      } catch {
        // A payload we cannot read is the same as an answer we never got.
      }
    }
  }

  return answers;
}
