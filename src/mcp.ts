import * as vscode from 'vscode';
import { mcpUrl } from './api';

// VS Code 1.101+ has lm.registerMcpServerDefinitionProvider; Cursor exposes cursor.mcp.registerServer.
// Both are feature-detected so the extension installs on older hosts too (engines stays at 1.90).
// No API key is sent: the server signs in with OAuth (dynamic client registration) on first use.
type Lm = { registerMcpServerDefinitionProvider?: (id: string, provider: unknown) => vscode.Disposable };
type Cursor = { mcp?: { registerServer?: (config: unknown) => void; unregisterServer?: (name: string) => void } };

export function registerMcp(context: vscode.ExtensionContext, origin: () => string, enabled: () => boolean): () => void {
  const changed = new vscode.EventEmitter<void>();
  context.subscriptions.push(changed);
  const lm = vscode.lm as unknown as Lm;
  const Definition = (vscode as unknown as { McpHttpServerDefinition?: new (label: string, uri: vscode.Uri) => unknown }).McpHttpServerDefinition;
  if (lm.registerMcpServerDefinitionProvider && Definition) {
    context.subscriptions.push(lm.registerMcpServerDefinitionProvider('saina', {
      onDidChangeMcpServerDefinitions: changed.event,
      provideMcpServerDefinitions: () => enabled() ? [new Definition('Saina', vscode.Uri.parse(mcpUrl(origin())))] : [],
    }));
    return () => changed.fire();
  }
  const cursor = (vscode as unknown as { cursor?: Cursor }).cursor?.mcp;
  if (cursor?.registerServer) {
    const sync = () => {
      try { cursor.unregisterServer?.('saina'); } catch { /* not registered yet */ }
      if (enabled()) cursor.registerServer!({ name: 'saina', server: { url: mcpUrl(origin()) } });
    };
    sync();
    context.subscriptions.push({ dispose: () => { try { cursor.unregisterServer?.('saina'); } catch { /* host shutting down */ } } });
    return sync;
  }
  return () => undefined;
}

// For hosts without either API: the standard mcp.json shape, which VS Code, Cursor and most clients read.
export function mcpConfig(origin: string): string {
  return JSON.stringify({ mcpServers: { saina: { url: mcpUrl(origin) } } }, null, 2);
}
