import type { Command } from 'commander';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadToken } from '../platform/auth.js';
import { createClient, PlatformApiError } from '../platform/api-client.js';
import { resolveAgentId } from '../platform/resolve-agent.js';
import { parseSseChunk } from '../utils/sse-parser.js';
import { log } from '../utils/logger.js';
import { GRAY, RESET, BOLD } from '../utils/table.js';
import {
  appendInputFile,
  parseTagFlags,
  requireExistingFile,
  resolveLocalAgentRef,
  runLocalCall,
  saveOutputFile,
} from './local-runtime.js';

export { submitRating };

const DEFAULT_BASE_URL = 'https://agents.hot';

/**
 * Submit a rating for a completed call. Exported for reuse by the `rate` command.
 */
async function submitRating(baseUrl: string, token: string, agentId: string, callId: string, rating: number): Promise<void> {
  const res = await fetch(`${baseUrl}/api/agents/${agentId}/rate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ call_id: callId, rating }),
  });

  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      msg = body.message || body.error || msg;
    } catch { /* ignore */ }
    throw new Error(msg);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function handleError(err: unknown, opts?: { json?: boolean }): never {
  let errorMessage = '';
  let errorHint = '';
  let errorCode = '';

  if (err instanceof PlatformApiError) {
    errorMessage = err.message;
    errorCode = err.errorCode;
    // Add hints for common errors
    if (err.errorCode === 'unauthorized') {
      errorHint = 'Run `ah login` to authenticate.';
    } else if (err.errorCode === 'subscription_required') {
      errorHint = 'Subscribe to the agent first: ah subscribe <author-login>';
    } else if (err.errorCode === 'agent_offline') {
      errorHint = 'Start the agent first: ah agent start <agent-name>';
    } else if (err.errorCode === 'not_found') {
      errorHint = 'Use `ah discover` to find available agents.';
    }
  } else if ((err as Error).name === 'AbortError') {
    errorMessage = 'Request timed out';
    errorHint = 'Use --timeout to increase timeout duration.';
  } else {
    errorMessage = (err as Error).message;
  }

  if (opts?.json) {
    console.log(JSON.stringify({
      type: 'error',
      message: errorMessage,
      code: errorCode,
      hint: errorHint || undefined,
    }));
  } else {
    log.error(errorMessage);
    if (errorHint) {
      console.log(`  ${GRAY}Hint: ${errorHint}${RESET}`);
    }
  }
  process.exit(1);
}

/**
 * Async call: POST mode=async → poll for result
 */
async function asyncCall(opts: {
  id: string;
  name: string;
  token: string;
  taskDescription: string;
  timeoutMs: number;
  json?: boolean;
  outputFile?: string;
  signal?: AbortSignal;
  onCallId?: (callId: string) => void;
}): Promise<{ callId: string; sessionKey?: string }> {
  const selfAgentId = process.env.AGENT_BRIDGE_AGENT_ID;

  const res = await fetch(`${DEFAULT_BASE_URL}/api/agents/${opts.id}/call`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${opts.token}`,
      'Content-Type': 'application/json',
      ...(selfAgentId ? { 'X-Caller-Agent-Id': selfAgentId } : {}),
    },
    body: JSON.stringify({
      task_description: opts.taskDescription,
      mode: 'async',
    }),
    signal: opts.signal,
  });

  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    let errorCode = '';
    try {
      const body = await res.json();
      errorCode = body.error || '';
      msg = body.message || body.error || msg;
    } catch { /* ignore */ }
    if (errorCode === 'subscription_required') {
      log.error('This is a private agent.');
      console.error(`  Subscribe first: ah subscribe <author-login>`);
    } else {
      log.error(msg);
    }
    process.exit(1);
  }

  const { request_id, call_id, session_key, status, error_message, error_code } = await res.json() as {
    request_id: string;
    call_id: string;
    session_key?: string;
    status: string;
    error_message?: string;
    error_code?: string;
  };

  if (status === 'failed') {
    log.error(`Call failed: ${error_message || error_code}`);
    process.exit(1);
  }

  opts.onCallId?.(call_id);

  if (!opts.json) {
    process.stderr.write(`${GRAY}[async] call=${call_id.slice(0, 8)}... request=${request_id.slice(0, 8)}... polling${RESET}`);
  }

  // Poll for result
  const pollInterval = 2000;
  const startTime = Date.now();

  while (Date.now() - startTime < opts.timeoutMs) {
    if (opts.signal?.aborted) {
      log.error('Aborted');
      process.exit(1);
    }

    await sleep(pollInterval);

    const pollRes = await fetch(`${DEFAULT_BASE_URL}/api/agents/${opts.id}/task-status/${request_id}`, {
      headers: { Authorization: `Bearer ${opts.token}` },
      signal: opts.signal,
    });

    if (!pollRes.ok) {
      log.error(`Poll failed: HTTP ${pollRes.status}`);
      process.exit(1);
    }

    const task = await pollRes.json() as {
      status: string;
      result?: string;
      attachments?: Array<{ name: string; url: string; type?: string }>;
      error_message?: string;
      error_code?: string;
    };

    if (task.status === 'completed') {
      if (!opts.json) {
        process.stderr.write(` done\n`);
      }
      const result = task.result || '';
      if (opts.json) {
        console.log(JSON.stringify({
          call_id,
          request_id,
          ...(session_key ? { session_key } : {}),
          status: 'completed',
          result,
          ...(task.attachments?.length ? { attachments: task.attachments } : {}),
          rate_hint: `POST /api/agents/${opts.id}/rate  body: { call_id: "${call_id}", rating: 1-5 }`,
        }));
      } else {
        process.stdout.write(result + '\n');
        if (task.attachments?.length) {
          for (const att of task.attachments) {
            log.info(`  ${GRAY}File:${RESET} ${att.name}  ${GRAY}${att.url}${RESET}`);
          }
        }
        if (session_key) {
          log.info(`  ${GRAY}Session:${RESET} ${session_key}`);
        }
      }
      if (opts.outputFile && result) {
        writeFileSync(opts.outputFile, result);
        if (!opts.json) log.info(`Saved to ${opts.outputFile}`);
      }
      if (!opts.json) {
        log.info(`${GRAY}Rate this call: ah rate ${call_id} <1-5> --agent ${opts.id}${RESET}`);
      }
      return { callId: call_id, ...(session_key ? { sessionKey: session_key } : {}) };
    }

    if (task.status === 'failed') {
      if (!opts.json) {
        process.stderr.write(` failed\n`);
      }
      log.error(`Call failed: ${task.error_message || task.error_code}`);
      process.exit(1);
    }

    if (!opts.json) {
      process.stderr.write('.');
    }
  }

  if (!opts.json) {
    process.stderr.write(` timeout\n`);
  }
  log.error('Call timed out waiting for result');
  process.exit(1);
}

/**
 * Stream call: SSE streaming (legacy mode, opt-in with --stream)
 */
async function streamCall(opts: {
  id: string;
  name: string;
  token: string;
  taskDescription: string;
  timeoutMs: number;
  json?: boolean;
  outputFile?: string;
  signal?: AbortSignal;
  onCallId?: (callId: string) => void;
}): Promise<{ callId: string; sessionKey?: string }> {
  const selfAgentId = process.env.AGENT_BRIDGE_AGENT_ID;

  const res = await fetch(`${DEFAULT_BASE_URL}/api/agents/${opts.id}/call`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${opts.token}`,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      ...(selfAgentId ? { 'X-Caller-Agent-Id': selfAgentId } : {}),
    },
    body: JSON.stringify({
      task_description: opts.taskDescription,
    }),
    signal: opts.signal,
  });

  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    let errorCode = '';
    try {
      const body = await res.json();
      errorCode = body.error || '';
      msg = body.message || body.error || msg;
    } catch { /* ignore */ }
    if (errorCode === 'subscription_required') {
      log.error('This is a private agent.');
      console.error(`  Subscribe first: ah subscribe <author-login>`);
    } else {
      log.error(msg);
    }
    process.exit(1);
  }

  const contentType = res.headers.get('Content-Type') || '';

  // Fallback: JSON response (no SSE support)
  if (contentType.includes('application/json')) {
    const result = await res.json() as { call_id: string; status: string; created_at: string; session_key?: string };
    if (opts.json) {
      console.log(JSON.stringify(result));
    } else {
      console.log('');
      log.success(`Call created for ${BOLD}${opts.name}${RESET}`);
      console.log(`  ${GRAY}Call ID${RESET}    ${result.call_id}`);
      console.log(`  ${GRAY}Status${RESET}     ${result.status}`);
      console.log(`  ${GRAY}Created${RESET}    ${result.created_at}`);
      console.log('');
    }
    return { callId: result.call_id, ...(result.session_key ? { sessionKey: result.session_key } : {}) };
  }

  // SSE streaming
  if (!res.body) {
    log.error('Empty response body');
    process.exit(1);
  }

  if (!opts.json) {
    log.info(`Calling ${BOLD}${opts.name}${RESET}...`);
    console.log('');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let outputBuffer = '';
  let inThinkingBlock = false;
  let callId = res.headers.get('X-Call-Id') || '';
  let sessionKey = res.headers.get('X-Session-Key') || '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    const parsed = parseSseChunk(chunk, buffer);
    buffer = parsed.carry;

    for (const data of parsed.events) {
      if (data === '[DONE]') continue;
      try {
        const event = JSON.parse(data);
        if (event.type === 'start' && event.call_id) {
          callId = event.call_id;
          if (event.session_key) {
            sessionKey = event.session_key;
          }
          opts.onCallId?.(callId);
        }
        if (opts.json) {
          console.log(JSON.stringify(event));
        } else {
          if (event.type === 'chunk' && event.delta) {
            process.stdout.write(event.delta);
            if (!event.kind || event.kind === 'text') {
              const delta = event.delta as string;
              if (delta.startsWith('{') && delta.includes('"type":')) {
                if (delta.includes('"type":"thinking"') && delta.includes('content_block_start')) {
                  inThinkingBlock = true;
                } else if (delta.includes('"type":"text"') && delta.includes('content_block_start')) {
                  inThinkingBlock = false;
                }
              } else if (!inThinkingBlock) {
                outputBuffer += delta;
              }
            }
          } else if (event.type === 'done') {
            if (event.attachments?.length) {
              console.log('');
              for (const att of event.attachments as { name: string; url: string }[]) {
                log.info(`  ${GRAY}File:${RESET} ${att.name}  ${GRAY}${att.url}${RESET}`);
              }
            }
          } else if (event.type === 'error') {
            process.stderr.write(`\nError: ${event.message}\n`);
          }
        }
      } catch { /* malformed SSE */ }
    }
  }

  // Flush trailing buffer
  if (buffer.trim()) {
    const parsed = parseSseChunk('\n\n', buffer);
    for (const data of parsed.events) {
      if (data === '[DONE]') continue;
      try {
        const event = JSON.parse(data);
        if (opts.json) {
          console.log(JSON.stringify(event));
        } else if (event.type === 'chunk' && event.delta) {
          process.stdout.write(event.delta);
          if (!event.kind || event.kind === 'text') {
            const delta = event.delta as string;
            if (!(delta.startsWith('{') && delta.includes('"type":')) && !inThinkingBlock) {
              outputBuffer += delta;
            }
          }
        }
      } catch { /* ignore */ }
    }
  }

  if (opts.outputFile && outputBuffer) {
    writeFileSync(opts.outputFile, outputBuffer);
    if (!opts.json) log.info(`Saved to ${opts.outputFile}`);
  }

  if (!opts.json) {
    console.log('\n');
    log.success('Call completed');
    if (sessionKey) {
      log.info(`${GRAY}Session:${RESET} ${sessionKey}`);
    }
    if (callId) {
      log.info(`${GRAY}Rate this call: ah rate ${callId} <1-5> --agent ${opts.id}${RESET}`);
    }
  }

  return { callId, ...(sessionKey ? { sessionKey } : {}) };
}

export function registerCallCommand(program: Command): void {
  program
    .command('call <agent>')
    .description('Call an agent on the A2A network (default: async polling)')
    .requiredOption('--task <description>', 'Task description')
    .option('--session <id>', 'Attach to an existing local session')
    .option('--task-group <id>', 'Bind the created local session to a task group')
    .option('--fork-from <sessionId>', 'Fork a local session before executing')
    .option('--tag <tag...>', 'Add tag(s) to a new local session')
    .option('--input-file <path>', 'Read file and append to task description')
    .option('--output-file <path>', 'Save response text to file')
    .option('--stream', 'Use SSE streaming instead of async polling')
    .option('--json', 'Output JSONL events')
    .option('--timeout <seconds>', 'Timeout in seconds', '300')
    .option('--rate <rating>', 'Rate the agent after call (1-5)', parseInt)
    .action(async (agentInput: string, opts: {
      task: string;
      session?: string;
      taskGroup?: string;
      forkFrom?: string;
      tag?: string[];
      inputFile?: string;
      outputFile?: string;
      stream?: boolean;
      json?: boolean;
      timeout?: string;
      rate?: number;
    }) => {
      if (resolveLocalAgentRef(agentInput)) {
        if (opts.rate) {
          log.warn('Ignoring --rate for local daemon calls.');
        }
        if (opts.inputFile) {
          requireExistingFile(opts.inputFile);
        }
        const taskDescription = appendInputFile(opts.task, opts.inputFile);
        const result = await runLocalCall({
          agentRef: agentInput,
          sessionId: opts.session,
          forkFromSessionId: opts.session ? undefined : opts.forkFrom,
          taskGroupId: opts.session ? undefined : opts.taskGroup,
          tags: opts.session ? undefined : parseTagFlags(opts.tag),
          message: taskDescription,
          json: opts.json,
        });
        if (opts.outputFile) {
          saveOutputFile(opts.outputFile, result.result);
        }
        return;
      }

      try {
        const token = loadToken();
        if (!token) {
          log.error('Not authenticated. Run `ah login` first.');
          process.exit(1);
        }

        const client = createClient();
        const { id, name } = await resolveAgentId(agentInput, client);

        let taskDescription = opts.task;

        if (opts.inputFile) {
          const content = readFileSync(opts.inputFile, 'utf-8');
          taskDescription = `${taskDescription}\n\n---\n\n${content}`;
        }

        const timeoutMs = parseInt(opts.timeout || '300', 10) * 1000;
        const abortController = new AbortController();
        const timer = setTimeout(() => abortController.abort(), timeoutMs);

        // SIGINT cancel: abort fetch + notify platform to kill remote session
        let cancelCallId: string | undefined;
        const sigintHandler = () => {
          process.stderr.write(`\n${GRAY}Cancelling...${RESET}\n`);
          abortController.abort();
          // Safety: force exit after 3s even if cancel request hangs
          setTimeout(() => process.exit(130), 3000).unref();
          if (cancelCallId) {
            fetch(`${DEFAULT_BASE_URL}/api/agents/${id}/cancel`, {
              method: 'POST',
              headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ call_id: cancelCallId }),
            }).catch(() => {}).finally(() => process.exit(130));
          } else {
            process.exit(130);
          }
        };
        process.once('SIGINT', sigintHandler);

        const callOpts = {
          id,
          name,
          token,
          taskDescription,
          timeoutMs,
          json: opts.json,
          outputFile: opts.outputFile,
          signal: abortController.signal,
          onCallId: (cid: string) => { cancelCallId = cid; },
        };

        let result: { callId: string; sessionKey?: string };
        try {
          if (opts.stream) {
            result = await streamCall(callOpts);
          } else {
            result = await asyncCall(callOpts);
          }
        } finally {
          clearTimeout(timer);
          process.removeListener('SIGINT', sigintHandler);
        }

        // Submit rating if --rate flag provided
        if (opts.rate && result.callId) {
          try {
            await submitRating(DEFAULT_BASE_URL, token, id, result.callId, opts.rate);
            if (!opts.json) {
              log.success(`Rated ${opts.rate}/5`);
            }
          } catch (rateErr) {
            log.warn(`Rating failed: ${(rateErr as Error).message}`);
          }
        }
      } catch (err) {
        if ((err as Error).name === 'AbortError') {
          log.error('Call timed out');
          console.log(`  ${GRAY}Hint: Use --timeout to increase timeout duration.${RESET}`);
          process.exit(1);
        }
        handleError(err, { json: opts.json });
      }
    });
}
