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

export class SainaApi {
  constructor(readonly origin: string, private readonly apiKey: string | undefined, private readonly fetchImpl: typeof fetch = fetch) {}

  async request<T>(method: 'GET' | 'POST', path: string, body?: unknown, timeout = 60): Promise<T> {
    const headers: Record<string, string> = { ...CLIENT_HEADER, Accept: 'application/json' };
    if (this.apiKey) headers.Authorization = 'Bearer ' + this.apiKey;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await this.fetchImpl(this.origin + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(timeout * 1000) });
    const text = await response.text();
    let data: unknown = undefined;
    try { data = text ? JSON.parse(text) : undefined; } catch { data = undefined; }
    if (!response.ok) {
      // Error bodies are {error: {code, message}}; never echo request headers.
      const error = (data as { error?: { code?: string; message?: string } } | undefined)?.error;
      throw new ApiError(error?.message || 'Saina returned HTTP ' + response.status, response.status, error?.code);
    }
    return data as T;
  }

  async discover(): Promise<Discovery> {
    const data = await this.request<Partial<Discovery>>('GET', '/v1/studio/discovery');
    return { saina: { models: data?.saina?.models ?? [] }, providers: data?.providers ?? [], endpoints: data?.endpoints ?? [] };
  }

  decisions(query: { endpoint?: string; status?: string; abstained?: boolean; limit?: number; offset?: number } = {}): Promise<DecisionPage> {
    const params = new URLSearchParams({ limit: String(query.limit ?? 50), offset: String(query.offset ?? 0) });
    if (query.endpoint) params.set('endpoint', query.endpoint);
    if (query.status) params.set('status', query.status);
    if (query.abstained) params.set('abstained', 'true');
    return this.request('GET', '/v1/studio/decisions?' + params);
  }

  decision(id: string): Promise<Decision> {
    return this.request('GET', '/v1/studio/decisions/' + encodeURIComponent(id));
  }

  // Model mode posts an ad hoc definition to the playground, as Studio and the n8n node do.
  async decideWithModel(provider: string, model: string, state: unknown, questions: Record<string, unknown>, thresholds: Record<string, unknown>): Promise<Decision> {
    const definition = { name: 'playground', schema_version: '2.2.0', model: { provider_id: provider, name: model }, questions_mode: 'defined', questions,
      ...(Object.keys(thresholds).length ? { answer_thresholds: thresholds } : {}), inputs: { format: 'text', modalities: ['text'] } };
    const response = await this.request<{ decision: unknown }>('POST', '/v1/studio/playground/test', { definition, request: { state } });
    return readDecision(response?.decision);
  }

  // Endpoint mode records the decision, so it shows up in Recent Decisions and can take outcomes.
  async decideWithEndpoint(endpoint: string, version: 'production' | number, state: unknown): Promise<Decision> {
    return readDecision(await this.request('POST', '/v1/studio/endpoints/' + encodeURIComponent(endpoint) + '/decide', { state, version }));
  }
}

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
