/**
 * Builds the text report the panel copies to the clipboard.
 *
 * The whole point of this file is that it is **pure**. It reads nothing and
 * calls nothing: every fact arrives as an argument. That is deliberate. In the
 * sibling extension the report builder called `chrome.runtime.getManifest()`,
 * and every `chrome.*` call throws once the extension is reloaded while a page
 * is still open ("Extension context invalidated"). The report the user pressed
 * for after a long session was the one thing that could not be produced. So the
 * caller reads the version, catches its own failure, and passes a string.
 *
 * Nothing in the report is sent anywhere. The user copies it and decides.
 */

/**
 * @typedef {import('./settings/extensionSettings.js').ExtensionSettings} ExtensionSettings
 *
 * @typedef {object} DiagnosticsInput
 * @property {string} extensionVersion
 * @property {string} url
 * @property {string | null} albumKey
 * @property {number} photosKnown
 * @property {number} photosWithLocation
 * @property {number} photosWithoutLocation
 * @property {number} photosPending
 * @property {number} photosUnreadable
 * @property {readonly string[]} recentFailures
 * @property {ExtensionSettings} settings
 */

/**
 * @param {string} title
 * @param {readonly string[]} lines
 * @returns {string[]}
 */
function section(title, lines) {
  return ['## ' + title, ...lines, ''];
}

/**
 * @param {DiagnosticsInput} input
 * @returns {string}
 */
export function buildDiagnosticsReport(input) {
  /** @type {string[]} */
  const lines = [
    '# Google Photos Location Check diagnostics',
    '',
    ...section('Page', [
      'extension version: ' + input.extensionVersion,
      'url: ' + input.url,
      'album: ' + (input.albumKey ?? '(not an album page)'),
    ]),
    ...section('Photos seen in this album', [
      'read so far: ' + String(input.photosKnown),
      'with a location: ' + String(input.photosWithLocation),
      'without a location: ' + String(input.photosWithoutLocation),
      'waiting to be read: ' + String(input.photosPending),
      'could not be read: ' + String(input.photosUnreadable),
    ]),
  ];

  // "Could not be read" is the one number that means something is wrong. Say so
  // here, so a user who copies this report does not have to know that already.
  if (input.photosUnreadable > 0) {
    lines.push(
      ...section('What "could not be read" means', [
        'Google answered, but the answer did not hold a location where this',
        'extension expects one. That usually means Google changed the shape of',
        'its answer, and the extension needs an update. No photo was changed.',
      ]),
    );
  }

  lines.push(
    ...section(
      'Recent request failures',
      input.recentFailures.length === 0 ? ['(none)'] : input.recentFailures.map((failure) => '- ' + failure),
    ),
  );

  lines.push(
    ...section(
      'Settings',
      Object.entries(input.settings).map(([key, value]) => key + ': ' + JSON.stringify(value)),
    ),
  );

  return lines.join('\n');
}
