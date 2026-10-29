import * as vscode from 'vscode';
import { McpTransport, QUESTION_TYPES, RestTransport, SainaApi, buildQuestion, isLoopback, parseState, serviceOrigin, studioUrl, summarize } from './api';
import type { Decision, Discovery } from './api';
import { Auth, SignInRequired } from './auth';
import { mcpConfig, registerMcp } from './mcp';
import { createViews } from './views';
import type { DecisionFilter, Node, Target } from './views';

export async function activate(context: vscode.ExtensionContext) {
  const config = () => vscode.workspace.getConfiguration('saina');
  const origin = () => serviceOrigin(config().get('baseUrl') || 'https://api.saina.run');
  const isLocal = () => { try { return isLoopback(origin()); } catch { return false; } };
  const auth = new Auth(context, origin);
  await auth.load();
  let filter: DecisionFilter = {};
  const output = vscode.window.createOutputChannel('Saina');

  // Hosted Saina: Studio MCP tools with the signed-in OAuth token. A self-hosted loopback server: REST, no credentials.
  const api = () => {
    try { return new SainaApi(origin(), isLocal() ? new RestTransport(origin()) : new McpTransport(origin(), auth.token)); }
    catch (error) { void vscode.window.showErrorMessage((error as Error).message); return undefined; }
  };
  const ready = () => auth.signedIn() || isLocal();
  const { models, decisions } = createViews(() => ready() ? api() : undefined, () => filter);
  const refresh = () => { void vscode.commands.executeCommand('setContext', 'saina.signedIn', ready()); models.refresh(); decisions.refresh(); };
  const syncMcp = registerMcp(context, origin, () => config().get('registerMcpServer', true));
  const failed = (what: string, error: unknown) => {
    if (error instanceof SignInRequired) { refresh(); void vscode.window.showWarningMessage('Saina: sign in to Saina Studio to continue.', 'Sign In').then(c => c && vscode.commands.executeCommand('saina.signIn')); return; }
    // A read-only Studio connection cannot run decisions; the gateway names the missing scope.
    if (/lacks [a-z-]+:rw/.test((error as Error).message)) {
      void vscode.window.showWarningMessage('Your Saina Studio connection is read only. Sign in again and choose Read and write to run decisions.', 'Sign In Again').then(c => c && auth.signOut().then(() => vscode.commands.executeCommand('saina.signIn')));
      return;
    }
    void vscode.window.showErrorMessage(what + ': ' + (error as Error).message);
  };

  context.subscriptions.push(
    output,
    vscode.window.registerTreeDataProvider('saina.models', models),
    vscode.window.registerTreeDataProvider('saina.decisions', decisions),
    auth.onDidChange(refresh),
    vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration('saina')) { syncMcp(); refresh(); } }),

    vscode.commands.registerCommand('saina.signIn', () => isLocal() ? vscode.window.showInformationMessage('A self-hosted server at ' + origin() + ' needs no sign-in.') : auth.signIn()),
    vscode.commands.registerCommand('saina.signOut', async () => { await auth.signOut(); void vscode.window.showInformationMessage('Signed out of Saina Studio.'); }),
    vscode.commands.registerCommand('saina.refresh', refresh),
    vscode.commands.registerCommand('saina.openStudio', () => vscode.env.openExternal(vscode.Uri.parse(studioUrl(origin())))),
    vscode.commands.registerCommand('saina.copyMcpConfig', async () => {
      await vscode.env.clipboard.writeText(mcpConfig(origin()));
      void vscode.window.showInformationMessage('Copied. Paste it into .cursor/mcp.json or your client\'s MCP config; it signs in to Saina Studio on first use.');
    }),
    vscode.commands.registerCommand('saina.filterDecisions', async () => {
      const a = api(); if (!a) return;
      const endpoints = (await a.discover().catch(() => undefined))?.endpoints ?? [];
      const pick = await vscode.window.showQuickPick([
        { label: 'All decisions', value: {} },
        { label: 'Abstained only', value: { abstained: true } },
        { label: 'Errors only', value: { status: 'error' } },
        ...endpoints.map(e => ({ label: e.display_name || e.name, description: 'endpoint', value: { endpoint: e.name } })),
      ], { title: 'Filter recent decisions' });
      if (pick) { filter = pick.value; decisions.refresh(); }
    }),
    vscode.commands.registerCommand('saina.openDecision', async (id: string) => {
      const a = api(); if (!a) return;
      try {
        const doc = await vscode.workspace.openTextDocument({ language: 'json', content: JSON.stringify(await a.decision(id), null, 2) });
        await vscode.window.showTextDocument(doc, { preview: true });
      } catch (error) { failed('Could not open decision', error); }
    }),
    vscode.commands.registerCommand('saina.decide', () => decide()),
    vscode.commands.registerCommand('saina.decideWith', (node?: Node) => decide(node?.target)),
  );

  async function decide(target?: Target) {
    const a = api(); if (!a) return;
    if (!ready() && !await vscode.commands.executeCommand<boolean>('saina.signIn')) return;
    const editor = vscode.window.activeTextEditor;
    let text = editor && !editor.selection.isEmpty ? editor.document.getText(editor.selection) : '';
    if (!text) text = await vscode.window.showInputBox({ title: 'Input', prompt: 'Text or JSON to decide on', ignoreFocusOut: true }) ?? '';
    if (!text.trim()) return;

    let discovery: Discovery;
    try { discovery = await a.discover(); } catch (error) { failed('Saina', error); return; }
    target ??= await pickTarget(discovery);
    if (!target) return;

    let question: Record<string, unknown> = {};
    if (target.kind === 'model') {
      const built = await askQuestion(discovery, target);
      if (!built) return;
      question = built;
    }
    const label = target.kind === 'model' ? target.model : 'endpoint ' + target.endpoint;
    if (config().get('confirmBeforeRun', true)) {
      const go = await vscode.window.showWarningMessage('Send ' + text.length.toLocaleString() + ' characters to ' + label + '? Calls to Saina\'s hosted API use credits.', { modal: true }, 'Run', 'Run and stop asking');
      if (!go) return;
      if (go === 'Run and stop asking') await config().update('confirmBeforeRun', false, vscode.ConfigurationTarget.Global);
    }

    const state = parseState(text);
    let decision: Decision;
    try {
      decision = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Saina: asking ' + label }, () =>
        target!.kind === 'model' ? a.decideWithModel(target!.provider, target!.model, state, question, {}) : a.decideWithEndpoint(target!.endpoint, target!.version, state));
    } catch (error) { failed('Saina', error); return; }
    output.appendLine('[' + new Date().toISOString() + '] ' + label + ' · ' + decision.decision_id);
    for (const line of summarize(decision)) output.appendLine('  ' + line);
    const choice = await vscode.window.showInformationMessage(summarize(decision).join(' · '), 'Open Decision', 'Show Log');
    if (choice === 'Open Decision') await vscode.commands.executeCommand('saina.openDecision', decision.decision_id);
    if (choice === 'Show Log') output.show(true);
    if (target.kind === 'endpoint') decisions.refresh();
  }

  async function pickTarget(d: Discovery): Promise<Target | undefined> {
    type Item = vscode.QuickPickItem & { target?: Target };
    const items: Item[] = [{ label: 'Saina', kind: vscode.QuickPickItemKind.Separator }];
    for (const m of d.saina.models) items.push({ label: m.name, description: (m.inputs ?? ['text']).join(' + '), target: { kind: 'model', provider: 'saina', model: m.name } });
    for (const p of d.providers) if (p.id !== 'saina' && p.models.length) {
      items.push({ label: p.name, kind: vscode.QuickPickItemKind.Separator });
      for (const m of p.models) items.push({ label: m.name, description: p.name, target: { kind: 'model', provider: p.id, model: m.name } });
    }
    if (d.endpoints.length) {
      items.push({ label: 'Endpoints', kind: vscode.QuickPickItemKind.Separator });
      for (const e of d.endpoints) items.push({ label: e.display_name || e.name, description: e.production_version ? 'production v' + e.production_version : 'not promoted', target: { kind: 'endpoint', endpoint: e.name, version: 'production' } });
    }
    return (await vscode.window.showQuickPick(items, { title: 'Ask which model or endpoint?', matchOnDescription: true }))?.target;
  }

  async function askQuestion(d: Discovery, target: Extract<Target, { kind: 'model' }>): Promise<Record<string, unknown> | undefined> {
    const model = (target.provider === 'saina' ? d.saina.models : d.providers.find(p => p.id === target.provider)?.models ?? []).find(m => m.name === target.model);
    const types = model?.question_types?.length ? model.question_types : Object.keys(QUESTION_TYPES);
    const type = (await vscode.window.showQuickPick(types.map(t => ({ label: QUESTION_TYPES[t] ?? t, value: t })), { title: 'Answer format' }))?.value;
    if (!type) return;
    const instructions = await vscode.window.showInputBox({ title: 'Ask', prompt: 'What should the model decide about the input?', placeHolder: 'Does this message require urgent attention?', ignoreFocusOut: true });
    if (!instructions?.trim()) return;
    let criteria: string[] = [];
    if (type !== 'noul') {
      const raw = await vscode.window.showInputBox({ title: type === 'choice' ? 'Choices' : 'Levels, lowest first', prompt: type === 'choice' ? 'Separate with ; as key: description' : 'Separate with ;', placeHolder: type === 'choice' ? 'billing: Charges and refunds; technical: Bugs; other' : 'Low; Medium; High', ignoreFocusOut: true });
      if (!raw) return;
      criteria = raw.split(';');
    }
    try { return buildQuestion({ type, instructions, criteria }); } catch (error) { void vscode.window.showErrorMessage((error as Error).message); return; }
  }

  refresh();
}

export function deactivate() {}
