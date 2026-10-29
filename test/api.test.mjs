import { test } from 'node:test';
import assert from 'node:assert/strict';
import { McpTransport, RestTransport, SainaApi, buildQuestion, isLoopback, parseState, serviceOrigin, studioUrl, summarize } from './out/api.mjs';

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

test('self-hosted REST: routes, query and path arguments, no credentials, no redirects', async () => {
  const calls = [];
  const fake = async (url, init) => { calls.push([url, init]); return new Response(JSON.stringify({ decisions: [], total: 0, next_offset: null }), { status: 200 }); };
  const api = new SainaApi('http://localhost:8000', new RestTransport('http://localhost:8000', fake));
  await api.decisions({ endpoint: 'ticket-router', abstained: true });
  assert.equal(calls[0][0], 'http://localhost:8000/v1/studio/decisions?limit=50&offset=0&endpoint=ticket-router&abstained=true');
  assert.equal(calls[0][1].headers.Authorization, undefined);
  assert.equal(calls[0][1].headers['X-Saina-Client'], 'vscode');
  assert.equal(calls[0][1].redirect, 'error');
  await api.decideWithEndpoint('ticket router', 'production', 'hi').catch(() => {});
  assert.equal(calls[1][0], 'http://localhost:8000/v1/studio/endpoints/ticket%20router/decide');
  assert.deepEqual(JSON.parse(calls[1][1].body), { version: 'production', state: 'hi' });
  assert.ok(isLoopback('http://127.0.0.1:8000') && !isLoopback('https://api.saina.run'));
});

test('hosted MCP: tools/call with the OAuth token and confirm_cost after the person confirmed', async () => {
  const calls = [];
  const decision = { decision_id: 'dec_1', status: 'completed', answers: { urgent: { status: 'selected', selection: true } } };
  const fake = async (url, init) => { calls.push([url, init]); return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { isError: false, content: [{ type: 'text', text: JSON.stringify({ decision }) }] } }), { status: 200 }); };
  const api = new SainaApi('https://api.saina.run', new McpTransport('https://api.saina.run', async () => 'smo_token', fake));
  const d = await api.decideWithModel('saina', 'saina-helm-3-0.8b', 'x', { urgent: { type: 'noul', instructions: 'Urgent?' } }, {});
  assert.equal(d.decision_id, 'dec_1');
  assert.equal(calls[0][0], 'https://api.saina.run/v1/mcp');
  assert.equal(calls[0][1].headers.Authorization, 'Bearer smo_token');
  const rpc = JSON.parse(calls[0][1].body);
  assert.equal(rpc.method, 'tools/call');
  assert.equal(rpc.params.name, 'test_model');
  assert.equal(rpc.params.arguments.confirm_cost, true);
  assert.equal(rpc.params.arguments.definition.model.name, 'saina-helm-3-0.8b');
});

test('hosted MCP: tool errors and HTTP errors surface the server message', async () => {
  const toolError = async () => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: { code: 'permission_denied', message: 'API key lacks playground:rw' } }) }] } }), { status: 200 });
  await assert.rejects(new SainaApi('https://api.saina.run', new McpTransport('https://api.saina.run', async () => 't', toolError)).discover(), e => e.code === 'permission_denied' && /playground:rw/.test(e.message));
  const http = async () => new Response(JSON.stringify({ error: { code: 'invalid_api_key', message: 'Connect with OAuth or send an API key' } }), { status: 401 });
  await assert.rejects(new SainaApi('https://api.saina.run', new McpTransport('https://api.saina.run', async () => 't', http)).discover(), e => e.status === 401 && e.code === 'invalid_api_key');
});
