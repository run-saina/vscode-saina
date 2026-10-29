// OAuth 2.1 for the Saina Studio MCP resource: dynamic client registration, PKCE (S256), a loopback redirect,
// rotating refresh tokens. No vscode imports, so tests run in plain Node.
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mcpUrl } from './api';

// Fixed loopback ports, registered once per client so the client can be reused across sign-ins.
export const LOOPBACK_PORTS = [47821, 47822, 47823, 47824, 47825];
const callback = (port: number) => 'http://127.0.0.1:' + port + '/callback';

export interface Session { origin: string; clientId: string; accessToken: string; refreshToken: string; expiresAt: number }
export interface Metadata { authorization_endpoint: string; token_endpoint: string; registration_endpoint: string; revocation_endpoint?: string }

const b64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export function pkce() {
  const verifier = b64url(randomBytes(48));
  return { verifier, challenge: b64url(createHash('sha256').update(verifier).digest()) };
}

export class OAuthError extends Error {
  constructor(readonly error: string, message: string) { super(message); }
}

export class SainaOAuth {
  constructor(readonly origin: string, private readonly fetchImpl: typeof fetch = fetch) {}

  async metadata(): Promise<Metadata> {
    const r = await this.fetchImpl(this.origin + '/.well-known/oauth-authorization-server', { redirect: 'error' });
    if (!r.ok) throw new OAuthError('server_error', 'This Saina server does not offer sign-in (HTTP ' + r.status + ')');
    return await r.json() as Metadata;
  }

  async register(meta: Metadata, clientName: string): Promise<string> {
    const r = await this.post(meta.registration_endpoint, { redirect_uris: LOOPBACK_PORTS.map(callback), client_name: clientName, token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'] }, true);
    return String(r.client_id);
  }

  // Opens the consent page with `open` and waits for the loopback redirect.
  async authorize(meta: Metadata, clientId: string, open: (url: string) => Promise<unknown>, timeoutMs = 300_000): Promise<Session> {
    const { verifier, challenge } = pkce();
    const state = b64url(randomBytes(16));
    const { port, code } = await listen(state, timeoutMs, async port => {
      const url = new URL(meta.authorization_endpoint);
      for (const [k, v] of Object.entries({ response_type: 'code', client_id: clientId, redirect_uri: callback(port), code_challenge: challenge, code_challenge_method: 'S256', state, scope: 'mcp', resource: mcpUrl(this.origin) })) url.searchParams.set(k, v);
      await open(url.toString());
    });
    return this.session(clientId, await this.post(meta.token_endpoint, { grant_type: 'authorization_code', code, redirect_uri: callback(port), client_id: clientId, code_verifier: verifier }));
  }

  async refresh(meta: Metadata, s: Session): Promise<Session> {
    return this.session(s.clientId, await this.post(meta.token_endpoint, { grant_type: 'refresh_token', refresh_token: s.refreshToken, client_id: s.clientId }));
  }

  async revoke(meta: Metadata, s: Session): Promise<void> {
    if (!meta.revocation_endpoint) return;
    try { await this.post(meta.revocation_endpoint, { token: s.refreshToken, client_id: s.clientId }); } catch { /* already gone */ }
  }

  private session(clientId: string, t: Record<string, unknown>): Session {
    if (typeof t.access_token !== 'string' || typeof t.refresh_token !== 'string') throw new OAuthError('server_error', 'Invalid token response');
    return { origin: this.origin, clientId, accessToken: t.access_token, refreshToken: t.refresh_token, expiresAt: Date.now() + Number(t.expires_in ?? 3600) * 1000 };
  }

  private async post(url: string, body: Record<string, string | string[]>, json = false): Promise<Record<string, unknown>> {
    const init: RequestInit = json
      ? { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body), redirect: 'error' }
      : { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: new URLSearchParams(body as Record<string, string>).toString(), redirect: 'error' };
    const r = await this.fetchImpl(url, init);
    const data = await r.json().catch(() => ({})) as Record<string, unknown>;
    if (!r.ok) throw new OAuthError(String(data.error ?? 'server_error'), String(data.error_description ?? 'Sign-in failed (HTTP ' + r.status + ')'));
    return data;
  }
}

const PAGE = (title: string, text: string) => '<!doctype html><meta charset="utf-8"><title>Saina</title><body style="font:16px system-ui;margin:15vh auto;max-width:28rem;text-align:center"><h1 style="font-size:20px">' + title + '</h1><p>' + text + '</p></body>';

// The first free port of LOOPBACK_PORTS receives exactly one redirect carrying our state.
function listen(state: string, timeoutMs: number, ready: (port: number) => Promise<void>): Promise<{ port: number; code: string }> {
  return new Promise((resolve, reject) => {
    let settled = false, bound = 0;
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (url.pathname !== '/callback') { res.writeHead(404).end(); return; }
      const error = url.searchParams.get('error'), code = url.searchParams.get('code');
      const ok = !error && code && url.searchParams.get('state') === state;
      res.writeHead(ok ? 200 : 400, { 'Content-Type': 'text/html; charset=utf-8' }).end(ok ? PAGE('Signed in to Saina', 'You can close this tab and return to your editor.') : PAGE('Sign-in did not complete', 'Return to your editor and try again.'));
      finish(ok ? undefined : new OAuthError(error ?? 'invalid_request', url.searchParams.get('error_description') ?? 'Sign-in was cancelled or did not match this request'), code ?? '');
    });
    const timer = setTimeout(() => finish(new OAuthError('timeout', 'Sign-in timed out')), timeoutMs);
    function finish(err: Error | undefined, code = '') {
      if (settled) return;
      settled = true; clearTimeout(timer); server.close();
      if (err) reject(err); else resolve({ port: bound, code });
    }
    let i = 0;
    const tryNext = () => {
      if (i >= LOOPBACK_PORTS.length) { finish(new OAuthError('unavailable', 'Ports ' + LOOPBACK_PORTS.join(', ') + ' are all in use')); return; }
      server.listen(LOOPBACK_PORTS[i++], '127.0.0.1');
    };
    server.on('error', (e: NodeJS.ErrnoException) => { if (e.code === 'EADDRINUSE') tryNext(); else finish(e); });
    server.on('listening', () => { bound = (server.address() as AddressInfo).port; ready(bound).catch(e => finish(e)); });
    tryNext();
  });
}
