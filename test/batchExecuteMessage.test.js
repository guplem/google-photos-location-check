import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { BATCH_EXECUTE_PATH, buildBatchExecuteRequest, readBatchExecuteAnswers } from '../src/photosRpc/batchExecuteMessage.js';

const TOKENS = { requestToken: 'token-abc', buildLabel: 'build-42', sessionId: '-session-7' };

/** The line Google puts first so the body is not valid JSON on its own. */
const ANTI_HIJACK_PREFIX = ')]}\u0027';

test('puts every call in one request, each under its own slot id', () => {
  const { url, body } = buildBatchExecuteRequest(
    'fDcn4b',
    [
      { slotId: '1', args: ['media-one'] },
      { slotId: '2', args: ['media-two'] },
    ],
    TOKENS,
    '/album/album-key',
  );

  assert.ok(url.startsWith(`${BATCH_EXECUTE_PATH}?`));
  const query = new URLSearchParams(url.slice(url.indexOf('?') + 1));
  assert.equal(query.get('rpcids'), 'fDcn4b');
  assert.equal(query.get('source-path'), '/album/album-key');
  assert.equal(query.get('f.sid'), '-session-7');
  assert.equal(query.get('bl'), 'build-42');

  const form = new URLSearchParams(body);
  assert.equal(form.get('at'), 'token-abc');
  assert.deepEqual(JSON.parse(String(form.get('f.req'))), [
    [
      ['fDcn4b', '["media-one"]', null, '1'],
      ['fDcn4b', '["media-two"]', null, '2'],
    ],
  ]);
});

test('sends a changing request id, so no answer is served from a cache', () => {
  const requestIds = new Set();
  for (let attempt = 0; attempt < 40; attempt++) {
    const { url } = buildBatchExecuteRequest('fDcn4b', [{ slotId: '1', args: [] }], TOKENS, '/album/a');
    requestIds.add(new URLSearchParams(url.slice(url.indexOf('?') + 1)).get('_reqid'));
  }
  assert.ok(requestIds.size > 1, 'expected the request id to change between calls');
});

test('reads the answers back and keeps each tied to its slot, whatever the order', () => {
  const responseText = [
    ANTI_HIJACK_PREFIX,
    '123',
    JSON.stringify([
      ['wrb.fr', 'fDcn4b', JSON.stringify(['second']), null, null, null, '2'],
      ['wrb.fr', 'fDcn4b', JSON.stringify(['first']), null, null, null, '1'],
    ]),
  ].join('\n');

  assert.deepEqual(readBatchExecuteAnswers(responseText), [
    { slotId: '2', payload: ['second'] },
    { slotId: '1', payload: ['first'] },
  ]);
});

test('skips a damaged answer instead of losing the whole request', () => {
  const responseText = JSON.stringify([
    ['wrb.fr', 'fDcn4b', '{not json', null, null, null, '1'],
    ['wrb.fr', 'fDcn4b', JSON.stringify(['good']), null, null, null, '2'],
  ]);

  assert.deepEqual(readBatchExecuteAnswers(responseText), [{ slotId: '2', payload: ['good'] }]);
});

test('ignores the rows that are not answers', () => {
  const responseText = JSON.stringify([
    ['er', 'fDcn4b', null],
    ['di', 42],
    ['af.httprm', 5, 'x'],
  ]);

  assert.deepEqual(readBatchExecuteAnswers(responseText), []);
});

test('answers with an empty list for text that holds no rows at all', () => {
  assert.deepEqual(readBatchExecuteAnswers(''), []);
  assert.deepEqual(readBatchExecuteAnswers(`${ANTI_HIJACK_PREFIX}\n\n`), []);
});
