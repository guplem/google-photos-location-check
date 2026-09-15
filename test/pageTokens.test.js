import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { readPageTokens } from '../src/photosRpc/pageTokens.js';

const COMPLETE_SCRIPT_TEXT = 'window.WIZ_global_data = {"SNlM0e":"token-abc","cfb2h":"build-42","FdrFJe":"-session-7"};';

test('reads the three tokens out of the inline script text', () => {
  assert.deepEqual(readPageTokens(COMPLETE_SCRIPT_TEXT), {
    requestToken: 'token-abc',
    buildLabel: 'build-42',
    sessionId: '-session-7',
  });
});

test('answers null when any single token is missing', () => {
  for (const missingKey of ['SNlM0e', 'cfb2h', 'FdrFJe']) {
    const withoutOne = COMPLETE_SCRIPT_TEXT.replace(`"${missingKey}":`, '"someOtherKey":');
    assert.equal(readPageTokens(withoutOne), null, `expected null when ${missingKey} is absent`);
  }
});

test('answers null for a page that carries no tokens at all', () => {
  assert.equal(readPageTokens(''), null);
});
