import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { buildDiagnosticsReport } from '../src/diagnosticsReport.js';
import { DEFAULT_SETTINGS } from '../src/settings/extensionSettings.js';

/** @param {Partial<import('../src/diagnosticsReport.js').DiagnosticsInput>} overrides */
function buildInput(overrides = {}) {
  return {
    extensionVersion: '0.1.0',
    url: 'https://photos.google.com/album/album-1',
    albumKey: 'album-1',
    photosKnown: 300,
    photosWithLocation: 142,
    photosWithoutLocation: 158,
    photosPending: 0,
    photosUnreadable: 0,
    photosInAlbum: null,
    recentFailures: [],
    settings: DEFAULT_SETTINGS,
    ...overrides,
  };
}

test('reports the counts and the page it was taken on', () => {
  const report = buildDiagnosticsReport(buildInput());

  assert.match(report, /album: album-1/);
  assert.match(report, /without a location: 158/);
  assert.match(report, /extension version: 0\.1\.0/);
});

test('says the album size is not known until a sweep reached the end', () => {
  assert.match(buildDiagnosticsReport(buildInput()), /photos in the album: \(not read to the end yet\)/);
  assert.match(buildDiagnosticsReport(buildInput({ photosInAlbum: 1611 })), /photos in the album: 1611/);
});

test('says the album is missing rather than printing nothing', () => {
  const report = buildDiagnosticsReport(buildInput({ albumKey: null }));

  assert.match(report, /album: \(not an album page\)/);
});

test('explains "could not be read" only when it happened', () => {
  assert.doesNotMatch(buildDiagnosticsReport(buildInput()), /could not be read" means/);
  assert.match(buildDiagnosticsReport(buildInput({ photosUnreadable: 4 })), /could not be read" means/);
});

test('lists the request failures, or says there were none', () => {
  assert.match(buildDiagnosticsReport(buildInput()), /\(none\)/);
  assert.match(buildDiagnosticsReport(buildInput({ recentFailures: ['attempt 1 failed: 429'] })), /- attempt 1 failed: 429/);
});

test('prints every setting, so a wrong one is visible', () => {
  const report = buildDiagnosticsReport(buildInput());

  for (const key of Object.keys(DEFAULT_SETTINGS)) assert.ok(report.includes(key + ':'), 'missing ' + key);
});
