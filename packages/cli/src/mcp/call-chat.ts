import { createClient } from '../platform/api-client.js';
import { resolveAgentId } from '../platform/resolve-agent.js';
import { parseSseChunk } from '../utils/sse-parser.js';
import { getMcpToken } from './auth.js';
import { timeoutError, unauthorizedError, validationError } from './errors.js';

const DEFAULT_BASE_URL = 'https://agents.hot';
const DEFAULT_ASYNC_POLL_INTERVAL_MS = 1_000;

export type ChatAgentOptions = {
  agent: string;
  message: string;
  stream: boolean;
  sessionKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
};

export type ChatAgentResult = {
  mode: 'stream' | 'async';
  agent_id: string;
  agent_name: string;
  session_key?: string;
  final_text: string;
  events: unknown[];
};

export async function chatAgentViaApi(opts: ChatAgentOptions): Promise<ChatAgentResult> {
  const token = getMcpToken();
  if (!token) {
    throw unauthorizedError();
  }

  const baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
  const client = createClient(baseUrl);
  const { id, name } = await resolveAgentId(opts.agent, client);

  if (!opts.message || opts.message.trim().length === 0) {
    throw validationError('`message` is required.');
  }

  return opts.stream
    ? streamChat({ baseUrl, token, agentId: id, agentName: name, message: opts.message, sessionKey: opts.sessionKey })
    : asyncChat({
        baseUrl,
        token,
        agentId: id,
        agentName: name,
        message: opts.message,
        sessionKey: opts.sessionKey,
        timeoutMs: opts.timeoutMs,
      });
}

function extractEventText(event: unknown): string {
  if (!event || typeof event !== 'object') return '';
  const record = event as Record<string, unknown>;

  if (typeof record.delta === 'string') return record.delta;
  if (typeof record.text === 'string') return record.text;
  if (typeof record.content === 'string') return record.content;

  return '';
}

async function streamChat(opts: {
  baseUrl: string;
  token: string;
  agentId: string;
  agentName: string;
  message: string;
  sessionKey?: string;
}): Promise<ChatAgentResult> {
  const response = await fetch(`${opts.baseUrl}/api/agents/${opts.agentId}/chat`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${opts.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: opts.message,
      mode: 'stream',
      ...(opts.sessionKey ? { session_key: opts.sessionKey } : {}),
    }),
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  if (!response.body) {
    throw validationError('Chat stream response did not include a body.');
  }

  const events: unknown[] = [];
  const textChunks: string[] = [];
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let carry = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    const parsed = parseSseChunk(chunk, carry);
    carry = parsed.carry;

    for (const payload of parsed.events) {
      const event = parseEvent(payload);
      events.push(event);
      const text = extractEventText(event);
      if (text) {
        textChunks.push(text);
      }
    }
  }

  const finalChunk = decoder.decode();
  if (finalChunk) {
    const parsed = parseSseChunk(finalChunk, carry);
    for (const payload of parsed.events) {
      const event = parseEvent(payload);
      events.push(event);
      const text = extractEventText(event);
      if (text) {
        textChunks.push(text);
      }
    }
  }

  const sessionKey = response.headers.get('X-Session-Key') ?? undefined;

  return {
    mode: 'stream',
    agent_id: opts.agentId,
    agent_name: opts.agentName,
    ...(sessionKey ? { session_key: sessionKey } : {}),
    final_text: textChunks.join(''),
    events,
  };
}

async function asyncChat(opts: {
  baseUrl: string;
  token: string;
  agentId: string;
  agentName: string;
  message: string;
  sessionKey?: string;
  timeoutMs?: number;
}): Promise<ChatAgentResult> {
  const timeoutMs = opts.timeoutMs ?? 300_000;

  const submitRes = await fetch(`${opts.baseUrl}/api/agents/${opts.agentId}/chat`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${opts.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: opts.message,
      mode: 'async',
      ...(opts.sessionKey ? { session_key: opts.sessionKey } : {}),
    }),
  });

  if (!submitRes.ok) {
    throw new Error(await readErrorMessage(submitRes));
  }

  const submitted = await submitRes.json() as {
    request_id?: string;
    session_key?: string;
    status?: string;
    error_message?: string;
  };

  if (!submitted.request_id) {
    throw validationError('Async chat did not return request_id.');
  }

  const events: unknown[] = [
    {
      type: 'task_submitted',
      request_id: submitted.request_id,
      ...(submitted.status ? { status: submitted.status } : {}),
    },
  ];

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(DEFAULT_ASYNC_POLL_INTERVAL_MS);

    const pollRes = await fetch(`${opts.baseUrl}/api/agents/${opts.agentId}/task-status/${submitted.request_id}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${opts.token}`,
      },
    });

    if (!pollRes.ok) {
      throw new Error(await readErrorMessage(pollRes));
    }

    const payload = await pollRes.json() as Record<string, unknown>;
    const status = String(payload.status ?? 'pending');

    events.push({
      type: 'task_status',
      status,
      request_id: submitted.request_id,
    });

    if (status === 'completed') {
      const finalText = extractFinalText(payload);
      return {
        mode: 'async',
        agent_id: opts.agentId,
        agent_name: opts.agentName,
        ...(submitted.session_key ? { session_key: submitted.session_key } : {}),
        final_text: finalText,
        events,
      };
    }

    if (status === 'failed' || status === 'error') {
      const message = String(payload.error_message ?? payload.message ?? 'Async chat failed.');
      throw validationError(message);
    }
  }

  throw timeoutError(
    `Async chat timed out after ${timeoutMs}ms.`,
    'Try a smaller task or raise `AGENT_MESH_MCP_TIMEOUT_MS`.',
  );
}

function parseEvent(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return { type: 'raw', data: raw };
  }
}

function extractFinalText(payload: Record<string, unknown>): string {
  if (typeof payload.result === 'string') return payload.result;

  const result = payload.result;
  if (result && typeof result === 'object') {
    const record = result as Record<string, unknown>;
    if (typeof record.text === 'string') return record.text;
    if (typeof record.content === 'string') return record.content;
    if (Array.isArray(record.content)) {
      const pieces = record.content
        .map((item) => {
          if (!item || typeof item !== 'object') return '';
          const entry = item as Record<string, unknown>;
          return typeof entry.text === 'string' ? entry.text : '';
        })
        .filter(Boolean);
      if (pieces.length > 0) return pieces.join('');
    }
  }

  if (typeof payload.text === 'string') return payload.text;
  if (typeof payload.output_text === 'string') return payload.output_text;

  return JSON.stringify(payload, null, 2);
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const payload = await response.json() as Record<string, unknown>;
    if (typeof payload.message === 'string') return payload.message;
    if (typeof payload.error === 'string') return payload.error;
    return `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
