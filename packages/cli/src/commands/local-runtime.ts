import { createInterface } from 'node:readline';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { RuntimeStreamEvent } from '../daemon/types.js';
import { DaemonStore } from '../daemon/store.js';
import { ensureDaemonRunning } from '../daemon/process.js';
import { requestDaemon, streamDaemon } from '../daemon/client.js';
import { log } from '../utils/logger.js';
import { BOLD, GRAY, GREEN, RESET, YELLOW } from '../utils/table.js';

export interface LocalRunOptions {
  agentRef?: string;
  sessionId?: string;
  forkFromSessionId?: string;
  message: string;
  taskGroupId?: string;
  tags?: string[];
  showThinking?: boolean;
  withFiles?: boolean;
  json?: boolean;
}

export function resolveLocalAgentRef(ref: string): boolean {
  const store = new DaemonStore();
  try {
    return !!store.resolveAgentRef(ref);
  } finally {
    store.close();
  }
}

export function parseTagFlags(raw: string[] = []): string[] {
  return raw.map((item) => item.trim()).filter(Boolean);
}

export async function listLocalSessions(agentRef: string): Promise<void> {
  await ensureDaemonRunning();
  const result = await requestDaemon<{ sessions: Array<{
    id: string;
    title: string | null;
    status: string;
    lastActiveAt: string;
    tags: string[];
  }> }>('session.list', { agentRef, status: 'all' });

  if (result.sessions.length === 0) {
    log.info('No local sessions found.');
    return;
  }

  console.log('');
  console.log(`  ${BOLD}Local sessions${RESET}`);
  console.log('');
  for (const session of result.sessions) {
    const title = session.title || '(untitled)';
    const status = session.status === 'active'
      ? `${GREEN}${session.status}${RESET}`
      : `${GRAY}${session.status}${RESET}`;
    console.log(`  ${status}  ${title}`);
    console.log(`         ${GRAY}${session.id}${RESET}`);
    if (session.tags.length) {
      console.log(`         ${GRAY}tags:${RESET} ${session.tags.join(', ')}`);
    }
  }
  console.log('');
}

export async function runLocalChat(opts: LocalRunOptions): Promise<{ sessionId: string; result: string }> {
  return runLocalRuntime('runtime.chat', opts);
}

export async function runLocalCall(opts: LocalRunOptions): Promise<{ sessionId: string; result: string }> {
  return runLocalRuntime('runtime.call', opts);
}

async function runLocalRuntime(method: 'runtime.chat' | 'runtime.call', opts: LocalRunOptions): Promise<{ sessionId: string; result: string }> {
  await ensureDaemonRunning();

  let sessionId = opts.sessionId;
  let resultText = '';

  const response = await streamDaemon<{
    session: { id: string };
    result: string;
  }>(
    method,
    {
      agentRef: opts.agentRef,
      sessionId: opts.sessionId,
      forkFromSessionId: opts.forkFromSessionId,
      message: opts.message,
      taskGroupId: opts.taskGroupId,
      tags: opts.tags,
      withFiles: opts.withFiles,
    },
    (event) => {
      const runtimeEvent = event as RuntimeStreamEvent;
      if (opts.json) {
        console.log(JSON.stringify(runtimeEvent));
        return;
      }

      switch (runtimeEvent.type) {
        case 'keepalive':
          return; // Silently consumed — only resets client timeout
        case 'session':
          sessionId = runtimeEvent.session.id;
          process.stderr.write(
            `${GRAY}[local] agent=${runtimeEvent.agent.slug} session=${runtimeEvent.session.id.slice(0, 8)}...${RESET}\n`,
          );
          break;
        case 'chunk':
          resultText += runtimeEvent.delta;
          process.stdout.write(runtimeEvent.delta);
          break;
        case 'tool':
          if (runtimeEvent.event.kind === 'thinking' && opts.showThinking === false) {
            return;
          }
          process.stdout.write(`${YELLOW}[${runtimeEvent.event.kind}]${RESET} ${runtimeEvent.event.delta}`);
          break;
        case 'done':
          if (runtimeEvent.result && runtimeEvent.result !== resultText) {
            resultText = runtimeEvent.result;
          }
          break;
        case 'error':
          throw new Error(runtimeEvent.message);
      }
    },
  );

  if (!opts.json) {
    process.stdout.write('\n');
  }

  return {
    sessionId: sessionId ?? response.session.id,
    result: response.result || resultText,
  };
}

export async function interactiveLocalChat(opts: {
  agentRef?: string;
  sessionId?: string;
  forkFromSessionId?: string;
  taskGroupId?: string;
  tags?: string[];
  showThinking?: boolean;
}): Promise<void> {
  let currentSessionId = opts.sessionId;

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `${GREEN}> ${RESET}`,
  });

  console.log(`${GRAY}Type your message and press Enter. /quit to exit.${RESET}\n`);
  rl.prompt();

  rl.on('line', async (line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      rl.prompt();
      return;
    }
    if (trimmed === '/quit' || trimmed === '/q' || trimmed === '/exit') {
      rl.close();
      return;
    }

    try {
      const response = await runLocalChat({
        agentRef: opts.agentRef,
        sessionId: currentSessionId,
        forkFromSessionId: currentSessionId ? undefined : opts.forkFromSessionId,
        taskGroupId: currentSessionId ? undefined : opts.taskGroupId,
        tags: currentSessionId ? undefined : opts.tags,
        message: trimmed,
        showThinking: opts.showThinking,
      });
      currentSessionId = response.sessionId;
    } catch (error) {
      log.error((error as Error).message);
    }

    console.log('');
    rl.prompt();
  });

  await new Promise<void>((resolve) => {
    rl.on('close', () => {
      console.log('');
      resolve();
    });
  });
}

export function appendInputFile(task: string, inputFile?: string): string {
  if (!inputFile) return task;
  const content = readFileSync(inputFile, 'utf-8');
  return `${task}\n\n---\n\n${content}`;
}

export function saveOutputFile(outputFile: string | undefined, content: string): void {
  if (!outputFile || !content) return;
  writeFileSync(outputFile, content);
  log.info(`Saved to ${outputFile}`);
}

export function requireExistingFile(path: string): void {
  if (!existsSync(path)) {
    throw new Error(`File not found: ${path}`);
  }
}
