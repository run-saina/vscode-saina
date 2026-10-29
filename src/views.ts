import * as vscode from 'vscode';
import { QUESTION_TYPES, accepted, summarize } from './api';
import type { Decision, Discovery, SainaApi } from './api';

// What a "Run Decision" from a tree item targets.
export type Target = { kind: 'model'; provider: string; model: string } | { kind: 'endpoint'; endpoint: string; version: 'production' | number };

export class Node extends vscode.TreeItem {
  constructor(label: string, readonly children: Node[] = [], readonly target?: Target) {
    super(label, children.length ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None);
  }
}

const describe = (types?: string[], inputs?: string[]) => [(types ?? []).map(t => QUESTION_TYPES[t] ?? t).join(', '), (inputs ?? ['text']).join(' + ')].filter(Boolean).join(' · ');

// Saina models come from discovery, so every Helm the account can reach shows up without a release of this extension.
export function modelNodes(d: Discovery): Node[] {
  const group = (label: string, nodes: Node[], icon: string) => { const n = new Node(label, nodes); n.iconPath = new vscode.ThemeIcon(icon); return n; };
  const model = (provider: string, m: Discovery['saina']['models'][number]) => {
    const n = new Node(m.name, [], { kind: 'model', provider, model: m.name });
    n.description = describe(m.question_types, m.inputs); n.contextValue = 'model'; n.iconPath = new vscode.ThemeIcon('symbol-constant');
    return n;
  };
  const out = [group('Saina', d.saina.models.map(m => model('saina', m)), 'sparkle')];
  for (const p of d.providers) if (p.id !== 'saina' && p.models.length) out.push(group(p.name, p.models.map(m => model(p.id, m)), 'plug'));
  if (d.endpoints.length) out.push(group('Endpoints', d.endpoints.map(e => {
    const n = new Node(e.display_name || e.name, [], { kind: 'endpoint', endpoint: e.name, version: 'production' });
    n.description = e.production_version ? 'production v' + e.production_version : 'not promoted';
    n.tooltip = e.name + ' · versions ' + e.versions.join(', '); n.contextValue = 'endpoint'; n.iconPath = new vscode.ThemeIcon('globe');
    return n;
  }), 'server'));
  return out;
}

export function decisionNode(d: Decision): Node {
  const n = new Node(String(d.endpoint ?? 'playground'));
  const when = d.recorded_at ? new Date(d.recorded_at) : undefined;
  n.description = summarize(d).join(' · ') + (when ? ' — ' + when.toLocaleString() : '');
  n.tooltip = d.decision_id;
  n.iconPath = new vscode.ThemeIcon(d.status !== 'completed' ? 'error' : accepted(d) ? 'pass' : 'question');
  n.command = { command: 'saina.openDecision', title: 'Open Decision', arguments: [d.decision_id] };
  return n;
}

class Tree implements vscode.TreeDataProvider<Node> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;
  constructor(private readonly load: () => Promise<Node[]>) {}
  refresh() { this.changed.fire(); }
  getTreeItem(n: Node) { return n; }
  async getChildren(n?: Node): Promise<Node[]> {
    if (n) return n.children;
    try { return await this.load(); } catch (error) {
      const e = new Node((error as Error).message); e.iconPath = new vscode.ThemeIcon('warning');
      return [e];
    }
  }
}

export interface DecisionFilter { endpoint?: string; abstained?: boolean; status?: string }

export function createViews(api: () => SainaApi | undefined, filter: () => DecisionFilter) {
  const models = new Tree(async () => { const a = api(); return a ? modelNodes(await a.discover()) : []; });
  const decisions = new Tree(async () => {
    const a = api();
    if (!a) return [];
    const page = await a.decisions({ ...filter(), limit: 50 });
    return page.decisions.map(decisionNode);
  });
  return { models, decisions };
}
