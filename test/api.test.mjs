import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SainaApi, buildQuestion, parseState, serviceOrigin, studioUrl, summarize } from './out/api.mjs';

test('base URL rules', () => {
  assert.equal(serviceOrigin('https://api.saina.run/'), 'https://api.saina.run');
  assert.equal(serviceOrigin('http://localhost:8000'), 'http://localhost:8000');
  assert.throws(() => serviceOrigin('http://example.com'));
  assert.throws(() => serviceOrigin('https://u:p@api.saina.run'));
  assert.equal(studioUrl('https://api.saina.run'), 'https://saina.run/studio/');
});

test('questions', () => {
  assert.deepEqual(buildQuestion({ type: 'noul', instructions: ' Urgent? ' }), { answer: { type: 'noul', instructions: 'Urgent?' } });
  assert.deepEqual(buildQuestion({ type: 'choice', instructions: 'Team', criteria: ['billing: Charges', ' other'] }).answer.criteria, { billing: 'Charges', other: 'other' });
  assert.throws(() => buildQuestion({ type: 'choice', instructions: 'Team', criteria: ['one'] }));
  assert.throws(() => buildQuestion({ type: 'score', instructions: 'x', criteria: ['a'] }));
});

test('state parsing', () => {
  assert.deepEqual(parseState(' {"a":1} '), { a: 1 });
  assert.equal(parseState('{not json'), '{not json');
});

test('summaries', () => {
  assert.deepEqual(summarize({ decision_id: 'd', status: 'completed', answers: { urgent: { status: 'selected', selection: true, probability_of_true: 0.93 }, team: { status: 'abstained' } } }), ['urgent: true (P(yes) 93%)', 'team: abstained']);
  assert.deepEqual(summarize({ decision_id: 'd', status: 'error', answers: {}, error: { code: 'x', message: 'boom' } }), ['error: boom']);
});

test('requests carry the key, client header and no redirects', async () => {
  const calls = [];
  const fake = async (url, init) => { calls.push([url, init]); return new Response(JSON.stringify({ saina: { models: [{ name: 'saina-helm-3-0.8b' }] } }), { status: 200 }); };
  const d = await new SainaApi('https://api.saina.run', 'sk_test', fake).discover();
  assert.equal(d.saina.models[0].name, 'saina-helm-3-0.8b');
  assert.deepEqual(d.endpoints, []);
  assert.equal(calls[0][0], 'https://api.saina.run/v1/studio/discovery');
  assert.equal(calls[0][1].headers.Authorization, 'Bearer sk_test');
  assert.equal(calls[0][1].headers['X-Saina-Client'], 'vscode');
  assert.equal(calls[0][1].redirect, 'error');
});

test('errors surface the server message', async () => {
  const fake = async () => new Response(JSON.stringify({ error: { code: 'unauthorized', message: 'Invalid API key' } }), { status: 401 });
  await assert.rejects(new SainaApi('https://api.saina.run', 'bad', fake).discover(), e => e.status === 401 && e.code === 'unauthorized' && e.message === 'Invalid API key');
});
