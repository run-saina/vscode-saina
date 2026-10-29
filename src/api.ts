// Studio HTTP contract, shared with the n8n nodes (public/n8n-nodes/nodes/SainaHelm/studio.ts). No vscode imports, so tests run in plain Node.

export const CLIENT_HEADER = { 'X-Saina-Client': 'vscode' };
export const QUESTION_TYPES: Record<string, string> = { noul: 'Yes / No', choice: 'Choose one', score: 'Rate on a scale' };

export interface DiscoveryModel { name: string; question_types?: string[]; inputs?: string[]; max_questions?: number }
export interface DiscoveryEndpoint { name: string; display_name: string; published_version: number; production_version: number | null; versions: number[]; questions_mode: string }
export interface Discovery {
  saina: { models: DiscoveryModel[] };
  providers: Array<{ id: string; name: string; adapter: string; models: DiscoveryModel[] }>;
  endpoints: DiscoveryEndpoint[];
}
export interface Answer { status?: string; selection?: unknown; probability_of_true?: number; score?: number; [key: string]: unknown }
export interface Decision { decision_id: string; status: string; answers: Record<string, Answer>; endpoint?: string; model?: unknown; recorded_at?: string; error?: { code: string; message: string }; [key: string]: unknown }
export interface DecisionPage { decisions: Decision[]; total: number; next_offset: number | null }

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) { super(message); }
}

export function serviceOrigin(baseUrl: unknown): string {
  let base: URL | null = null;
  try { base = new URL(String(baseUrl)); } catch { base = null; }
  if (!base) throw new Error('Invalid Saina base URL');
  if (!['https:', 'http:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new Error('Use an HTTP(S) base URL without credentials, query, or fragment');
  if (base.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)) throw new Error('Plain HTTP is only allowed for localhost');
  return base.toString().replace(/\/$/, '');
}

export const mcpUrl = (origin: string) => origin + '/v1/mcp';
export const studioUrl = (origin: string) => origin.replace('://api.', '://') + '/studio/';

// One Studio operation, addressable both as a REST route (self-hosted servers) and as an MCP tool (hosted Saina over OAuth).
export interface Operation { tool: string; method: 'GET' | 'POST'; path: string; args: Record<string, unknown>; pathArgs?: string[] }
export interface Transport { invoke<T>(op: Operation, timeout?: number): Promise<T> }

function errorOf(data: unknown, status: number): ApiError {
  // Error bodies are {error: {code, message}}; never echo request headers.
  const error = (data as { error?: { code?: string; message?: string } } | undefined)?.error;
  return new ApiError(error?.message || 'Saina returned HTTP ' + status, status, error?.code);
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  try { return text ? JSON.parse(text) : undefined; } catch { return undefined; }
}

// A self-hosted server that does not authenticate: the Studio REST routes, no credentials.
export class RestTransport implements Transport {
  constructor(readonly origin: string, private readonly fetchImpl: typeof fetch = fetch) {}
  async invoke<T>(op: Operation, timeout = 60): Promise<T> {
    const args = { ...op.args };
    let path = op.path;
    for (const key of op.pathArgs ?? []) { path = path.replace('{' + key + '}', encodeURIComponent(String(args[key]))); delete args[key]; }
    delete args.confirm_cost;
    const query = op.method === 'GET' ? new URLSearchParams(Object.entries(args).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])).toString() : '';
    const response = await this.fetchImpl(this.origin + '/v1/studio/' + path + (query ? '?' + query : ''), { method: op.method, headers: { ...CLIENT_HEADER, Accept: 'application/json', ...(op.method === 'POST' ? { 'Content-Type': 'application/json' } : {}) },
      body: op.method === 'POST' ? JSON.stringify(args) : undefined, redirect: 'error', signal: AbortSignal.timeout(timeout * 1000) });
    const data = await readJson(response);
    if (!response.ok) throw errorOf(data, response.status);
    return data as T;
  }
}

// Hosted Saina: the Studio MCP server, with an OAuth access token. Tools carry the same account scoping as Studio.
export class McpTransport implements Transport {
  private id = 0;
  constructor(readonly origin: string, private readonly token: () => Promise<string>, private readonly fetchImpl: typeof fetch = fetch) {}
  async invoke<T>(op: Operation, timeout = 60): Promise<T> {
    const args = Object.fromEntries(Object.entries(op.args).filter(([, v]) => v !== undefined));
    const response = await this.fetchImpl(mcpUrl(this.origin), { method: 'POST', headers: { ...CLIENT_HEADER, Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json', Authorization: 'Bearer ' + await this.token() },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++this.id, method: 'tools/call', params: { name: op.tool, arguments: args } }), redirect: 'error', signal: AbortSignal.timeout(timeout * 1000) });
    const data = await readJson(response) as { result?: { isError?: boolean; content?: Array<{ text?: string }> }; error?: { message?: string } } | undefined;
    if (!response.ok) throw errorOf(data, response.status);
    if (data?.error) throw new ApiError(data.error.message || 'Saina MCP error', 400);
    let payload: unknown = undefined;
    try { payload = JSON.parse(data?.result?.content?.[0]?.text ?? ''); } catch { payload = undefined; }
    if (data?.result?.isError) throw errorOf(payload, 400);
    return payload as T;
  }
}

export class SainaApi {
  constructor(readonly origin: string, private readonly transport: Transport) {}

  async discover(): Promise<Discovery> {
    const data = await this.transport.invoke<Partial<Discovery>>({ tool: 'get_discovery', method: 'GET', path: 'discovery', args: {} });
    return { saina: { models: data?.saina?.models ?? [] }, providers: data?.providers ?? [], endpoints: data?.endpoints ?? [] };
  }

  decisions(query: { endpoint?: string; status?: string; abstained?: boolean; limit?: number; offset?: number } = {}): Promise<DecisionPage> {
    return this.transport.invoke({ tool: 'list_decisions', method: 'GET', path: 'decisions',
      args: { limit: query.limit ?? 50, offset: query.offset ?? 0, endpoint: query.endpoint, status: query.status, abstained: query.abstained ? 'true' : undefined } });
  }

  decision(id: string): Promise<Decision> {
    return this.transport.invoke({ tool: 'get_decision', method: 'GET', path: 'decisions/{decision_id}', args: { decision_id: id }, pathArgs: ['decision_id'] });
  }

  // Model mode posts an ad hoc definition to the playground, as Studio and the n8n node do.
  // confirm_cost is sent only after the person confirmed the run in the editor.
  async decideWithModel(provider: string, model: string, state: unknown, questions: Record<string, unknown>, thresholds: Record<string, unknown>): Promise<Decision> {
    const definition = { name: 'playground', schema_version: '2.2.0', model: { provider_id: provider, name: model }, questions_mode: 'defined', questions,
      ...(Object.keys(thresholds).length ? { answer_thresholds: thresholds } : {}), inputs: { format: 'text', modalities: ['text'] } };
    const response = await this.transport.invoke<{ decision: unknown }>({ tool: 'test_model', method: 'POST', path: 'playground/test', args: { definition, request: { state }, confirm_cost: true } });
    return readDecision(response?.decision);
  }

  // Endpoint mode records the decision, so it shows up in Recent Decisions and can take outcomes.
  async decideWithEndpoint(endpoint: string, version: 'production' | number, state: unknown): Promise<Decision> {
    return readDecision(await this.transport.invoke({ tool: 'run_decision_endpoint', method: 'POST', path: 'endpoints/{endpoint}/decide', args: { endpoint, version, state, confirm_cost: true }, pathArgs: ['endpoint'] }));
  }
}

export const isLoopback = (origin: string) => /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin);

export function readDecision(raw: unknown): Decision {
  const d = raw as Decision;
  if (!d || typeof d !== 'object' || typeof d.decision_id !== 'string' || typeof d.status !== 'string' || !d.answers || typeof d.answers !== 'object') throw new Error('Invalid decision response');
  return d;
}
export const accepted = (d: Decision) => d.status === 'completed' && Object.values(d.answers).every(a => a && a.status !== 'abstained');

// The playground sends a JSON object or array as JSON and anything else as text.
export function parseState(text: string): unknown {
  const s = text.trim();
  if (/^[[{]/.test(s)) { try { return JSON.parse(s); } catch { /* sent as text */ } }
  return s;
}

const ID = /^[A-Za-z0-9_.-]{1,120}$/;
export interface QuestionInput { id?: string; type: string; instructions: string; criteria?: string[] }

export function buildQuestion(row: QuestionInput): Record<string, unknown> {
  const instructions = row.instructions.trim();
  if (!instructions) throw new Error('The question needs instructions');
  const id = (row.id ?? '').trim() || 'answer';
  if (!ID.test(id)) throw new Error('Answer keys use letters, numbers, dots, underscores or hyphens');
  const lines = (row.criteria ?? []).map(l => l.trim()).filter(Boolean);
  const question: Record<string, unknown> = { type: row.type, instructions };
  if (row.type === 'choice') {
    if (lines.length < 2 || lines.length > 255) throw new Error('Choose one needs 2–255 options');
    const criteria: Record<string, string> = {};
    for (const line of lines) {
      const [key, ...rest] = line.split(':');
      const name = key.trim();
      if (!name || name.length > 128 || criteria[name] !== undefined) throw new Error('Option names must be unique, nonblank and at most 128 characters');
      criteria[name] = rest.join(':').trim() || name;
    }
    question.criteria = criteria;
  } else if (row.type === 'score') {
    if (lines.length < 2 || lines.length > 10) throw new Error('A scale needs 2–10 ordered levels');
    question.criteria = lines;
  } else if (row.type !== 'noul') throw new Error('Unsupported answer format');
  return { [id]: question };
}

// One line per answer for notifications and the output channel.
export function summarize(d: Decision): string[] {
  if (d.status !== 'completed') return [d.status + (d.error ? ': ' + d.error.message : '')];
  return Object.entries(d.answers).map(([key, a]) => {
    const value = a.status === 'abstained' ? 'abstained' : ['string', 'number', 'boolean'].includes(typeof a.selection) ? String(a.selection) : JSON.stringify(a.selection ?? a.status ?? '');
    const detail = typeof a.probability_of_true === 'number' ? 'P(yes) ' + Math.round(a.probability_of_true * 100) + '%' : typeof a.score === 'number' ? 'score ' + a.score.toFixed(2) : '';
    return key + ': ' + value + (detail ? ' (' + detail + ')' : '');
  });
}
