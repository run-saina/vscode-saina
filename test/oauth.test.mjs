import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { LOOPBACK_PORTS, SainaOAuth, pkce } from './out/oauth.mjs';

const b64url = b => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

test('PKCE challenge is the S256 of the verifier', () => {
  const { verifier, challenge } = pkce();
  assert.match(verifier, /^[A-Za-z0-9_-]{43,128}$/);
  assert.equal(challenge, b64url(createHash('sha256').update(verifier).digest()));
});

test('register, authorize through the loopback redirect, exchange, refresh and revoke', async () => {
  const base = 'https://api.saina.run', meta = { authorization_endpoint: base + '/v1/mcp-oauth/authorize', token_endpoint: base + '/v1/mcp-oauth/token', registration_endpoint: base + '/v1/mcp-oauth/register', revocation_endpoint: base + '/v1/mcp-oauth/revoke' };
  const seen = [];
  let challenge = '';
  const fake = async (url, init) => {
    seen.push([url, init?.body]);
    if (url === meta.registration_endpoint) {
      const body = JSON.parse(init.body);
      assert.deepEqual(body.redirect_uris, LOOPBACK_PORTS.map(p => 'http://127.0.0.1:' + p + '/callback'));
      assert.equal(body.token_endpoint_auth_method, 'none');
      return Response.json({ client_id: 'smc_1' }, { status: 201 });
    }
    const form = new URLSearchParams(init.body);
    if (url === meta.token_endpoint && form.get('grant_type') === 'authorization_code') {
      assert.equal(form.get('code'), 'code-1');
      assert.equal(b64url(createHash('sha256').update(form.get('code_verifier')).digest()), challenge);
      assert.match(form.get('redirect_uri'), /^http:\/\/127\.0\.0\.1:4782\d\/callback$/);
      return Response.json({ access_token: 'smo_a', refresh_token: 'r1', expires_in: 3600 });
    }
    if (url === meta.token_endpoint && form.get('grant_type') === 'refresh_token') {
      assert.equal(form.get('refresh_token'), 'r1');
      return Response.json({ access_token: 'smo_b', refresh_token: 'r2', expires_in: 3600 });
    }
    if (url === meta.revocation_endpoint) return new Response(null, { status: 200 });
    return new Response('{}', { status: 404 });
  };
  const oauth = new SainaOAuth(base, fake);
  const clientId = await oauth.register(meta, 'Test');
  // The "browser": read the consent URL, then follow the redirect the server would send.
  const session = await oauth.authorize(meta, clientId, async url => {
    const u = new URL(url);
    assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(u.searchParams.get('resource'), base + '/v1/mcp');
    assert.equal(u.searchParams.get('scope'), 'mcp');
    challenge = u.searchParams.get('code_challenge');
    const r = await fetch(u.searchParams.get('redirect_uri') + '?code=code-1&state=' + u.searchParams.get('state'));
    assert.equal(r.status, 200);
  });
  assert.equal(session.accessToken, 'smo_a');
  const next = await oauth.refresh(meta, session);
  assert.equal(next.refreshToken, 'r2');
  await oauth.revoke(meta, next);
  assert.equal(new URLSearchParams(seen.at(-1)[1]).get('token'), 'r2');
});

test('a redirect with the wrong state is refused', async () => {
  const meta = { authorization_endpoint: 'https://x/authorize', token_endpoint: 'https://x/token', registration_endpoint: 'https://x/register' };
  const oauth = new SainaOAuth('https://x', async () => Response.json({}));
  await assert.rejects(oauth.authorize(meta, 'smc_1', async url => {
    const u = new URL(url);
    await fetch(u.searchParams.get('redirect_uri') + '?code=c&state=forged');
  }), e => e.error === 'invalid_request');
});
