/**
 * Reads the three request tokens that Google Photos puts in its own page.
 *
 * The extension calls the same internal endpoint the web app calls, so it must
 * present the same tokens the web app presents. All three sit inside inline
 * `<script>` text under a key whose name carries no meaning (`SNlM0e` and so
 * on). Those keys are Google's, not ours, and a rename breaks the read. That is
 * why `readPageTokens` answers `null` for a missing token instead of guessing:
 * the caller then reports a clear failure rather than sending a request that
 * comes back as an unexplained 400.
 *
 * No DOM here. The caller passes the joined script text, so the whole parse is
 * unit tested with strings.
 */

/** Cross-site request token. Google Photos calls it `SNlM0e`. */
const REQUEST_TOKEN_PATTERN = /"SNlM0e":"([^"]+)"/;

/** Build label of the running web app. Google Photos calls it `cfb2h`. */
const BUILD_LABEL_PATTERN = /"cfb2h":"([^"]+)"/;

/** Session id of the running web app. Google Photos calls it `FdrFJe`. */
const SESSION_ID_PATTERN = /"FdrFJe":"([^"]+)"/;

/**
 * @typedef {object} PageTokens
 * @property {string} requestToken  Sent as the `at` form field.
 * @property {string} buildLabel    Sent as the `bl` query parameter.
 * @property {string} sessionId     Sent as the `f.sid` query parameter.
 */

/**
 * @param {string} scriptText  Every inline script of the page, joined.
 * @returns {PageTokens | null} null when any token is missing.
 */
export function readPageTokens(scriptText) {
  const requestToken = REQUEST_TOKEN_PATTERN.exec(scriptText)?.[1];
  const buildLabel = BUILD_LABEL_PATTERN.exec(scriptText)?.[1];
  const sessionId = SESSION_ID_PATTERN.exec(scriptText)?.[1];

  // A missing token means the page shape changed. A half-read page is a bug
  // worth reporting, not worth working around silently.
  if (requestToken === undefined || buildLabel === undefined || sessionId === undefined) return null;

  return { requestToken, buildLabel, sessionId };
}
