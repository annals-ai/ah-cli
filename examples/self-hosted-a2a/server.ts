/**
 * Self-Hosted A2A Provider
 *
 * 企业内网部署：数据不出公司网络，零第三方依赖。
 * 把本地 CLI agent（Claude Code、Codex 等）暴露为标准 A2A HTTP 端点。
 *
 * 安全模型：
 *   - Bearer token 认证（启动时自动生成或从环境变量读取）
 *   - 请求超时（默认 5 分钟自动 kill 子进程）
 *   - 滑动窗口速率限制（默认 30 次/分钟）
 *   - 请求体大小限制（默认 1MB）
 *   - 结构化审计日志（每次调用记录 who/what/when）
 *   - 默认只绑定 127.0.0.1（显式设置 HOST=0.0.0.0 才监听全部接口）
 *
 * 用法：
 *   npx tsx server.ts                              # 自动生成 token，只监听 localhost
 *   API_TOKEN=my-secret npx tsx server.ts           # 指定 token
 *   HOST=0.0.0.0 npx tsx server.ts                  # 监听所有接口（内网部署）
 *   AGENT_CMD="codex" npx tsx server.ts             # 换 agent 后端
 *
 * 端点：
 *   GET  /.well-known/agent.json   → A2A Agent Card（无需认证）
 *   POST /a2a                      → A2A JSON-RPC（需要 Bearer token）
 *   GET  /health                   → 健康检查（无需认证）
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID, randomBytes } from 'node:crypto';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '127.0.0.1';
const AGENT_CMD = process.env.AGENT_CMD || 'claude';
const AGENT_NAME = process.env.AGENT_NAME || 'self-hosted-agent';
const AGENT_DESCRIPTION = process.env.AGENT_DESCRIPTION || 'A self-hosted A2A agent';
const AGENT_PROJECT = process.env.AGENT_PROJECT || process.cwd();
const API_TOKEN = process.env.API_TOKEN || randomBytes(32).toString('hex');
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS) || 5 * 60_000;
const RATE_LIMIT_RPM = Number(process.env.RATE_LIMIT_RPM) || 30;
const MAX_BODY_BYTES = Number(process.env.MAX_BODY_BYTES) || 1_048_576; // 1MB

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

function audit(event: string, meta: Record<string, unknown> = {}): void {
  const entry = {
    ts: new Date().toISOString(),
    event,
    ...meta,
  };
  process.stderr.write(JSON.stringify(entry) + '\n');
}

// ---------------------------------------------------------------------------
// Rate limiter (sliding window per-token)
// ---------------------------------------------------------------------------

const rateBuckets = new Map<string, number[]>();

function checkRateLimit(token: string): boolean {
  const now = Date.now();
  const window = 60_000;
  let timestamps = rateBuckets.get(token);
  if (!timestamps) {
    timestamps = [];
    rateBuckets.set(token, timestamps);
  }
  // Drop expired entries
  while (timestamps.length > 0 && timestamps[0]! <= now - window) {
    timestamps.shift();
  }
  if (timestamps.length >= RATE_LIMIT_RPM) {
    return false;
  }
  timestamps.push(now);
  return true;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

function authenticate(req: IncomingMessage): boolean {
  const header = req.headers.authorization;
  if (!header) return false;
  const parts = header.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') return false;
  // Constant-time comparison
  const provided = Buffer.from(parts[1]!);
  const expected = Buffer.from(API_TOKEN);
  if (provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < provided.length; i++) {
    diff |= provided[i]! ^ expected[i]!;
  }
  return diff === 0;
}

// ---------------------------------------------------------------------------
// Task store (in-memory)
// ---------------------------------------------------------------------------

interface TaskMessage {
  role: 'user' | 'agent';
  parts: Array<{ type: 'text'; text: string }>;
}

interface Task {
  id: string;
  status: { state: 'submitted' | 'working' | 'completed' | 'failed'; message?: TaskMessage };
  messages: TaskMessage[];
  process?: ChildProcess;
  timer?: ReturnType<typeof setTimeout>;
  createdAt: string;
}

const tasks = new Map<string, Task>();

// Auto-clean completed tasks older than 1 hour
setInterval(() => {
  const cutoff = Date.now() - 3_600_000;
  for (const [id, task] of tasks) {
    if ((task.status.state === 'completed' || task.status.state === 'failed') &&
        new Date(task.createdAt).getTime() < cutoff) {
      tasks.delete(id);
    }
  }
}, 60_000).unref();

// ---------------------------------------------------------------------------
// Agent Card
// ---------------------------------------------------------------------------

function agentCard() {
  return {
    name: AGENT_NAME,
    description: AGENT_DESCRIPTION,
    url: `http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}/a2a`,
    version: '0.1.0',
    capabilities: {
      streaming: true,
      pushNotifications: false,
    },
    authentication: {
      schemes: ['bearer'],
    },
    skills: [
      {
        id: 'general',
        name: 'General Assistant',
        description: 'Handles any text-based task via local CLI agent',
      },
    ],
    defaultInputModes: ['text'],
    defaultOutputModes: ['text'],
  };
}

// ---------------------------------------------------------------------------
// Execute agent via local CLI (with timeout)
// ---------------------------------------------------------------------------

function executeAgent(
  task: Task,
  message: string,
  onChunk: (delta: string) => void,
  onDone: (fullText: string) => void,
  onError: (error: string) => void,
): void {
  const args = ['--print', '--output-format', 'text', message];
  const child = spawn(AGENT_CMD, args, {
    cwd: AGENT_PROJECT,
    env: { ...process.env, CLAUDE_CODE_DISABLE_NONESSENTIAL: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  task.process = child;
  let fullText = '';
  let stderr = '';
  let finished = false;

  // Timeout: kill the process if it runs too long
  const timer = setTimeout(() => {
    if (!finished) {
      child.kill('SIGKILL');
      audit('task_timeout', { taskId: task.id, timeoutMs: REQUEST_TIMEOUT_MS });
    }
  }, REQUEST_TIMEOUT_MS);
  task.timer = timer;

  child.stdout.on('data', (chunk: Buffer) => {
    const text = chunk.toString();
    fullText += text;
    onChunk(text);
  });

  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  child.on('close', (code) => {
    finished = true;
    clearTimeout(timer);
    task.process = undefined;
    task.timer = undefined;
    if (code === 0) {
      onDone(fullText);
    } else if (code === null || code === 137) {
      onError('Request timed out');
    } else {
      onError(stderr || `Agent exited with code ${code}`);
    }
  });

  child.on('error', (err) => {
    finished = true;
    clearTimeout(timer);
    task.process = undefined;
    task.timer = undefined;
    onError(err.message);
  });
}

// ---------------------------------------------------------------------------
// JSON-RPC helpers
// ---------------------------------------------------------------------------

function jsonRpcOk(id: string | number | null, result: unknown) {
  return { jsonrpc: '2.0', id, result };
}

function jsonRpcError(id: string | number | null, code: number, message: string) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function taskToA2A(task: Task) {
  return {
    id: task.id,
    status: task.status,
    messages: task.messages,
  };
}

// ---------------------------------------------------------------------------
// Handle tasks/send
// ---------------------------------------------------------------------------

async function handleTasksSend(params: Record<string, unknown>): Promise<unknown> {
  const message = extractMessage(params);
  if (!message) {
    return { error: { code: -32602, message: 'Missing message.parts[0].text' } };
  }

  const taskId = (params.id as string) || randomUUID();
  const userMsg: TaskMessage = { role: 'user', parts: [{ type: 'text', text: message }] };

  const task: Task = {
    id: taskId,
    status: { state: 'submitted' },
    messages: [userMsg],
    createdAt: new Date().toISOString(),
  };
  tasks.set(taskId, task);
  task.status = { state: 'working' };

  audit('task_start', { taskId, method: 'tasks/send', messageLength: message.length });

  return new Promise<unknown>((resolve) => {
    executeAgent(
      task,
      message,
      () => {},
      (fullText) => {
        const agentMsg: TaskMessage = { role: 'agent', parts: [{ type: 'text', text: fullText }] };
        task.messages.push(agentMsg);
        task.status = { state: 'completed', message: agentMsg };
        audit('task_done', { taskId, state: 'completed', responseLength: fullText.length });
        resolve(taskToA2A(task));
      },
      (error) => {
        const errMsg: TaskMessage = { role: 'agent', parts: [{ type: 'text', text: error }] };
        task.messages.push(errMsg);
        task.status = { state: 'failed', message: errMsg };
        audit('task_done', { taskId, state: 'failed', error });
        resolve(taskToA2A(task));
      },
    );
  });
}

// ---------------------------------------------------------------------------
// Handle tasks/sendSubscribe
// ---------------------------------------------------------------------------

function handleTasksSendSubscribe(
  params: Record<string, unknown>,
  res: ServerResponse,
  rpcId: string | number | null,
): void {
  const message = extractMessage(params);
  if (!message) {
    writeSseEvent(res, jsonRpcError(rpcId, -32602, 'Missing message.parts[0].text'));
    res.end();
    return;
  }

  const taskId = (params.id as string) || randomUUID();
  const userMsg: TaskMessage = { role: 'user', parts: [{ type: 'text', text: message }] };

  const task: Task = {
    id: taskId,
    status: { state: 'submitted' },
    messages: [userMsg],
    createdAt: new Date().toISOString(),
  };
  tasks.set(taskId, task);

  audit('task_start', { taskId, method: 'tasks/sendSubscribe', messageLength: message.length });

  writeSseEvent(res, jsonRpcOk(rpcId, {
    id: taskId,
    status: { state: 'submitted' },
    messages: [userMsg],
  }));

  task.status = { state: 'working' };
  writeSseEvent(res, jsonRpcOk(rpcId, {
    id: taskId,
    status: { state: 'working' },
  }));

  executeAgent(
    task,
    message,
    (delta) => {
      writeSseEvent(res, jsonRpcOk(rpcId, {
        id: taskId,
        artifact: {
          parts: [{ type: 'text', text: delta }],
          index: 0,
          append: true,
        },
      }));
    },
    (fullText) => {
      const agentMsg: TaskMessage = { role: 'agent', parts: [{ type: 'text', text: fullText }] };
      task.messages.push(agentMsg);
      task.status = { state: 'completed', message: agentMsg };
      writeSseEvent(res, jsonRpcOk(rpcId, {
        id: taskId,
        status: { state: 'completed', message: agentMsg },
      }));
      audit('task_done', { taskId, state: 'completed', responseLength: fullText.length });
      res.end();
    },
    (error) => {
      const errMsg: TaskMessage = { role: 'agent', parts: [{ type: 'text', text: error }] };
      task.messages.push(errMsg);
      task.status = { state: 'failed', message: errMsg };
      writeSseEvent(res, jsonRpcOk(rpcId, {
        id: taskId,
        status: { state: 'failed', message: errMsg },
      }));
      audit('task_done', { taskId, state: 'failed', error });
      res.end();
    },
  );
}

// ---------------------------------------------------------------------------
// Handle tasks/get & tasks/cancel
// ---------------------------------------------------------------------------

function handleTasksGet(params: Record<string, unknown>) {
  const taskId = params.id as string;
  const task = tasks.get(taskId);
  if (!task) {
    return jsonRpcError(null, -32602, `Task not found: ${taskId}`);
  }
  return taskToA2A(task);
}

function handleTasksCancel(params: Record<string, unknown>) {
  const taskId = params.id as string;
  const task = tasks.get(taskId);
  if (!task) {
    return { error: { code: -32602, message: `Task not found: ${taskId}` } };
  }
  if (task.timer) clearTimeout(task.timer);
  task.process?.kill('SIGTERM');
  task.status = { state: 'failed', message: { role: 'agent', parts: [{ type: 'text', text: 'Cancelled' }] } };
  audit('task_cancel', { taskId });
  return taskToA2A(task);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractMessage(params: Record<string, unknown>): string | null {
  const msg = params.message as { role?: string; parts?: Array<{ type?: string; text?: string }> } | undefined;
  if (!msg?.parts?.length) return null;
  const textPart = msg.parts.find((p) => p.type === 'text');
  return textPart?.text || null;
}

function writeSseEvent(res: ServerResponse, data: unknown): void {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        req.destroy();
        reject(new Error('Body too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
}

// ---------------------------------------------------------------------------
// HTTP Server
// ---------------------------------------------------------------------------

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`);

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    });
    res.end();
    return;
  }

  // Agent Card — public (needed for A2A discovery)
  if (url.pathname === '/.well-known/agent.json' && req.method === 'GET') {
    sendJson(res, 200, agentCard());
    return;
  }

  // Health — public
  if (url.pathname === '/health' && req.method === 'GET') {
    sendJson(res, 200, { status: 'ok', agent: AGENT_NAME, activeTasks: tasks.size });
    return;
  }

  // Everything below requires auth
  if (url.pathname === '/a2a' && req.method === 'POST') {
    if (!authenticate(req)) {
      audit('auth_rejected', { ip: req.socket.remoteAddress });
      sendJson(res, 401, { error: 'Unauthorized', message: 'Bearer token required' });
      return;
    }

    if (!checkRateLimit(API_TOKEN)) {
      audit('rate_limited', { ip: req.socket.remoteAddress });
      sendJson(res, 429, { error: 'Too many requests', message: `Limit: ${RATE_LIMIT_RPM} req/min` });
      return;
    }

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(await readBody(req));
    } catch (err) {
      const msg = err instanceof Error && err.message === 'Body too large'
        ? `Body exceeds ${MAX_BODY_BYTES} bytes`
        : 'Parse error';
      sendJson(res, 400, jsonRpcError(null, -32700, msg));
      return;
    }

    const method = body.method as string;
    const params = (body.params || {}) as Record<string, unknown>;
    const rpcId = (body.id ?? null) as string | number | null;

    switch (method) {
      case 'tasks/send': {
        const result = await handleTasksSend(params);
        sendJson(res, 200, jsonRpcOk(rpcId, result));
        return;
      }
      case 'tasks/sendSubscribe': {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*',
        });
        handleTasksSendSubscribe(params, res, rpcId);
        return;
      }
      case 'tasks/get': {
        const result = handleTasksGet(params);
        sendJson(res, 200, jsonRpcOk(rpcId, result));
        return;
      }
      case 'tasks/cancel': {
        const result = handleTasksCancel(params);
        sendJson(res, 200, jsonRpcOk(rpcId, result));
        return;
      }
      default:
        sendJson(res, 200, jsonRpcError(rpcId, -32601, `Method not found: ${method}`));
        return;
    }
  }

  sendJson(res, 404, { error: 'Not found' });
});

server.listen(PORT, HOST, () => {
  const isAutoToken = !process.env.API_TOKEN;
  console.log(`
┌─────────────────────────────────────────────────────┐
│  Self-Hosted A2A Provider                           │
├─────────────────────────────────────────────────────┤
│  Agent:     ${AGENT_NAME.padEnd(39)}│
│  Command:   ${AGENT_CMD.padEnd(39)}│
│  Project:   ${AGENT_PROJECT.slice(-39).padEnd(39)}│
│  Listen:    ${(HOST + ':' + PORT).padEnd(39)}│
│  Timeout:   ${(REQUEST_TIMEOUT_MS / 1000 + 's').padEnd(39)}│
│  Rate:      ${(RATE_LIMIT_RPM + ' req/min').padEnd(39)}│
├─────────────────────────────────────────────────────┤
│  Agent Card:  http://${HOST}:${PORT}/.well-known/agent.json
│  A2A RPC:     http://${HOST}:${PORT}/a2a
│  Health:      http://${HOST}:${PORT}/health
├─────────────────────────────────────────────────────┤
│  API Token: ${API_TOKEN.slice(0, 12)}...${isAutoToken ? ' (auto-generated)' : ''}
│                                                     │
│  curl -H "Authorization: Bearer ${API_TOKEN.slice(0, 8)}..." \\
│    -X POST http://${HOST}:${PORT}/a2a ...
└─────────────────────────────────────────────────────┘
  `);

  if (isAutoToken) {
    // Print full token to stderr so it can be captured by scripts
    // but won't pollute piped stdout
    process.stderr.write(`\nFull API token: ${API_TOKEN}\n\n`);
  }
});
