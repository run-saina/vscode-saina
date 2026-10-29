import * as vscode from 'vscode';
import { OAuthError, SainaOAuth } from './oauth';
import type { Metadata, Session } from './oauth';

const SESSION = 'saina.session';
const CLIENT = 'saina.oauthClient';

export class SignInRequired extends Error {
  constructor() { super('Sign in to Saina Studio first'); }
}

// The Studio sign-in for the extension's own calls. Kept in the editor secret store, per API origin.
export class Auth {
  private session: Session | undefined;
  private meta: Metadata | undefined;
  private refreshing: Promise<string> | undefined;
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changed.event;

  constructor(private readonly context: vscode.ExtensionContext, private readonly origin: () => string) {}

  async load() {
    const raw = await this.context.secrets.get(SESSION);
    try { this.session = raw ? JSON.parse(raw) as Session : undefined; } catch { this.session = undefined; }
  }

  signedIn() { return !!this.session && this.session.origin === this.origin(); }

  async signIn(): Promise<boolean> {
    const oauth = new SainaOAuth(this.origin());
    try {
      const meta = await this.metadata(oauth);
      const clients = JSON.parse(await this.context.secrets.get(CLIENT) ?? '{}') as Record<string, string>;
      let clientId = clients[this.origin()];
      if (!clientId) {
        clientId = await oauth.register(meta, vscode.env.appName + ' (Saina extension)');
        await this.context.secrets.store(CLIENT, JSON.stringify({ ...clients, [this.origin()]: clientId }));
      }
      const session = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Saina: approve access in your browser…', cancellable: true }, (_p, cancel) =>
        new Promise<Session>((resolve, reject) => {
          cancel.onCancellationRequested(() => reject(new OAuthError('cancelled', 'Sign-in cancelled')));
          oauth.authorize(meta, clientId, async url => vscode.env.openExternal(vscode.Uri.parse(url, true))).then(resolve, reject);
        }));
      await this.store(session);
      void vscode.window.showInformationMessage('Signed in to Saina Studio.');
      return true;
    } catch (error) {
      if ((error as OAuthError).error === 'invalid_client') await this.context.secrets.delete(CLIENT);
      if ((error as OAuthError).error !== 'cancelled') void vscode.window.showErrorMessage('Saina sign-in failed: ' + (error as Error).message);
      return false;
    }
  }

  async signOut() {
    if (this.session) {
      const oauth = new SainaOAuth(this.session.origin);
      try { await oauth.revoke(await this.metadata(oauth), this.session); } catch { /* sign out locally regardless */ }
    }
    await this.store(undefined);
  }

  // A valid access token, refreshed when it is about to expire. One refresh at a time: refresh tokens rotate.
  token = async (): Promise<string> => {
    const s = this.session;
    if (!s || s.origin !== this.origin()) throw new SignInRequired();
    if (s.expiresAt - Date.now() > 60_000) return s.accessToken;
    this.refreshing ??= (async () => {
      const oauth = new SainaOAuth(s.origin);
      try {
        const next = await oauth.refresh(await this.metadata(oauth), s);
        await this.store(next);
        return next.accessToken;
      } catch (error) {
        if (error instanceof OAuthError && ['invalid_grant', 'invalid_client'].includes(error.error)) { await this.store(undefined); throw new SignInRequired(); }
        throw error;
      } finally { this.refreshing = undefined; }
    })();
    return this.refreshing;
  };

  private async metadata(oauth: SainaOAuth) {
    if (!this.meta || !this.meta.token_endpoint.startsWith(oauth.origin)) this.meta = await oauth.metadata();
    return this.meta;
  }

  private async store(session: Session | undefined) {
    this.session = session;
    if (session) await this.context.secrets.store(SESSION, JSON.stringify(session)); else await this.context.secrets.delete(SESSION);
    this.changed.fire();
  }
}
